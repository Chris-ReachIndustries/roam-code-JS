/**
 * Language detection, grammar loading, and extractor registry.
 */

import { extname } from 'node:path';
import { GRAMMAR_ALIASES, REGEX_ONLY_LANGUAGES } from '../index/parser.js';

// Map file extension -> language key
const EXTENSION_MAP = {
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.py': 'python',
  '.pyi': 'python',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.hh': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'c_sharp',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.scala': 'scala',
  '.sc': 'scala',
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
};

// All supported language names
export const SUPPORTED_LANGUAGES = new Set([
  'python', 'javascript', 'typescript', 'tsx',
  'go', 'rust', 'java', 'c', 'cpp',
  'ruby', 'php', 'c_sharp', 'kotlin', 'swift', 'scala',
  'vue', 'svelte',
  'apex', 'sfxml', 'aura', 'visualforce',
  'foxpro',
]);

/**
 * Determine the language for a file based on its extension.
 * @param {string} filePath
 * @returns {string|null}
 */
export function getLanguageForFile(filePath) {
  if (filePath.endsWith('-meta.xml')) return 'sfxml';
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext] || null;
}

// Extractor instance cache
const _extractorCache = new Map();

// Loaded extractor classes (populated by initExtractors)
const _extractorClasses = {};

async function _loadExtractors() {
  const [
    { PythonExtractor },
    { JavaScriptExtractor },
    { TypeScriptExtractor },
    { GoExtractor },
    { JavaExtractor },
    { RustExtractor },
    { CExtractor, CppExtractor },
    { GenericExtractor },
  ] = await Promise.all([
    import('./python.js'),
    import('./javascript.js'),
    import('./typescript.js'),
    import('./go.js'),
    import('./java.js'),
    import('./rust.js'),
    import('./c.js'),
    import('./generic.js'),
  ]);

  _extractorClasses.python = PythonExtractor;
  _extractorClasses.javascript = JavaScriptExtractor;
  _extractorClasses.typescript = TypeScriptExtractor;
  _extractorClasses.tsx = TypeScriptExtractor;
  _extractorClasses.go = GoExtractor;
  _extractorClasses.java = JavaExtractor;
  _extractorClasses.rust = RustExtractor;
  _extractorClasses.c = CExtractor;
  _extractorClasses.cpp = CppExtractor;
  _extractorClasses.GenericExtractor = GenericExtractor;
}

/**
 * Get an extractor instance for a language (sync version).
 * Requires extractors to be pre-loaded via initExtractors().
 * @param {string} language
 * @returns {import('./base.js').LanguageExtractor|null}
 */
export function getExtractor(language) {
  if (_extractorCache.has(language)) {
    return _extractorCache.get(language);
  }

  let extractor = null;

  // Direct extractor class lookup
  const ExtractorClass = _extractorClasses[language];
  if (ExtractorClass) {
    extractor = new ExtractorClass();
  } else {
    // Try alias
    const aliasTarget = GRAMMAR_ALIASES[language];
    if (aliasTarget && _extractorClasses[aliasTarget]) {
      extractor = new _extractorClasses[aliasTarget]();
    } else if (_extractorClasses.GenericExtractor) {
      // Use GenericExtractor for any language with a tree-sitter grammar
      if (SUPPORTED_LANGUAGES.has(language) && !REGEX_ONLY_LANGUAGES.has(language)) {
        extractor = new _extractorClasses.GenericExtractor(language);
      }
    }
  }

  if (extractor) {
    _extractorCache.set(language, extractor);
  }
  return extractor;
}

/**
 * Initialize extractor modules (must be called before getExtractor).
 */
export async function initExtractors() {
  await _loadExtractors();
}

/**
 * Get all supported file extensions.
 * @returns {string[]}
 */
export function getSupportedExtensions() {
  return Object.keys(EXTENSION_MAP).sort();
}

/**
 * Get all supported language names.
 * @returns {string[]}
 */
export function getSupportedLanguages() {
  return [...SUPPORTED_LANGUAGES].sort();
}
