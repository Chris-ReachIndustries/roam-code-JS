/**
 * Commander CLI with lazy-loaded subcommands.
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

export const program = new Command();

program
  .name('roam')
  .description('Roam: Codebase comprehension tool.')
  .version(pkg.version)
  .option('--json', 'Output in JSON format')
  .option('--compact', 'Compact output: TSV tables, minimal JSON envelope');

// Index command (Phase 1)
program
  .command('index')
  .description('Build or rebuild the codebase index.')
  .option('--force', 'Force full reindex')
  .option('--verbose', 'Show detailed warnings during indexing')
  .action(async (opts) => {
    const mod = await import('./commands/cmd-index.js');
    await mod.execute(opts, program.opts());
  });

// Health command (Phase 2)
program
  .command('health')
  .description('Show code health: cycles, god components, bottlenecks')
  .option('--no-framework', 'Filter out framework/boilerplate symbols')
  .action(async (opts) => {
    const mod = await import('./commands/cmd-health.js');
    await mod.execute(opts, program.opts());
  });

// Map command (Phase 2)
program
  .command('map')
  .description('Show project structure overview')
  .option('-n, --count <number>', 'Number of top symbols', parseInt, 20)
  .option('--full', 'Show all results without truncation')
  .option('--budget <number>', 'Approximate token limit', parseInt)
  .action(async (opts) => {
    const mod = await import('./commands/cmd-map.js');
    await mod.execute(opts, program.opts());
  });

// --- Phase 4 Commands ---

// Search
program
  .command('search')
  .description('Search symbols by name pattern')
  .argument('<pattern>', 'Name pattern to search for')
  .option('--full', 'Show all results without truncation')
  .option('-k, --kind <kind>', 'Filter by symbol kind')
  .action(async (pattern, opts) => {
    const mod = await import('./commands/cmd-search.js');
    await mod.execute({ ...opts, pattern }, program.opts());
  });

// Symbol
program
  .command('symbol')
  .description('Show symbol definition with callers, callees, and metrics')
  .argument('<name>', 'Symbol name to look up')
  .option('--full', 'Show all results without truncation')
  .action(async (name, opts) => {
    const mod = await import('./commands/cmd-symbol.js');
    await mod.execute({ ...opts, name }, program.opts());
  });

// Deps
program
  .command('deps')
  .description('Show file import/imported-by relationships')
  .argument('<path>', 'File path to analyze')
  .option('--full', 'Show all results without truncation')
  .action(async (path, opts) => {
    const mod = await import('./commands/cmd-deps.js');
    await mod.execute({ ...opts, path }, program.opts());
  });

// Uses
program
  .command('uses')
  .description('Find all consumers of a symbol')
  .argument('<name>', 'Symbol name to search consumers for')
  .option('--full', 'Show all results without truncation')
  .action(async (name, opts) => {
    const mod = await import('./commands/cmd-uses.js');
    await mod.execute({ ...opts, name }, program.opts());
  });

// Weather
program
  .command('weather')
  .description('Show code hotspots ranked by churn × complexity')
  .option('-n, --count <number>', 'Number of hotspots to show', parseInt, 20)
  .action(async (opts) => {
    const mod = await import('./commands/cmd-weather.js');
    await mod.execute(opts, program.opts());
  });

// File
program
  .command('file')
  .description('Show file skeleton with symbols')
  .argument('[paths...]', 'File paths to show')
  .option('--full', 'Show all symbols without truncation')
  .option('--changed', 'Show changed files from git')
  .option('--deps-of <symbol>', 'Show file dependencies of a symbol')
  .action(async (paths, opts) => {
    const mod = await import('./commands/cmd-file.js');
    await mod.execute({ ...opts, paths }, program.opts());
  });

// Clusters
program
  .command('clusters')
  .description('Show Louvain community clusters with cohesion metrics')
  .option('--min-size <number>', 'Minimum cluster size', parseInt, 2)
  .action(async (opts) => {
    const mod = await import('./commands/cmd-clusters.js');
    await mod.execute({ minSize: opts.minSize, ...opts }, program.opts());
  });

// Layers
program
  .command('layers')
  .description('Show topological dependency layers')
  .action(async (opts) => {
    const mod = await import('./commands/cmd-layers.js');
    await mod.execute(opts, program.opts());
  });

// Trace
program
  .command('trace')
  .description('Find shortest dependency paths between two symbols')
  .argument('<source>', 'Source symbol name')
  .argument('<target>', 'Target symbol name')
  .option('-k, --k <number>', 'Number of paths to find', parseInt, 3)
  .action(async (source, target, opts) => {
    const mod = await import('./commands/cmd-trace.js');
    await mod.execute({ ...opts, source, target }, program.opts());
  });

// Context
program
  .command('context')
  .description('Show symbol context with callers, callees, tests, and metrics')
  .argument('[names...]', 'Symbol names to get context for')
  .option('--task <task>', 'Task mode: refactor, debug, extend, review, understand')
  .option('--for-file', 'Treat first argument as a file path')
  .action(async (names, opts) => {
    const mod = await import('./commands/cmd-context.js');
    await mod.execute({ ...opts, names, forFile: opts.forFile }, program.opts());
  });

// Diff
program
  .command('diff')
  .description('Analyze blast radius and test impact of changed files')
  .argument('[commit_range]', 'Git commit range')
  .option('--staged', 'Analyze staged changes only')
  .option('--full', 'Show all results without truncation')
  .option('--tests', 'Show affected tests')
  .option('--coupling', 'Show missing co-change partners')
  .action(async (commitRange, opts) => {
    const mod = await import('./commands/cmd-diff.js');
    await mod.execute({ ...opts, commitRange }, program.opts());
  });

// Preflight
program
  .command('preflight')
  .description('Pre-commit risk analysis with automated checks')
  .argument('[target]', 'Target file or path')
  .option('--staged', 'Analyze staged changes only')
  .action(async (target, opts) => {
    const mod = await import('./commands/cmd-preflight.js');
    await mod.execute({ ...opts, target }, program.opts());
  });

// Dead
program
  .command('dead')
  .description('Find unreferenced exported symbols (dead code)')
  .option('--all', 'Include test symbols and excluded names')
  .option('--by-directory', 'Group results by directory')
  .option('--by-kind', 'Group results by symbol kind')
  .option('--summary', 'Show summary counts only')
  .option('--aging', 'Show symbol age from git blame')
  .option('--effort', 'Show removal effort estimate')
  .option('--decay', 'Show decay priority score')
  .option('--clusters', 'Show connected dead code clusters')
  .action(async (opts) => {
    const mod = await import('./commands/cmd-dead.js');
    await mod.execute({
      ...opts,
      byDirectory: opts.byDirectory,
      byKind: opts.byKind,
    }, program.opts());
  });

// Describe
program
  .command('describe')
  .description('Generate Markdown project description')
  .option('--write', 'Write to ROAM_DESCRIBE.md')
  .option('--force', 'Overwrite existing file')
  .option('--agent-prompt', 'Generate compact agent prompt (<500 tokens)')
  .option('-o, --output <file>', 'Output file path')
  .action(async (opts) => {
    const mod = await import('./commands/cmd-describe.js');
    await mod.execute({ ...opts, agentPrompt: opts.agentPrompt }, program.opts());
  });

// Understand
program
  .command('understand')
  .description('Single-call project briefing with all key sections')
  .option('--full', 'Show extended results')
  .action(async (opts) => {
    const mod = await import('./commands/cmd-understand.js');
    await mod.execute(opts, program.opts());
  });
