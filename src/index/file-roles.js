/**
 * Smart file role classifier using three-tier heuristics.
 *
 * Classifies files into: source, test, config, build, docs,
 * generated, vendored, data, examples, scripts, ci.
 */

import { basename, extname } from 'node:path';

// ---------------------------------------------------------------------------
// Tier 1 - Path-based patterns (compiled regex, no I/O)
// ---------------------------------------------------------------------------

const _PATH_PATTERNS = [
  [/(?:^|\/)\.github\//, 'ci'],
  [/(?:^|\/)\.circleci\//, 'ci'],
  [/(?:^|\/)\.gitlab-ci\//, 'ci'],
  [/(?:^|\/)\.gitlab\//, 'ci'],
  [/(?:^|\/)vendor\//, 'vendored'],
  [/(?:^|\/)node_modules\//, 'vendored'],
  [/(?:^|\/)third_party\//, 'vendored'],
  [/(?:^|\/)third-party\//, 'vendored'],
  [/(?:^|\/)extern\//, 'vendored'],
  [/(?:^|\/)external\//, 'vendored'],
  [/(?:^|\/)tests\//, 'test'],
  [/(?:^|\/)test\//, 'test'],
  [/(?:^|\/)__tests__\//, 'test'],
  [/(?:^|\/)spec\//, 'test'],
  [/(?:^|\/)testing\//, 'test'],
  [/(?:^|\/)docs\//, 'docs'],
  [/(?:^|\/)doc\//, 'docs'],
  [/(?:^|\/)documentation\//, 'docs'],
  [/(?:^|\/)examples\//, 'examples'],
  [/(?:^|\/)example\//, 'examples'],
  [/(?:^|\/)samples\//, 'examples'],
  [/(?:^|\/)sample\//, 'examples'],
  [/(?:^|\/)scripts\//, 'scripts'],
  [/(?:^|\/)bin\//, 'scripts'],
  [/(?:^|\/)dev\//, 'scripts'],
  [/(?:^|\/)build\//, 'build'],
  [/(?:^|\/)dist\//, 'build'],
  [/(?:^|\/)out\//, 'build'],
  [/(?:^|\/)target\//, 'build'],
];

// ---------------------------------------------------------------------------
// Tier 2 - Filename patterns (no I/O)
// ---------------------------------------------------------------------------

const _EXACT_FILENAMES = new Map([
  ['makefile', 'build'], ['dockerfile', 'build'], ['jenkinsfile', 'build'],
  ['vagrantfile', 'build'], ['rakefile', 'build'],
  ['gulpfile.js', 'build'], ['gruntfile.js', 'build'],
  ['webpack.config.js', 'build'], ['webpack.config.ts', 'build'],
  ['rollup.config.js', 'build'], ['rollup.config.ts', 'build'],
  ['vite.config.js', 'build'], ['vite.config.ts', 'build'],
  ['cmakelists.txt', 'build'],
  ['build.gradle', 'build'], ['build.gradle.kts', 'build'],
  ['pom.xml', 'build'], ['justfile', 'build'],
  ['taskfile.yml', 'build'], ['taskfile.yaml', 'build'],
  ['tiltfile', 'build'], ['procfile', 'build'],
]);

const _FILENAME_PREFIXES = [
  ['readme', 'docs'], ['license', 'docs'], ['licence', 'docs'],
  ['changelog', 'docs'], ['contributing', 'docs'], ['authors', 'docs'],
  ['history', 'docs'], ['copying', 'docs'], ['code_of_conduct', 'docs'],
];

const _TEST_PATTERNS = [
  /^test_.*\.py$/, /^.*_test\.py$/, /^conftest\.py$/,
  /^.*_test\.go$/,
  /^.*\.test\.[jt]sx?$/, /^.*\.spec\.[jt]sx?$/,
  /^.*Tests?\.java$/, /^.*Tests?\.kt$/,
  /^.*Tests?\.cs$/, /^.*_spec\.rb$/,
  /^.*Test\.php$/, /^.*(?:Test|Spec)\.scala$/,
  /^.*_test\.exs$/, /^.*_test\.dart$/,
  /^.*Test\.cls$/, /^.*_test\.rs$/,
  /^.*Tests?\.swift$/,
];

const _DOC_EXTENSIONS = new Set(['.md', '.rst', '.adoc', '.asciidoc', '.txt']);

const _CONFIG_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.conf', '.properties', '.env', '.editorconfig', '.xml',
]);

const _CONFIG_FILENAMES = new Set([
  '.gitignore', '.gitattributes', '.dockerignore',
  '.eslintrc', '.prettierrc', '.babelrc',
  '.flake8', '.pylintrc', '.rubocop.yml',
  'setup.cfg', 'pyproject.toml', 'setup.py',
  'package.json', 'tsconfig.json', 'jsconfig.json',
  '.eslintrc.json', '.prettierrc.json',
  'tox.ini', 'mypy.ini', 'pytest.ini',
  'cargo.toml', 'go.mod', 'go.sum',
  'gemfile', 'composer.json', 'mix.exs',
  'pubspec.yaml', 'pubspec.yml',
  '.htaccess', 'nginx.conf',
  '.browserslistrc', '.nvmrc', '.node-version',
  '.python-version', '.ruby-version', '.tool-versions',
  'requirements.txt', 'constraints.txt', 'pipfile',
]);

const _DATA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.bmp', '.webp',
  '.tiff', '.tif', '.psd',
  '.mp3', '.mp4', '.wav', '.ogg', '.flac', '.avi', '.mov', '.mkv',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.csv', '.tsv', '.parquet', '.avro',
  '.db', '.sqlite', '.sqlite3',
  '.bin', '.dat', '.pak', '.wasm',
  '.exe', '.dll', '.so', '.dylib', '.o', '.a', '.lib',
  '.pyc', '.pyo', '.class', '.jar',
]);

const _FILENAME_PATTERNS = [
  [/^\.gitlab-ci\.yml$/, 'ci'], [/^\.travis\.yml$/, 'ci'],
  [/^appveyor\.yml$/, 'ci'], [/^azure-pipelines\.yml$/, 'ci'],
  [/^bitbucket-pipelines\.yml$/, 'ci'], [/^cloudbuild\.yaml$/, 'ci'],
  [/^\.drone\.yml$/, 'ci'], [/^Jenkinsfile/, 'ci'],
  [/^codecov\.yml$/, 'ci'], [/^\.coveragerc$/, 'ci'],
  [/^.*\.generated\.\w+$/, 'generated'], [/^.*\.g\.\w+$/, 'generated'],
  [/^.*\.pb\.go$/, 'generated'], [/^.*_pb2\.py$/, 'generated'],
  [/^.*\.pb\.h$/, 'generated'], [/^.*\.pb\.cc$/, 'generated'],
  [/^.*\.min\.\w+$/, 'generated'],
  [/^.*\.lock$/, 'config'], [/^.*-lock\.\w+$/, 'config'],
];

// ---------------------------------------------------------------------------
// Tier 3 - Content-based patterns (selective I/O)
// ---------------------------------------------------------------------------

const _GENERATED_MARKERS = /DO NOT EDIT|generated by|auto-generated|@generated|GENERATED FILE|THIS FILE IS GENERATED|machine generated|code generated|automatically generated/i;
const _SHEBANG_PATTERN = /^#!.*\//;
const _MINIFIABLE_EXTENSIONS = new Set(['.js', '.css']);
const _MINIFICATION_AVG_LINE_THRESHOLD = 110;

// ---------------------------------------------------------------------------
// Tier helpers
// ---------------------------------------------------------------------------

function _tier1Path(normalized) {
  for (const [pattern, role] of _PATH_PATTERNS) {
    if (pattern.test(normalized)) return role;
  }
  return null;
}

function _tier2Filename(bn, ext, normalized) {
  const lower = bn.toLowerCase();

  const exact = _EXACT_FILENAMES.get(lower);
  if (exact) return exact;

  for (const [pattern, role] of _FILENAME_PATTERNS) {
    if (pattern.test(lower)) return role;
  }

  for (const [prefix, role] of _FILENAME_PREFIXES) {
    if (lower.startsWith(prefix)) return role;
  }

  for (const pattern of _TEST_PATTERNS) {
    if (pattern.test(bn)) return 'test';
  }

  if (_DATA_EXTENSIONS.has(ext)) return 'data';
  if (_DOC_EXTENSIONS.has(ext)) return 'docs';
  if (_CONFIG_FILENAMES.has(lower)) return 'config';

  if (_CONFIG_EXTENSIONS.has(ext)) {
    const pathRole = _tier1Path(normalized);
    if (pathRole === 'test' || pathRole === 'vendored') return pathRole;
    return 'config';
  }

  return null;
}

function _tier3Content(content, ext) {
  if (!content) return null;
  const lines = content.split('\n');
  const head = lines.slice(0, 10).join('\n');
  if (_GENERATED_MARKERS.test(head)) return 'generated';
  if (lines.length && _SHEBANG_PATTERN.test(lines[0])) return 'scripts';

  if (_MINIFIABLE_EXTENSIONS.has(ext) && lines.length) {
    const nonEmpty = lines.filter(ln => ln.trim());
    if (nonEmpty.length) {
      const avgLen = nonEmpty.reduce((sum, ln) => sum + ln.length, 0) / nonEmpty.length;
      if (avgLen > _MINIFICATION_AVG_LINE_THRESHOLD) return 'generated';
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a file into a role category.
 * @param {string} path - Relative file path
 * @param {string|null} content - Optional file content for Tier 3
 * @returns {string} Role string
 */
export function classifyFile(path, content = null) {
  const normalized = path.replace(/\\/g, '/');
  const bn = basename(normalized);
  const ext = extname(bn).toLowerCase();

  // Content-based generated detection (highest priority)
  const contentRole = _tier3Content(content, ext);
  if (contentRole === 'generated') return 'generated';

  // Path-based detection
  const pathRole = _tier1Path(normalized);
  if (pathRole === 'vendored') return 'vendored';
  if (pathRole === 'test') return 'test';

  // Filename / extension based detection
  const nameRole = _tier2Filename(bn, ext, normalized);
  if (nameRole === 'test') return 'test';
  if (pathRole === 'ci' || nameRole === 'ci') return 'ci';
  if (pathRole === 'build' || nameRole === 'build') return 'build';
  if (nameRole === 'generated') return 'generated';
  if (nameRole) return nameRole;
  if (pathRole) return pathRole;
  if (contentRole) return contentRole;

  return 'source';
}

export function isTest(path) {
  const normalized = path.replace(/\\/g, '/');
  const bn = basename(normalized);
  for (const [pattern, role] of _PATH_PATTERNS) {
    if (role === 'test' && pattern.test(normalized)) return true;
  }
  for (const pattern of _TEST_PATTERNS) {
    if (pattern.test(bn)) return true;
  }
  return false;
}

export function isSource(path) {
  return classifyFile(path) === 'source';
}

export function isGenerated(path, content = null) {
  return classifyFile(path, content) === 'generated';
}

export function isVendored(path) {
  const normalized = path.replace(/\\/g, '/');
  for (const [pattern, role] of _PATH_PATTERNS) {
    if (role === 'vendored' && pattern.test(normalized)) return true;
  }
  return false;
}
