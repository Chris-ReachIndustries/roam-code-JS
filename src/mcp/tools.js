/**
 * MCP tool definitions for roam-code.
 * Each tool wraps a CLI command's execute() function.
 */

import { z } from 'zod';

/**
 * Register all roam tools on an McpServer instance.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {(fn: Function) => Promise<string>} captureOutput
 */
export function registerTools(server, captureOutput) {

  // 1. understand
  server.tool(
    'understand',
    'Get a comprehensive project briefing: structure, key symbols, health summary, and architecture overview. WHEN TO USE: Start here when first exploring a codebase or when you need a high-level understanding.',
    { full: z.boolean().optional().describe('Show extended results') },
    async ({ full }) => {
      const mod = await import('../commands/cmd-understand.js');
      const text = await captureOutput(() => mod.execute({ full: full || false }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 2. health
  server.tool(
    'health',
    'Show code health issues: dependency cycles, god components, bottleneck symbols. WHEN TO USE: When assessing code quality or looking for architectural problems.',
    { no_framework: z.boolean().optional().describe('Filter out framework/boilerplate symbols') },
    async ({ no_framework }) => {
      const mod = await import('../commands/cmd-health.js');
      const text = await captureOutput(() => mod.execute({ framework: no_framework ? false : true }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 3. search_symbol
  server.tool(
    'search_symbol',
    'Search for symbols by name pattern (case-insensitive substring match). Returns matching functions, classes, methods, etc. with their locations and reference counts. WHEN TO USE: When looking for a specific function, class, or variable by name.',
    {
      pattern: z.string().describe('Name pattern to search for'),
      kind: z.string().optional().describe('Filter by symbol kind: function, class, method, variable, etc.'),
    },
    async ({ pattern, kind }) => {
      const mod = await import('../commands/cmd-search.js');
      const text = await captureOutput(() => mod.execute({ pattern, kind: kind || null, full: true }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 4. context
  server.tool(
    'context',
    'Get detailed context for symbols: definition, callers, callees, tests, metrics, and related code. WHEN TO USE: When you need to understand how a specific symbol is used, what it depends on, and what depends on it.',
    {
      names: z.array(z.string()).describe('Symbol names to get context for'),
      task: z.enum(['refactor', 'debug', 'extend', 'review', 'understand']).optional().describe('Task mode for focused context'),
      for_file: z.boolean().optional().describe('Treat first name as a file path'),
    },
    async ({ names, task, for_file }) => {
      const mod = await import('../commands/cmd-context.js');
      const text = await captureOutput(() => mod.execute({ names, task: task || null, forFile: for_file || false }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 5. trace
  server.tool(
    'trace',
    'Find shortest dependency paths between two symbols. WHEN TO USE: When you need to understand how two parts of the codebase are connected.',
    {
      source: z.string().describe('Source symbol name'),
      target: z.string().describe('Target symbol name'),
      k: z.number().optional().describe('Number of paths to find (default: 3)'),
    },
    async ({ source, target, k }) => {
      const mod = await import('../commands/cmd-trace.js');
      const text = await captureOutput(() => mod.execute({ source, target, k: k || 3 }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 6. impact
  server.tool(
    'impact',
    'Analyze blast radius and test impact of changed files. WHEN TO USE: Before committing changes, to understand what other code might be affected.',
    {
      commit_range: z.string().optional().describe('Git commit range'),
      staged: z.boolean().optional().describe('Analyze staged changes only'),
    },
    async ({ commit_range, staged }) => {
      const mod = await import('../commands/cmd-diff.js');
      const text = await captureOutput(() => mod.execute({ commitRange: commit_range || null, staged: staged || false, full: true }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 7. file_info
  server.tool(
    'file_info',
    'Show file skeleton with all symbols defined in specific files. WHEN TO USE: When you need to understand the structure and contents of specific source files.',
    {
      paths: z.array(z.string()).describe('File paths to show'),
    },
    async ({ paths }) => {
      const mod = await import('../commands/cmd-file.js');
      const text = await captureOutput(() => mod.execute({ paths, full: true }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 8. preflight
  server.tool(
    'preflight',
    'Pre-commit risk analysis with automated checks. WHEN TO USE: Before committing, to catch potential issues early.',
    {
      target: z.string().optional().describe('Target file or path'),
      staged: z.boolean().optional().describe('Analyze staged changes only'),
    },
    async ({ target, staged }) => {
      const mod = await import('../commands/cmd-preflight.js');
      const text = await captureOutput(() => mod.execute({ target: target || null, staged: staged || false }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 9. dead_code
  server.tool(
    'dead_code',
    'Find unreferenced exported symbols (dead code candidates). WHEN TO USE: When cleaning up a codebase or looking for code to remove.',
    {
      all: z.boolean().optional().describe('Include test symbols and excluded names'),
      summary: z.boolean().optional().describe('Show summary counts only'),
    },
    async ({ all, summary }) => {
      const mod = await import('../commands/cmd-dead.js');
      const text = await captureOutput(() => mod.execute({ all: all || false, summary: summary || false }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 10. repo_map
  server.tool(
    'repo_map',
    'Show project structure: file tree, top symbols by PageRank, and dependency overview. WHEN TO USE: When you need a concise map of the most important parts of the codebase.',
    {
      count: z.number().optional().describe('Number of top symbols to show (default: 20)'),
      budget: z.number().optional().describe('Approximate token limit'),
    },
    async ({ count, budget }) => {
      const mod = await import('../commands/cmd-map.js');
      const text = await captureOutput(() => mod.execute({ count: count || 20, budget: budget || 0 }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 11. breaking_changes
  server.tool(
    'breaking_changes',
    'Detect potentially breaking changes in a diff: removed exports, changed signatures, deleted files. WHEN TO USE: When reviewing a PR or diff for backwards-compatibility issues.',
    {
      commit_range: z.string().optional().describe('Git commit range'),
      staged: z.boolean().optional().describe('Analyze staged changes only'),
    },
    async ({ commit_range, staged }) => {
      const mod = await import('../commands/cmd-breaking.js');
      const text = await captureOutput(() => mod.execute({ commitRange: commit_range || null, staged: staged || false }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 12. affected_tests
  server.tool(
    'affected_tests',
    'Find test files affected by changed code. WHEN TO USE: When you need to know which tests to run after making changes.',
    {
      commit_range: z.string().optional().describe('Git commit range'),
      staged: z.boolean().optional().describe('Analyze staged changes only'),
      transitive: z.boolean().optional().describe('Include transitive dependencies'),
    },
    async ({ commit_range, staged, transitive }) => {
      const mod = await import('../commands/cmd-affected-tests.js');
      const text = await captureOutput(() => mod.execute({ commitRange: commit_range || null, staged: staged || false, transitive: transitive || false }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 13. pr_risk
  server.tool(
    'pr_risk',
    'Comprehensive PR risk assessment: complexity, coupling, test coverage, breaking changes. WHEN TO USE: When reviewing a pull request for potential issues.',
    {
      commit_range: z.string().optional().describe('Git commit range'),
      staged: z.boolean().optional().describe('Analyze staged changes only'),
    },
    async ({ commit_range, staged }) => {
      const mod = await import('../commands/cmd-pr-risk.js');
      const text = await captureOutput(() => mod.execute({ commitRange: commit_range || null, staged: staged || false }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 14. complexity_report
  server.tool(
    'complexity_report',
    'Show symbols ranked by cognitive complexity. WHEN TO USE: When looking for overly complex code that needs refactoring.',
    {
      threshold: z.number().optional().describe('Minimum complexity threshold (default: 10)'),
      top: z.number().optional().describe('Number of results (default: 50)'),
    },
    async ({ threshold, top }) => {
      const mod = await import('../commands/cmd-complexity.js');
      const text = await captureOutput(() => mod.execute({ threshold: threshold ?? 10, top: top || 50 }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 15. coverage_gaps
  server.tool(
    'coverage_gaps',
    'Find high-value symbols with no test coverage. WHEN TO USE: When identifying what code most needs test coverage.',
    {
      threshold: z.number().optional().describe('Minimum gap score threshold (default: 0)'),
      top: z.number().optional().describe('Number of results (default: 50)'),
    },
    async ({ threshold, top }) => {
      const mod = await import('../commands/cmd-coverage-gaps.js');
      const text = await captureOutput(() => mod.execute({ threshold: threshold ?? 0, top: top || 50 }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 16. risk
  server.tool(
    'risk',
    'Show composite risk score per file based on complexity, churn, coupling, and health. WHEN TO USE: When prioritizing which files need attention or refactoring.',
    {
      paths: z.array(z.string()).optional().describe('File paths to analyze'),
      top: z.number().optional().describe('Number of results (default: 30)'),
    },
    async ({ paths, top }) => {
      const mod = await import('../commands/cmd-risk.js');
      const text = await captureOutput(() => mod.execute({ paths: paths || [], top: top || 30 }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 17. clusters
  server.tool(
    'clusters',
    'Show community clusters detected by Louvain algorithm with cohesion metrics. WHEN TO USE: When understanding the modular structure of the codebase.',
    {
      min_size: z.number().optional().describe('Minimum cluster size (default: 2)'),
    },
    async ({ min_size }) => {
      const mod = await import('../commands/cmd-clusters.js');
      const text = await captureOutput(() => mod.execute({ minSize: min_size || 2 }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 18. layers
  server.tool(
    'layers',
    'Show topological dependency layers and layer violations. WHEN TO USE: When understanding the dependency hierarchy and checking for layering violations.',
    {},
    async () => {
      const mod = await import('../commands/cmd-layers.js');
      const text = await captureOutput(() => mod.execute({}, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 19. coupling
  server.tool(
    'coupling',
    'Show co-change coupling between files based on git history. WHEN TO USE: When identifying files that frequently change together.',
    {
      paths: z.array(z.string()).optional().describe('File paths to analyze'),
      min_strength: z.number().optional().describe('Minimum co-change count (default: 3)'),
    },
    async ({ paths, min_strength }) => {
      const mod = await import('../commands/cmd-coupling.js');
      const text = await captureOutput(() => mod.execute({ paths: paths || [], minStrength: min_strength || 3 }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 20. conventions
  server.tool(
    'conventions',
    'Detect naming convention violations in the codebase. WHEN TO USE: When checking code quality and consistency of naming patterns.',
    {},
    async () => {
      const mod = await import('../commands/cmd-conventions.js');
      const text = await captureOutput(() => mod.execute({}, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 21. deps
  server.tool(
    'deps',
    'Show file import/imported-by relationships. WHEN TO USE: When understanding what a file depends on and what depends on it.',
    {
      path: z.string().describe('File path to analyze'),
    },
    async ({ path }) => {
      const mod = await import('../commands/cmd-deps.js');
      const text = await captureOutput(() => mod.execute({ path, full: true }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );

  // 22. uses
  server.tool(
    'uses',
    'Find all consumers of a symbol. WHEN TO USE: When you need to know everywhere a function, class, or variable is used.',
    {
      name: z.string().describe('Symbol name to search consumers for'),
    },
    async ({ name }) => {
      const mod = await import('../commands/cmd-uses.js');
      const text = await captureOutput(() => mod.execute({ name, full: true }, { json: true }));
      return { content: [{ type: 'text', text }] };
    }
  );
}

export { TOOL_NAMES } from './tool-names.js';
