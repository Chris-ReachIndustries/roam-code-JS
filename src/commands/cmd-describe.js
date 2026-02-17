/**
 * roam describe — Generate a Markdown project description with architecture overview.
 */

import { openDb } from '../db/connection.js';
import { ALL_FILES, TOP_SYMBOLS_BY_PAGERANK, LANGUAGE_DISTRIBUTION, SYMBOL_KIND_DISTRIBUTION,
  TOP_CHURN_FILES, FILE_COUNT, ALL_CLUSTERS } from '../db/queries.js';
import { ensureIndex } from './resolve.js';
import { jsonEnvelope, toJson, abbrevKind } from '../output/formatter.js';
import { findProjectRoot } from '../db/connection.js';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

export async function execute(opts, globalOpts) {
  ensureIndex();
  const db = openDb({ readonly: true });
  try {
    const jsonMode = globalOpts.json || false;
    const write = opts.write || false;
    const agentPrompt = opts.agentPrompt || false;
    const outputFile = opts.output || null;
    const force = opts.force || false;

    const root = findProjectRoot();
    const projectName = basename(root);

    // Gather data
    const fileCount = db.prepare(FILE_COUNT).get().cnt;
    const languages = db.prepare(LANGUAGE_DISTRIBUTION).all();
    const kindDist = db.prepare(SYMBOL_KIND_DISTRIBUTION).all();
    const topSymbols = db.prepare(TOP_SYMBOLS_BY_PAGERANK).all(15);
    const clusters = db.prepare(ALL_CLUSTERS).all();
    const files = db.prepare(ALL_FILES).all();

    let hotspots = [];
    try {
      hotspots = db.prepare(TOP_CHURN_FILES).all(10);
    } catch { /* file_stats may not exist */ }

    // Directory tree
    const dirs = new Map();
    for (const f of files) {
      const d = dirname(f.path).replace(/\\/g, '/');
      if (!dirs.has(d)) dirs.set(d, { count: 0, languages: new Set() });
      const info = dirs.get(d);
      info.count++;
      if (f.language) info.languages.add(f.language);
    }
    const topDirs = [...dirs.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15);

    // Entry points: exported symbols in root-level files
    const entryPoints = db.prepare(
      `SELECT s.name, s.kind, s.signature, f.path as file_path
       FROM symbols s JOIN files f ON s.file_id = f.id
       WHERE s.is_exported = 1 AND f.path NOT LIKE '%/%/%'
       ORDER BY s.name LIMIT 20`
    ).all();

    // Cycle count
    let cycleCount = 0;
    try {
      const sccRows = db.prepare('SELECT COUNT(DISTINCT cluster_id) as cnt FROM clusters').get();
      cycleCount = sccRows?.cnt || 0;
    } catch { /* ok */ }

    // Detect agent config files
    const agentFiles = ['CLAUDE.md', 'AGENTS.md', 'CURSORRULES', '.cursorrules', 'copilot-instructions.md']
      .filter(f => existsSync(join(root, f)));

    // Build sections
    if (agentPrompt) {
      const compact = _buildAgentPrompt(projectName, fileCount, languages, topSymbols, topDirs);
      if (jsonMode) {
        console.log(toJson(jsonEnvelope('describe', { summary: { format: 'agent-prompt' }, prompt: compact })));
      } else {
        console.log(compact);
      }
      return;
    }

    const md = _buildMarkdown(projectName, fileCount, languages, kindDist, topSymbols,
      topDirs, entryPoints, clusters, hotspots, agentFiles, cycleCount);

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('describe', {
        summary: {
          project: projectName,
          files: fileCount,
          languages: languages.length,
          sections: 10,
        },
        markdown: md,
      })));
      return;
    }

    if (write || outputFile) {
      const outPath = outputFile || join(root, 'ROAM_DESCRIBE.md');
      if (existsSync(outPath) && !force) {
        console.error(`${outPath} already exists. Use --force to overwrite.`);
        process.exit(1);
      }
      writeFileSync(outPath, md, 'utf-8');
      console.log(`Written to ${outPath}`);
    } else {
      console.log(md);
    }
  } finally {
    db.close();
  }
}

