/**
 * Tree-sitter parsing coordinator.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { createRequire } from 'node:module';
import Parser from 'tree-sitter';

const require = createRequire(import.meta.url);

// Map file extensions to tree-sitter language names
export const EXTENSION_MAP = {
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.py': 'python',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.cs': 'c_sharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.sh': 'bash',
  '.bash': 'bash',
  '.css': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.json': 'json',
  '.md': 'markdown',
  '.sql': 'sql',
  '.tf': 'hcl',
  '.hcl': 'hcl',
  // Salesforce
  '.cls': 'apex',
  '.trigger': 'apex',
  '.page': 'visualforce',
  '.component': 'aura',
  '.cmp': 'aura',
  '.app': 'aura',
  '.evt': 'aura',
  '.intf': 'aura',
  '.design': 'aura',
  // Visual FoxPro
  '.prg': 'foxpro',
  '.scx': 'foxpro',
  // Protobuf
  '.proto': 'protobuf',
};

// Grammar aliasing: languages that reuse existing tree-sitter grammars
export const GRAMMAR_ALIASES = {
  'c_sharp': 'c_sharp',  // npm package: tree-sitter-c-sharp
  'apex': 'java',
  'sfxml': 'html',
  'aura': 'html',
  'visualforce': 'html',
};

// Map language name -> npm package require path
const GRAMMAR_PACKAGES = {
  'python': 'tree-sitter-python',
  'javascript': 'tree-sitter-javascript',
  'typescript': 'tree-sitter-typescript/typescript',
  'tsx': 'tree-sitter-typescript/tsx',
  'go': 'tree-sitter-go',
  'java': 'tree-sitter-java',
  'rust': 'tree-sitter-rust',
  'c': 'tree-sitter-c',
  'cpp': 'tree-sitter-cpp',
  'c_sharp': 'tree-sitter-c-sharp',
  'ruby': 'tree-sitter-ruby',
  'php': 'tree-sitter-php/php',
  'html': 'tree-sitter-html',
};

// Languages that use regex-only extraction (no tree-sitter grammar)
export const REGEX_ONLY_LANGUAGES = new Set(['foxpro', 'protobuf', 'sfxml', 'aura', 'visualforce']);

// Parser cache
const _parserCache = new Map();

// Track parse error stats
export const parseErrors = { no_grammar: 0, parse_error: 0, unreadable: 0 };

/**
 * Get or create a cached parser for a language.
 * @param {string} grammarName
 * @returns {Parser|null}
 */
function getParser(grammarName) {
  if (_parserCache.has(grammarName)) {
    return _parserCache.get(grammarName);
  }

  const packageName = GRAMMAR_PACKAGES[grammarName];
  if (!packageName) return null;

  try {
    const Language = require(packageName);
    const parser = new Parser();
    parser.setLanguage(Language);
    _parserCache.set(grammarName, parser);
    return parser;
  } catch {
    return null;
  }
}

/**
 * Detect the tree-sitter language name from a file path.
 * @param {string} filePath
 * @returns {string|null}
 */
export function detectLanguage(filePath) {
  if (filePath.endsWith('-meta.xml')) return 'sfxml';
  const ext = extname(filePath);
  return EXTENSION_MAP[ext] || null;
}

/**
 * Read file as a string, trying utf-8 then latin-1.
 * @param {string} filePath - Absolute path
 * @returns {string|null}
 */
export function readSource(filePath) {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    try {
      return readFileSync(filePath, 'latin1');
    } catch {
      return null;
    }
  }
}

/**
 * Extract <script> blocks from a Vue SFC.
 * Preserves line numbers by replacing non-script regions with blank lines.
 * @param {string} source
 * @returns {[string, string]} [processedSource, effectiveLanguage]
 */
function preprocessVue(source) {
  const lines = source.split('\n');
  let effectiveLang = 'javascript';

  const scriptPattern = /<script(\s[^>]*)?>.*?<\/script>/gs;
  const scriptLineFlags = new Array(lines.length).fill(false);

  let match;
  while ((match = scriptPattern.exec(source)) !== null) {
    const attrs = match[1] || '';
    if (attrs.includes('lang="ts"') || attrs.includes("lang='ts'") || attrs.includes('lang="tsx"')) {
      effectiveLang = 'typescript';
    }

    const blockStart = source.slice(0, match.index).split('\n').length - 1;
    const innerText = match[0];
    const openingTagEnd = innerText.indexOf('>') + 1;
    const openingLines = innerText.slice(0, openingTagEnd).split('\n').length - 1;
    const closingTagStart = innerText.lastIndexOf('</script>');
    const closingLines = innerText.slice(0, closingTagStart).split('\n').length - 1;

    const contentStart = blockStart + openingLines + 1;
    const contentEnd = blockStart + closingLines;

    for (let i = contentStart; i < Math.min(contentEnd, lines.length); i++) {
      scriptLineFlags[i] = true;
    }
  }

  const outputLines = lines.map((line, i) => scriptLineFlags[i] ? line : '');
  return [outputLines.join('\n'), effectiveLang];
}

