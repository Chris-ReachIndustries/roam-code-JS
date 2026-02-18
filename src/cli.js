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
  .option('--sarif <path>', 'Export health issues to SARIF file')
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
  .option('--sarif <path>', 'Export dead code to SARIF file')
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

// --- Phase 5 Commands ---

// Complexity
program
  .command('complexity')
  .description('Show symbols ranked by cognitive complexity')
  .option('--threshold <number>', 'Minimum complexity threshold', parseInt, 10)
  .option('--top <number>', 'Number of results', parseInt, 50)
  .option('--by-file', 'Aggregate complexity per file')
  .option('--sarif <path>', 'Export to SARIF file')
  .action(async (opts) => {
    const mod = await import('./commands/cmd-complexity.js');
    await mod.execute({ ...opts, byFile: opts.byFile }, program.opts());
  });

// Coupling
program
  .command('coupling')
  .description('Show co-change coupling between files')
  .argument('[paths...]', 'File paths to analyze')
  .option('--min-strength <number>', 'Minimum co-change count', parseInt, 3)
  .option('--top <number>', 'Number of results', parseInt, 50)
  .action(async (paths, opts) => {
    const mod = await import('./commands/cmd-coupling.js');
    await mod.execute({ ...opts, paths, minStrength: opts.minStrength }, program.opts());
  });

// Fan
program
  .command('fan')
  .description('Show fan-in/fan-out metrics for symbols')
  .option('--in', 'Show only fan-in')
  .option('--out', 'Show only fan-out')
  .option('--threshold <number>', 'Minimum fan threshold', parseInt, 5)
  .option('--top <number>', 'Number of results', parseInt, 50)
  .action(async (opts) => {
    const mod = await import('./commands/cmd-fan.js');
    await mod.execute(opts, program.opts());
  });

// Grep
program
  .command('grep')
  .description('Semantic grep across symbol names, signatures, and qualified names')
  .argument('<pattern>', 'Search pattern')
  .option('-k, --kind <kind>', 'Filter by symbol kind')
  .option('--file <glob>', 'Filter by file path')
  .option('--context', 'Show callers/callees counts')
  .action(async (pattern, opts) => {
    const mod = await import('./commands/cmd-grep.js');
    await mod.execute({ ...opts, pattern }, program.opts());
  });

// Risk
program
  .command('risk')
  .description('Show composite risk score per file')
  .argument('[paths...]', 'File paths to analyze')
  .option('--top <number>', 'Number of results', parseInt, 30)
  .action(async (paths, opts) => {
    const mod = await import('./commands/cmd-risk.js');
    await mod.execute({ ...opts, paths }, program.opts());
  });

// Fitness
program
  .command('fitness')
  .description('Evaluate project fitness against quality gate presets')
  .option('--preset <name>', 'Quality gate preset name', 'default')
  .option('--gate', 'Exit with code 1 if any gate fails (for CI)')
  .option('--sarif <path>', 'Export gate violations to SARIF')
  .option('--snapshot', 'Record metrics snapshot for trend tracking')
  .action(async (opts) => {
    const mod = await import('./commands/cmd-fitness.js');
    await mod.execute(opts, program.opts());
  });

// Conventions
program
  .command('conventions')
  .description('Detect naming convention violations')
  .option('--sarif <path>', 'Export violations to SARIF')
  .action(async (opts) => {
    const mod = await import('./commands/cmd-conventions.js');
    await mod.execute(opts, program.opts());
  });

// Breaking
program
  .command('breaking')
  .description('Detect potentially breaking changes in a diff')
  .argument('[commit_range]', 'Git commit range')
  .option('--staged', 'Analyze staged changes only')
  .action(async (commitRange, opts) => {
    const mod = await import('./commands/cmd-breaking.js');
    await mod.execute({ ...opts, commitRange }, program.opts());
  });