function _buildMarkdown(projectName, fileCount, languages, kindDist, topSymbols,
  topDirs, entryPoints, clusters, hotspots, agentFiles, cycleCount) {
  const lines = [];

  // 1. Overview
  lines.push(`# ${projectName}`);
  lines.push('');
  const langStr = languages.slice(0, 5).map(l => `${l.language} (${l.cnt})`).join(', ');
  lines.push(`**${fileCount} files** across ${languages.length} language(s): ${langStr}`);
  lines.push('');

  // 2. Directories
  lines.push('## Directory Structure');
  lines.push('');
  for (const [dir, info] of topDirs) {
    const langs = [...info.languages].join(', ');
    lines.push(`- \`${dir}/\` — ${info.count} files (${langs})`);
  }
  lines.push('');

  // 3. Entry Points
  if (entryPoints.length) {
    lines.push('## Entry Points');
    lines.push('');
    for (const ep of entryPoints) {
      lines.push(`- \`${ep.name}\` (${ep.kind}) — ${ep.file_path}`);
    }
    lines.push('');
  }

  // 4. Key Abstractions
  if (topSymbols.length) {
    lines.push('## Key Abstractions');
    lines.push('');
    lines.push('Top symbols by PageRank (influence):');
    lines.push('');
    for (const s of topSymbols) {
      lines.push(`- **${s.name}** (${s.kind}) — ${s.file_path} — PR: ${(s.pagerank || 0).toFixed(4)}`);
    }
    lines.push('');
  }

  // 5. Architecture
  lines.push('## Architecture');
  lines.push('');
  const kindStr = kindDist.slice(0, 8).map(k => `${k.cnt} ${k.kind}s`).join(', ');
  lines.push(`Symbol distribution: ${kindStr}`);
  if (clusters.length) {
    lines.push(`\nClusters: ${clusters.length} detected`);
    for (const c of clusters.slice(0, 5)) {
      const memberPreview = c.members ? c.members.split(', ').slice(0, 5).join(', ') : '';
      lines.push(`- **${c.cluster_label}** (${c.size} symbols): ${memberPreview}`);
    }
  }
  lines.push('');

  // 6. Testing
  lines.push('## Testing');
  lines.push('');
  const testFiles = topDirs.filter(([d]) => d.includes('test') || d.includes('spec'));
  if (testFiles.length) {
    for (const [dir, info] of testFiles) {
      lines.push(`- \`${dir}/\` — ${info.count} test files`);
    }
  } else {
    lines.push('No dedicated test directories detected.');
  }
  lines.push('');

  // 7. Complexity & Hotspots
  if (hotspots.length) {
    lines.push('## Hotspots');
    lines.push('');
    lines.push('Files with highest churn:');
    lines.push('');
    for (const h of hotspots.slice(0, 5)) {
      lines.push(`- \`${h.path}\` — ${h.total_churn} churn, ${h.commit_count || '?'} commits`);
    }
    lines.push('');
  }

  // 8. Dependencies
  lines.push('## Dependencies');
  lines.push('');
  lines.push(`Cross-file import relationships tracked. ${cycleCount > 0 ? `${cycleCount} dependency clusters detected.` : 'No circular dependencies detected.'}`);
  lines.push('');

  // 9. Agent Config
  if (agentFiles.length) {
    lines.push('## AI Agent Configuration');
    lines.push('');
    for (const f of agentFiles) {
      lines.push(`- \`${f}\` detected`);
    }
    lines.push('');
  }

  // 10. Generated by
  lines.push('---');
  lines.push('*Generated by roam-code-js*');

  return lines.join('\n');
}

function _buildAgentPrompt(projectName, fileCount, languages, topSymbols, topDirs) {
  const lines = [];
  lines.push(`Project: ${projectName} (${fileCount} files)`);
  const langStr = languages.slice(0, 3).map(l => l.language).join(', ');
  lines.push(`Languages: ${langStr}`);
  lines.push(`Key dirs: ${topDirs.slice(0, 5).map(([d]) => d).join(', ')}`);
  if (topSymbols.length) {
    lines.push(`Key symbols: ${topSymbols.slice(0, 8).map(s => `${s.name}(${abbrevKind(s.kind)})`).join(', ')}`);
  }
  return lines.join('\n');
}