/**
 * Parse a file with tree-sitter.
 * @param {string} filePath - Absolute path
 * @param {string|null} [language] - Override language detection
 * @returns {[object|null, string|null, string|null]} [tree, source, language]
 */
export function parseFile(filePath, language = null) {
  if (!language) {
    language = detectLanguage(filePath);
  }
  if (!language) return [null, null, null];

  let source = readSource(filePath);
  if (source == null) {
    parseErrors.unreadable++;
    return [null, null, null];
  }

  // Regex-only languages
  if (REGEX_ONLY_LANGUAGES.has(language)) {
    return [null, source, language];
  }

  // Vue/Svelte SFC: extract <script> blocks
  if (language === 'vue' || language === 'svelte') {
    [source, language] = preprocessVue(source);
  }

  // Resolve grammar alias
  const grammar = GRAMMAR_ALIASES[language] || language;

  const parser = getParser(grammar);
  if (!parser) {
    parseErrors.no_grammar++;
    return [null, null, null];
  }

  try {
    const tree = parser.parse(source);
    return [tree, source, language];
  } catch {
    parseErrors.parse_error++;
    return [null, null, null];
  }
}

/**
 * Extract the <template> block content from a Vue SFC.
 * @param {string} source
 * @returns {[string, number]|null} [templateContent, startLineNumber] or null
 */
export function extractVueTemplate(source) {
  const outerOpen = source.match(/<template(\s[^>]*)?>/);
  if (!outerOpen) return null;

  const contentStart = outerOpen.index + outerOpen[0].length;
  let depth = 1;

  const tagRe = /<(\/?)template\b([^>]*?)(\/?)>/g;
  tagRe.lastIndex = contentStart;

  let m;
  while ((m = tagRe.exec(source)) !== null) {
    const isClosing = m[1] === '/';
    const isSelfClosing = m[3] === '/';

    if (isSelfClosing) continue;
    if (isClosing) {
      depth--;
      if (depth === 0) {
        const content = source.slice(contentStart, m.index);
        const startLine = source.slice(0, contentStart).split('\n').length;
        return [content, startLine];
      }
    } else {
      depth++;
    }
  }
  return null;
}

/**
 * Scan a Vue template block for identifiers matching known script symbols.
 * @param {string} templateContent
 * @param {number} startLine
 * @param {Set<string>} knownSymbols
 * @param {string} filePath
 * @returns {object[]}
 */
export function scanTemplateReferences(templateContent, startLine, knownSymbols, filePath) {
  if (!templateContent || !knownSymbols.size) return [];

  const exprPatterns = [
    /\{\{(.*?)\}\}/gs,                              // {{ expr }}
    /(?::|v-bind:)[\w.-]+="([^"]*)"/g,              // :attr="expr"
    /v-[\w-]+="([^"]*)"/g,                           // v-directive="expr"
    /(?:@|v-on:)[\w.-]+="([^"]*)"/g,                // @event="handler"
  ];
  const identRe = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
  const componentRe = /<([A-Z][a-zA-Z0-9]+)/g;

  const refs = [];
  const seen = new Set();

  // Pass 1: identifiers in expressions
  for (const pattern of exprPatterns) {
    let match;
    while ((match = pattern.exec(templateContent)) !== null) {
      const expr = match[1];
      const lineNum = startLine + templateContent.slice(0, match.index).split('\n').length - 1;
      let identMatch;
      while ((identMatch = identRe.exec(expr)) !== null) {
        const name = identMatch[1];
        if (knownSymbols.has(name) && !seen.has(name)) {
          seen.add(name);
          refs.push({ source_name: null, target_name: name, kind: 'template', line: lineNum, source_file: filePath });
        }
      }
    }
  }

  // Pass 2: PascalCase component usage
  const lines = templateContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let match;
    while ((match = componentRe.exec(lines[i])) !== null) {
      const name = match[1];
      if (knownSymbols.has(name) && !seen.has(name)) {
        seen.add(name);
        refs.push({ source_name: null, target_name: name, kind: 'template', line: startLine + i, source_file: filePath });
      }
    }
  }

  return refs;
}

/**
 * Return a summary of parse errors for logging.
 * @returns {string}
 */
export function getParseErrorSummary() {
  const parts = [];
  if (parseErrors.unreadable) parts.push(`${parseErrors.unreadable} unreadable`);
  if (parseErrors.parse_error) parts.push(`${parseErrors.parse_error} parse errors`);
  if (parseErrors.no_grammar) parts.push(`${parseErrors.no_grammar} no grammar`);
  return parts.join(', ');
}
