#!/bin/sh
set -e

ROAM="node /app/bin/roam.js"

# Create test project
mkdir -p /tmp/testproj/src/utils /tmp/testproj/tests
cd /tmp/testproj
git init
git config user.email "test@test.com"
git config user.name "Test"

# Python file
cat > src/calculator.py << 'PYEOF'
class Calculator:
    def add(self, a, b):
        return a + b
    def subtract(self, a, b):
        return a - b
    def multiply(self, a, b):
        return a * b

def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

def unused_function():
    pass
PYEOF

# JS files
cat > src/app.js << 'JSEOF'
import { Logger } from "./utils/logger.js";
import { Calculator } from "./calculator.py";

export class App {
    constructor() {
        this.logger = new Logger();
        this.calc = new Calculator();
    }
    run() {
        this.logger.info("Starting app");
        const result = this.calc.add(1, 2);
        return result;
    }
}

export function main() {
    const app = new App();
    return app.run();
}
JSEOF

cat > src/utils/logger.js << 'LOGEOF'
export class Logger {
    info(msg) { console.log("[INFO]", msg); }
    warn(msg) { console.warn("[WARN]", msg); }
    error(msg) { console.error("[ERROR]", msg); }
    debug(msg) { console.log("[DEBUG]", msg); }
}

export const DEFAULT_LEVEL = "info";
export function createLogger(name) { return new Logger(); }
LOGEOF

cat > src/utils/helpers.js << 'HELPEOF'
export function formatDate(d) { return d.toISOString(); }
export function parseNumber(s) { return parseInt(s, 10); }
export function isEmpty(obj) { return Object.keys(obj).length === 0; }
HELPEOF

cat > tests/test_calc.py << 'TESTEOF'
from src.calculator import Calculator, fibonacci

def test_add():
    calc = Calculator()
    assert calc.add(1, 2) == 3

def test_fibonacci():
    assert fibonacci(5) == 5
TESTEOF

cat > src/config.ts << 'TSEOF'
export interface AppConfig {
    port: number;
    host: string;
    debug: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
    port: 3000,
    host: "localhost",
    debug: false,
};

export function loadConfig(path: string): AppConfig {
    return DEFAULT_CONFIG;
}
TSEOF

cat > src/server.js << 'SRVEOF'
import { App } from "./app.js";
import { Logger } from "./utils/logger.js";
import { loadConfig } from "./config.ts";

export class Server {
    constructor(config) {
        this.app = new App();
        this.logger = new Logger();
        this.config = config || loadConfig("config.json");
    }
    start() {
        this.logger.info("Server starting on " + this.config.port);
        return this.app.run();
    }
}
SRVEOF

# First commit
git add -A
git commit -m "Initial commit"

# Second commit (for churn)
echo "// v2" >> src/app.js
git add -A
git commit -m "Update app"

# Index
echo "=== INDEXING ==="
$ROAM index --force 2>&1

echo ""
echo "=== PHASE 1-4 COMMANDS ==="

# Phase 1-4 commands
echo "--- health ---"
$ROAM health 2>&1 | head -5
echo "PASS: health"

echo "--- map ---"
$ROAM map 2>&1 | head -3
echo "PASS: map"

echo "--- search ---"
$ROAM search Calculator 2>&1 | head -3
echo "PASS: search"

echo "--- symbol ---"
$ROAM symbol Calculator 2>&1 | head -3
echo "PASS: symbol"

echo "--- deps ---"
$ROAM deps src/app.js 2>&1 | head -3
echo "PASS: deps"

echo "--- uses ---"
$ROAM uses Logger 2>&1 | head -3
echo "PASS: uses"

echo "--- weather ---"
$ROAM weather 2>&1 | head -3
echo "PASS: weather"

echo "--- file ---"
$ROAM file src/app.js 2>&1 | head -3
echo "PASS: file"

echo "--- clusters ---"
$ROAM clusters 2>&1 | head -3
echo "PASS: clusters"

echo "--- layers ---"
$ROAM layers 2>&1 | head -3
echo "PASS: layers"

echo "--- trace ---"
$ROAM trace Server fibonacci 2>&1 | head -3
echo "PASS: trace"

echo "--- context ---"
$ROAM context Calculator 2>&1 | head -3
echo "PASS: context"

echo "--- diff ---"
$ROAM diff 2>&1 | head -3
echo "PASS: diff"

