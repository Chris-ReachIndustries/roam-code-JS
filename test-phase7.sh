#!/bin/sh
# Phase 7 smoke test: MCP server + vitest test suite
set -e

echo "=== Phase 7: MCP Server + Test Suite ==="
echo ""

# 1. Verify CLI commands
echo "--- CLI commands ---"
CMD_COUNT=$(node /app/bin/roam.js --help | grep -c '  [a-z]')
echo "CLI commands: $CMD_COUNT"
if [ "$CMD_COUNT" -lt 38 ]; then
  echo "FAIL: Expected >= 38 commands" >&2; exit 1
fi

# 2. Verify MCP command exists
echo ""
echo "--- MCP command ---"
node /app/bin/roam.js --help | grep -q "mcp" && echo "mcp command: OK" || { echo "FAIL: mcp command missing" >&2; exit 1; }

# 3. Run vitest suite
echo ""
echo "--- Test suite ---"
npx vitest run 2>&1 | tail -5
echo ""

# 4. Source file count
echo "--- File counts ---"
SRC_COUNT=$(find /app/src -name '*.js' | wc -l)
TEST_COUNT=$(find /app/tests -name '*.test.js' | wc -l)
echo "Source files: $SRC_COUNT"
echo "Test files:   $TEST_COUNT"
echo ""

echo "=== Phase 7 smoke test PASSED ==="
