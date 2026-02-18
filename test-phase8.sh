#!/bin/sh
# Phase 8 smoke test: npm publish readiness, GitHub Action, CI workflow
set -e

echo "=== Phase 8: Polish ==="
echo ""

# 1. Verify package.json has required npm fields
echo "--- npm metadata ---"
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
  const fields = ['name', 'version', 'description', 'repository', 'author', 'homepage', 'bugs', 'files', 'license', 'bin', 'engines'];
  let pass = true;
  for (const f of fields) {
    if (!pkg[f]) { console.error('MISSING: ' + f); pass = false; }
    else { console.log('OK: ' + f); }
  }
  if (!pass) { process.exit(1); }
"
echo "PASS: package.json metadata"

# 2. Verify files field restricts published content
echo ""
echo "--- npm pack dry-run ---"
npm pack --dry-run 2>&1 > /tmp/pack-list.txt
if grep -q 'test-phase' /tmp/pack-list.txt; then
  echo "FAIL: test-phase scripts should not be in tarball" >&2; exit 1
fi
if grep -q 'vitest.config' /tmp/pack-list.txt; then
  echo "FAIL: vitest.config should not be in tarball" >&2; exit 1
fi
if grep -q 'Dockerfile' /tmp/pack-list.txt; then
  echo "FAIL: Dockerfile should not be in tarball" >&2; exit 1
fi
echo "PASS: npm pack excludes dev files"

# 3. Verify LICENSE exists
echo ""
echo "--- LICENSE ---"
if [ -f LICENSE ]; then
  echo "PASS: LICENSE file exists"
else
  echo "FAIL: LICENSE file missing" >&2; exit 1
fi

# 4. Verify GitHub Action exists
echo ""
echo "--- GitHub Action ---"
if [ -f action.yml ]; then
  echo "PASS: action.yml exists"
else
  echo "FAIL: action.yml missing" >&2; exit 1
fi

# 5. Verify CI workflow exists
echo ""
echo "--- CI Workflow ---"
if [ -f .github/workflows/ci.yml ]; then
  echo "PASS: ci.yml exists"
else
  echo "FAIL: ci.yml missing" >&2; exit 1
fi

# 6. Run full test suite
echo ""
echo "--- Test suite ---"
npx vitest run 2>&1 | tail -5
echo ""

# 7. Verify CLI still works (regression)
echo "--- CLI regression ---"
CMD_COUNT=$(node /app/bin/roam.js --help | grep -c '  [a-z]')
echo "CLI commands: $CMD_COUNT"
if [ "$CMD_COUNT" -lt 35 ]; then
  echo "FAIL: Expected >= 35 commands" >&2; exit 1
fi
echo "PASS: CLI commands"

# 8. Source and test file counts
echo ""
echo "--- File counts ---"
SRC_COUNT=$(find /app/src -name '*.js' | wc -l)
TEST_COUNT=$(find /app/tests -name '*.test.js' | wc -l)
echo "Source files: $SRC_COUNT"
echo "Test files:   $TEST_COUNT"
echo ""

echo "=== Phase 8 smoke test PASSED ==="
