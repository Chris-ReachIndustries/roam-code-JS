/**
 * roam conventions — Detect naming convention violations.
 */

import { openDb } from '../db/connection.js';
import { ensureIndex } from './resolve.js';
import { formatTable, jsonEnvelope, toJson, abbrevKind, loc } from '../output/formatter.js';
import { createSarifLog, addRun, writeSarif, conventionToSarif } from '../output/sarif.js';

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;
const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*$/;
const UPPER_SNAKE = /^[A-Z][A-Z0-9_]*$/;

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const sarifPath = opts.sarif || null;

    // Get all symbols
    const symbols = db.prepare(`
      SELECT s.id, s.name, s.kind, s.is_exported, f.path as file_path, s.line_start, f.language
      FROM symbols s JOIN files f ON s.file_id = f.id
      WHERE s.name != '' AND s.name NOT LIKE '\\_%' ESCAPE '\\' AND s.name NOT LIKE '<_%' ESCAPE '<'
      ORDER BY f.path, s.line_start
    `).all();

    // Detect dominant conventions per language
    const langConventions = Object.create(null);
    const langSymbols = Object.create(null);

    for (const s of symbols) {
      const lang = s.language || 'unknown';
      if (!langSymbols[lang]) langSymbols[lang] = [];
      langSymbols[lang].push(s);
    }

    for (const [lang, syms] of Object.entries(langSymbols)) {
      const funcSyms = syms.filter(s => s.kind === 'function' || s.kind === 'method');
      const classSyms = syms.filter(s => s.kind === 'class' || s.kind === 'interface' || s.kind === 'struct');
      const constSyms = syms.filter(s => s.kind === 'constant');

      // Detect function naming convention
      const camelCount = funcSyms.filter(s => CAMEL_CASE.test(s.name)).length;
      const snakeCount = funcSyms.filter(s => SNAKE_CASE.test(s.name)).length;
      const funcConvention = camelCount > snakeCount ? 'camelCase' : snakeCount > camelCount ? 'snake_case' : null;

      // Detect class naming convention
      const pascalCount = classSyms.filter(s => PASCAL_CASE.test(s.name)).length;
      const classConvention = pascalCount > classSyms.length * 0.5 ? 'PascalCase' : null;

      // Detect constant naming
      const upperCount = constSyms.filter(s => UPPER_SNAKE.test(s.name)).length;
      const constConvention = upperCount > constSyms.length * 0.5 ? 'UPPER_SNAKE' : null;

      langConventions[lang] = { func: funcConvention, cls: classConvention, constant: constConvention };
    }

    // Find violations
    const violations = [];

    for (const s of symbols) {
      const lang = s.language || 'unknown';
      const conv = langConventions[lang];
      if (!conv) continue;

      // Function/method naming
      if ((s.kind === 'function' || s.kind === 'method') && conv.func) {
        if (conv.func === 'camelCase' && !CAMEL_CASE.test(s.name) && !s.name.startsWith('_')) {
          // Allow dunder methods and private names
          if (!s.name.startsWith('__') && !PASCAL_CASE.test(s.name)) {
            violations.push({
              name: s.name, kind: s.kind, file_path: s.file_path, line_start: s.line_start,
              violation: 'naming', expected: 'camelCase', actual: _classifyCase(s.name),
              language: lang,
            });
          }
        } else if (conv.func === 'snake_case' && !SNAKE_CASE.test(s.name)) {
          if (!s.name.startsWith('__') && !PASCAL_CASE.test(s.name)) {
            violations.push({
              name: s.name, kind: s.kind, file_path: s.file_path, line_start: s.line_start,
              violation: 'naming', expected: 'snake_case', actual: _classifyCase(s.name),
              language: lang,
            });
          }
        }
      }

      // Class naming
      if ((s.kind === 'class' || s.kind === 'interface' || s.kind === 'struct') && conv.cls) {
        if (conv.cls === 'PascalCase' && !PASCAL_CASE.test(s.name)) {
          violations.push({
            name: s.name, kind: s.kind, file_path: s.file_path, line_start: s.line_start,
            violation: 'naming', expected: 'PascalCase', actual: _classifyCase(s.name),
            language: lang,
          });
        }
      }

      // Constant naming
      if (s.kind === 'constant' && conv.constant === 'UPPER_SNAKE' && !UPPER_SNAKE.test(s.name)) {
        if (s.is_exported) {
          violations.push({
            name: s.name, kind: s.kind, file_path: s.file_path, line_start: s.line_start,
            violation: 'naming', expected: 'UPPER_SNAKE', actual: _classifyCase(s.name),
            language: lang,
          });
        }
      }
    }

    // SARIF export
    if (sarifPath) {
      const log = createSarifLog();
      const { rules, results } = conventionToSarif(violations);
      addRun(log, 'conventions', rules, results);
      writeSarif(log, sarifPath);
      console.log(`SARIF written to ${sarifPath}`);
    }

    // Group violations by type
    const byLanguage = Object.create(null);
    for (const v of violations) {
      const lang = v.language || 'unknown';
      if (!byLanguage[lang]) byLanguage[lang] = [];
      byLanguage[lang].push(v);
    }

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('conventions', {
        summary: {
          total_violations: violations.length,
          languages: Object.keys(langConventions).length,
          conventions_detected: langConventions,
        },
        violations: violations.map(v => ({
          name: v.name, kind: v.kind, expected: v.expected, actual: v.actual,
          location: loc(v.file_path, v.line_start), language: v.language,
        })),
      })));
    } else {
      console.log(`Naming Conventions (${violations.length} violations):\n`);

      // Show detected conventions
      for (const [lang, conv] of Object.entries(langConventions)) {
        const parts = [];
        if (conv.func) parts.push(`functions: ${conv.func}`);
        if (conv.cls) parts.push(`classes: ${conv.cls}`);
        if (conv.constant) parts.push(`constants: ${conv.constant}`);
        if (parts.length) console.log(`  ${lang}: ${parts.join(', ')}`);
      }
      console.log('');

      if (!violations.length) {
        console.log('No naming convention violations detected.');
        return;
      }

      for (const [lang, items] of Object.entries(byLanguage)) {
        console.log(`${lang} (${items.length} violations):`);
        const headers = ['Name', 'Kind', 'Expected', 'Actual', 'Location'];
        const rows = items.slice(0, 30).map(v => [
          v.name, abbrevKind(v.kind), v.expected, v.actual, loc(v.file_path, v.line_start),
        ]);
        console.log(formatTable(headers, rows));
        if (items.length > 30) console.log(`  (+${items.length - 30} more)`);
        console.log('');
      }
    }
  } finally {
    db.close();
  }
}

function _classifyCase(name) {
  if (CAMEL_CASE.test(name)) return 'camelCase';
  if (SNAKE_CASE.test(name)) return 'snake_case';
  if (PASCAL_CASE.test(name)) return 'PascalCase';
  if (UPPER_SNAKE.test(name)) return 'UPPER_SNAKE';
  return 'mixed';
}