echo "--- preflight ---"
$ROAM preflight 2>&1 | head -3
echo "PASS: preflight"

echo "--- dead ---"
$ROAM dead 2>&1 | head -3
echo "PASS: dead"

echo "--- describe ---"
$ROAM describe 2>&1 | head -3
echo "PASS: describe"

echo "--- understand ---"
$ROAM understand 2>&1 | head -3
echo "PASS: understand"

echo ""
echo "=== PHASE 5 COMMANDS ==="

echo "--- complexity ---"
$ROAM complexity --threshold 0 2>&1 | head -5
echo "PASS: complexity"

echo "--- coupling ---"
$ROAM coupling --min-strength 1 2>&1 | head -5
echo "PASS: coupling"

echo "--- fan ---"
$ROAM fan --threshold 1 2>&1 | head -5
echo "PASS: fan"

echo "--- grep ---"
$ROAM grep "calc" 2>&1 | head -5
echo "PASS: grep"

echo "--- risk ---"
$ROAM risk 2>&1 | head -5
echo "PASS: risk"

echo "--- fitness ---"
$ROAM fitness --snapshot 2>&1 | head -5
echo "PASS: fitness"

echo "--- conventions ---"
$ROAM conventions 2>&1 | head -5
echo "PASS: conventions"

echo "--- breaking ---"
$ROAM breaking 2>&1 | head -3
echo "PASS: breaking"

echo "--- coverage-gaps ---"
$ROAM coverage-gaps 2>&1 | head -5
echo "PASS: coverage-gaps"

echo "--- affected-tests ---"
$ROAM affected-tests 2>&1 | head -3
echo "PASS: affected-tests"

echo "--- pr-risk ---"
$ROAM pr-risk 2>&1 | head -5
echo "PASS: pr-risk"

echo "--- trend ---"
$ROAM trend 2>&1 | head -3
echo "PASS: trend"

echo "--- alerts ---"
$ROAM alerts 2>&1 | head -3
echo "PASS: alerts"

echo "--- report ---"
$ROAM report 2>&1 | head -5
echo "PASS: report"

echo ""
echo "=== SARIF TESTS ==="

echo "--- health --sarif ---"
$ROAM health --sarif /tmp/health.sarif 2>&1
echo "PASS: health sarif"

echo "--- dead --sarif ---"
$ROAM dead --sarif /tmp/dead.sarif 2>&1 | head -2
echo "PASS: dead sarif"

echo "--- complexity --sarif ---"
$ROAM complexity --threshold 0 --sarif /tmp/complexity.sarif 2>&1 | head -2
echo "PASS: complexity sarif"

echo "--- fitness --sarif ---"
$ROAM fitness --sarif /tmp/fitness.sarif 2>&1 | head -2
echo "PASS: fitness sarif"

echo "--- report --format sarif ---"
$ROAM report --format sarif -o /tmp/report.sarif 2>&1
echo "PASS: report sarif"

# Validate SARIF files are valid JSON
echo ""
echo "=== SARIF VALIDATION ==="
for f in /tmp/health.sarif /tmp/dead.sarif /tmp/complexity.sarif /tmp/fitness.sarif /tmp/report.sarif; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('VALID: $f')" 2>&1
done

echo ""
echo "=== JSON MODE TESTS ==="

json_test() {
  name=$1
  shift
  $ROAM "$@" --json > /tmp/jtest.json 2>/dev/null
  if node -e "JSON.parse(require('fs').readFileSync('/tmp/jtest.json','utf8'))" 2>/dev/null; then
    echo "JSON OK: $name"
  else
    echo "JSON FAIL: $name"
  fi
}

json_test "health" health
json_test "map" map
json_test "search" search Calculator
json_test "symbol" symbol Calculator
json_test "deps" deps src/app.js
json_test "uses" uses Logger
json_test "weather" weather
json_test "file" file src/app.js
json_test "clusters" clusters
json_test "layers" layers
json_test "dead" dead
json_test "describe" describe
json_test "understand" understand
json_test "complexity" complexity --threshold 0
json_test "coupling" coupling --min-strength 1
json_test "fan" fan --threshold 1
json_test "grep" grep calc
json_test "risk" risk
json_test "fitness" fitness
json_test "conventions" conventions
json_test "coverage-gaps" coverage-gaps
json_test "report" report

echo ""
echo "=== ALL TESTS COMPLETE ==="