// Coverage Gaps
program
  .command('coverage-gaps')
  .description('Find high-value symbols with no test coverage')
  .option('--threshold <number>', 'Minimum gap score threshold', parseFloat, 0)
  .option('--top <number>', 'Number of results', parseInt, 50)
  .action(async (opts) => {
    const mod = await import('./commands/cmd-coverage-gaps.js');
    await mod.execute(opts, program.opts());
  });

// Affected Tests
program
  .command('affected-tests')
  .description('Find test files affected by changed code')
  .argument('[commit_range]', 'Git commit range')
  .option('--staged', 'Analyze staged changes only')
  .option('--transitive', 'Include transitive dependencies')
  .action(async (commitRange, opts) => {
    const mod = await import('./commands/cmd-affected-tests.js');
    await mod.execute({ ...opts, commitRange }, program.opts());
  });

// PR Risk
program
  .command('pr-risk')
  .description('Comprehensive PR risk assessment')
  .argument('[commit_range]', 'Git commit range')
  .option('--staged', 'Analyze staged changes only')
  .option('--sarif <path>', 'Export risk findings to SARIF')
  .action(async (commitRange, opts) => {
    const mod = await import('./commands/cmd-pr-risk.js');
    await mod.execute({ ...opts, commitRange }, program.opts());
  });

// Trend
program
  .command('trend')
  .description('Show metrics trends over time')
  .option('--metric <name>', 'Filter by specific metric')
  .option('--last <number>', 'Number of snapshots to analyze', parseInt, 20)
  .action(async (opts) => {
    const mod = await import('./commands/cmd-trend.js');
    await mod.execute(opts, program.opts());
  });

// Alerts
program
  .command('alerts')
  .description('Detect statistical anomalies in metrics history')
  .option('--threshold <number>', 'Z-score threshold for anomaly', parseFloat, 2)
  .action(async (opts) => {
    const mod = await import('./commands/cmd-alerts.js');
    await mod.execute(opts, program.opts());
  });

// Report
program
  .command('report')
  .description('Generate comprehensive project report')
  .option('--format <format>', 'Output format: md, json, sarif', 'md')
  .option('-o, --output <path>', 'Output file path')
  .option('--preset <name>', 'Quality gate preset name', 'default')
  .action(async (opts) => {
    const mod = await import('./commands/cmd-report.js');
    await mod.execute(opts, program.opts());
  });

// --- Phase 6: Workspace Commands ---

const workspace = program
  .command('workspace')
  .description('Multi-repo workspace management');

workspace
  .command('init')
  .description('Initialize a new workspace in the current directory')
  .option('--name <name>', 'Workspace name')
  .action(async (opts) => {
    const mod = await import('./workspace/commands.js');
    await mod.executeInit(opts, program.opts());
  });

workspace
  .command('add')
  .description('Add a repository to the workspace')
  .argument('<path>', 'Path to the repository')
  .option('--alias <name>', 'Alias for the repository')
  .action(async (path, opts) => {
    const mod = await import('./workspace/commands.js');
    await mod.executeAdd({ ...opts, path }, program.opts());
  });

workspace
  .command('remove')
  .description('Remove a repository from the workspace')
  .argument('<alias>', 'Alias of the repository to remove')
  .action(async (alias, opts) => {
    const mod = await import('./workspace/commands.js');
    await mod.executeRemove({ ...opts, alias }, program.opts());
  });

workspace
  .command('list')
  .description('List configured repositories')
  .action(async (opts) => {
    const mod = await import('./workspace/commands.js');
    await mod.executeList(opts, program.opts());
  });

workspace
  .command('index')
  .description('Index all repositories in the workspace')
  .option('--force', 'Force full reindex')
  .option('--verbose', 'Show detailed output')
  .action(async (opts) => {
    const mod = await import('./workspace/commands.js');
    await mod.executeIndex(opts, program.opts());
  });

// --- Phase 7: MCP Server ---

program
  .command('mcp')
  .description('Start MCP server for AI agent integration')
  .action(async () => {
    const { startServer } = await import('./mcp/server.js');
    await startServer();
  });
