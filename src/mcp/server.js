/**
 * MCP Server for roam-code.
 * Exposes codebase analysis tools to AI agents via the Model Context Protocol.
 *
 * Critical design note:
 * Commands output via console.log. MCP's StdioServerTransport also uses stdout.
 * captureOutput() intercepts console methods AND process.exit during tool execution
 * to prevent protocol corruption.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { VERSION } from '../index.js';
import { registerTools } from './tools.js';
import { captureOutput } from './capture.js';

export { captureOutput };

/**
 * Create and configure the MCP server (without starting transport).
 * Useful for testing.
 */
export function createServer() {
  const server = new McpServer({
    name: 'roam-code',
    version: VERSION,
  });

  registerTools(server, captureOutput);

  // Resources
  server.resource(
    'health',
    'roam://health',
    { description: 'Current code health status as JSON' },
    async (uri) => {
      const mod = await import('../commands/cmd-health.js');
      const text = await captureOutput(() => mod.execute({}, { json: true }));
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] };
    }
  );

  server.resource(
    'summary',
    'roam://summary',
    { description: 'Project summary and architecture overview as JSON' },
    async (uri) => {
      const mod = await import('../commands/cmd-understand.js');
      const text = await captureOutput(() => mod.execute({}, { json: true }));
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] };
    }
  );

  return server;
}

/**
 * Start the MCP server with stdio transport.
 */
export async function startServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`roam-code MCP server v${VERSION} started\n`);
}
