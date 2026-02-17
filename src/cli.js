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

// Placeholder commands for future phases -- registered lazily
const FUTURE_COMMANDS = {
  'understand':  'Single-call codebase comprehension',
  'context':     'Get minimal context to safely modify a symbol',
  'describe':    'Full symbol documentation',
  'diff':        'Show blast radius of uncommitted changes',
  'preflight':   'Compound pre-change safety check',
  'search':      'Search symbols by name',
  'symbol':      'Look up a symbol',
  'file':        'Show file contents and metadata',
  'trace':       'Trace dependency path between symbols',
  'deps':        'Show dependencies of a symbol',
  'uses':        'Show what uses a symbol',
  'dead':        'Find dead/unused code',
  'clusters':    'Show community clusters',
  'layers':      'Show architectural layers',
  'weather':     'Health at a glance',
  'complexity':  'Show per-symbol complexity metrics',
  'pr-risk':     'Risk assessment for PR changes',
  'affected-tests': 'Which tests touch changed code',
};

for (const [name, description] of Object.entries(FUTURE_COMMANDS)) {
  program
    .command(name)
    .description(description)
    .allowUnknownOption(true)
    .action(async () => {
      console.error(`Command '${name}' is not yet implemented. Coming in Phase 2+.`);
      process.exit(1);
    });
}
