/**
 * List of all MCP tool names exposed by roam-code.
 * Separated from tools.js to allow importing without zod/SDK dependencies.
 */
export const TOOL_NAMES = [
  'understand', 'health', 'search_symbol', 'context', 'trace', 'impact',
  'file_info', 'preflight', 'dead_code', 'repo_map', 'breaking_changes',
  'affected_tests', 'pr_risk', 'complexity_report', 'coverage_gaps', 'risk',
  'clusters', 'layers', 'coupling', 'conventions', 'deps', 'uses',
];
