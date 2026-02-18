#!/usr/bin/env node

/**
 * Standalone MCP entry point for roam-code.
 * Use this in claude_desktop_config.json or similar MCP client configurations.
 */

import { startServer } from '../src/mcp/server.js';

startServer().catch(err => {
  process.stderr.write(`MCP server error: ${err.message}\n`);
  process.exit(1);
});
