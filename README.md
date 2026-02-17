# roam-code-js

**Instant codebase comprehension for AI coding agents — zero Python dependency.**

A full 1:1 port of [roam-code](https://github.com/Cranot/roam-code) from Python to JavaScript (Node.js + ESM). Pre-indexes entire codebases into a semantic graph (SQLite) using tree-sitter, enabling AI agents to query structure, dependencies, and complexity in a single call instead of dozens of file reads.

---

## Porting Status

| Phase | Scope | Status | Files |
|-------|-------|--------|-------|
| **1. Foundation** | Index pipeline, DB, Python extractor | Done | 15 files |
| **2. Graph Analysis** | PageRank, Tarjan SCC, Louvain clusters, health/map commands | Done | 9 files |
| **3. Languages + Complexity + Git** | 8 language extractors, Halstead metrics, git stats, file roles | Done | 11 files |
| **4. Essential Commands** | 16 daily-use commands + 4 shared modules | Done | 20 files |
| **5. Advanced Commands + SARIF** | 14 new commands, SARIF 2.1.0, anomaly detection, quality gates | Done | 21 files |
| 6. Salesforce + Bridges + Workspace | Apex/Aura/VF extractors, protobuf bridge, multi-repo workspace | Planned | ~12 files |
| 7. MCP Server + Test Suite | 20+ MCP tools, 33 test files | Planned | ~35 files |
| 8. Polish | Cross-platform testing, npm publish, GitHub Action | Planned | — |

**Current:** 14,673 lines of source across 73 files. Phases 1-5 complete and verified.

---

## Supported Languages

### Dedicated Extractors (full symbol + reference extraction)

| Language | Extractor | Symbols Extracted |
|----------|-----------|-------------------|
| Python | `python.js` (615 lines) | classes, functions, methods, decorators, imports, assignments, properties, comprehensions |
| JavaScript | `javascript.js` (588 lines) | ESM/CJS imports/exports, classes, methods, arrow functions, destructuring, generators |
| TypeScript | `typescript.js` (262 lines) | extends JS + interfaces, type aliases, enums, decorators, access modifiers, generics |
| Go | `go.js` (335 lines) | functions, methods, structs, interfaces, packages, var/const, exported symbols |
| Java | `java.js` (356 lines) | classes, interfaces, enums, records, methods, constructors, fields, annotations |
| Rust | `rust.js` (439 lines) | functions, structs, enums, traits, impl blocks, modules, macros, visibility modifiers |
| C | `c.js` (347 lines) | functions, structs, unions, enums, typedefs, `#include` |
| C++ | `c.js` (extends C) | + namespaces, classes, templates, operator overloads |

### Generic Fallback (tree-sitter AST walking)

For any language with a tree-sitter grammar but no dedicated extractor, the `GenericExtractor` provides basic symbol/reference extraction:

**Ruby, PHP, C#, Kotlin, Swift, Scala, Vue, Svelte, Apex, Aura, VisualForce**

### File Extensions Supported

`.py` `.pyi` `.js` `.jsx` `.mjs` `.cjs` `.ts` `.tsx` `.mts` `.cts` `.go` `.rs` `.java` `.c` `.h` `.cpp` `.cxx` `.cc` `.hpp` `.hxx` `.hh` `.rb` `.php` `.cs` `.kt` `.kts` `.swift` `.scala` `.sc` `.cls` `.trigger` `.page` `.component` `.cmp` `.app` `.evt` `.intf` `.design` `.prg` `.scx` `.vue` `.svelte`

---

## Technology Mapping

| Python Original | JavaScript Port |
|-----------------|-----------------|
| `tree-sitter` + `tree-sitter-language-pack` | `tree-sitter` (native Node bindings) + per-language grammar packages |
| `networkx` | `graphology` + plugins (louvain, metrics, shortest-path) |
| `click` | `commander` |
| `sqlite3` | `better-sqlite3` (synchronous) |
| `pytest` | `vitest` (ESM-native) |
| `fastmcp` | `@modelcontextprotocol/sdk` |

---

## Architecture

```
roam-code-js/
  package.json                         # Dependencies + bin entry
  Dockerfile                           # Node 20 + native build tools
  docker-compose.yml                   # roam, dev, test services
  bin/
    roam.js                            # #!/usr/bin/env node entry point
  src/
    index.js                           # Package root
    cli.js                             # Commander CLI (lazy-loaded subcommands)
    db/
      schema.js                        # SQLite DDL (11 table groups)
      connection.js                    # better-sqlite3 open/close, WAL mode
      queries.js                       # Named SQL constants, batchedIn helper
    index/
      indexer.js                       # 10-stage pipeline orchestrator
      discovery.js                     # git ls-files + fs.walk fallback
      parser.js                        # tree-sitter grammar loading, Vue/Svelte SFC
      symbols.js                       # Symbol/reference normalization layer
      relations.js                     # Multi-strategy reference resolution
      incremental.js                   # SHA-256 + mtime change detection
      complexity.js                    # Cognitive complexity + Halstead metrics
      git-stats.js                     # Git log parsing, co-change, entropy
      file-roles.js                    # 3-tier file classification
      test-conventions.js              # Source <-> test bidirectional mapping
    languages/
      base.js                          # LanguageExtractor base class
      registry.js                      # Extension map + extractor cache
      python.js                        # Python extractor
      javascript.js                    # JavaScript extractor (ESM + CJS)
      typescript.js                    # TypeScript extractor (extends JS)
      go.js                            # Go extractor
      java.js                          # Java extractor
      rust.js                          # Rust extractor
      c.js                             # C + C++ extractors
      generic.js                       # GenericExtractor fallback
    graph/
      builder.js                       # buildSymbolGraph (graphology)
      pagerank.js                      # Adaptive PageRank + centrality
      clusters.js                      # Louvain community detection
      cycles.js                        # Tarjan SCC + propagation cost
      layers.js                        # Topological layering + violations
      pathfinding.js                   # Yen's k-shortest paths
    output/
      formatter.js                     # Tables, JSON envelopes
      sarif.js                         # SARIF 2.1.0 static analysis output
    analysis/
      anomaly.js                       # Statistical anomaly detection (Z-score, Mann-Kendall, CUSUM)
      gate-presets.js                  # Quality gate presets (default, strict, per-language)
      metrics-history.js               # Metrics snapshot tracking for trends
    commands/
      cmd-index.js                     # Build/rebuild index
      cmd-health.js                    # Health score 0-100 + SARIF export
      cmd-map.js                       # Codebase architecture map
      cmd-search.js                    # Search symbols by pattern
      cmd-symbol.js                    # Symbol detail with callers/callees
      cmd-file.js                      # File skeleton with symbol tree
      cmd-deps.js                      # File import/imported-by graph
      cmd-uses.js                      # All consumers of a symbol
      cmd-weather.js                   # Churn × complexity hotspots
      cmd-clusters.js                  # Louvain community analysis
      cmd-layers.js                    # Topological dependency layers
      cmd-trace.js                     # K-shortest paths (Yen's algorithm)
      cmd-context.js                   # AI-optimized symbol context
      cmd-diff.js                      # Blast radius of changes
      cmd-preflight.js                 # Pre-commit risk analysis
      cmd-dead.js                      # Unreferenced export detection + SARIF
      cmd-describe.js                  # Markdown project description
      cmd-understand.js                # Single-call project briefing
      cmd-complexity.js                # Cognitive complexity analysis + SARIF
      cmd-coupling.js                  # File co-change coupling
      cmd-fan.js                       # Fan-in/fan-out analysis
      cmd-grep.js                      # Semantic grep (names + signatures)
      cmd-risk.js                      # Composite file risk scoring
      cmd-fitness.js                   # Quality gate evaluation + SARIF
      cmd-conventions.js               # Naming convention detection + SARIF
      cmd-breaking.js                  # Breaking change detection
      cmd-coverage-gaps.js             # Untested high-value symbols
      cmd-affected-tests.js            # Test impact analysis
      cmd-pr-risk.js                   # PR risk assessment + SARIF
      cmd-trend.js                     # Metrics trends over time
      cmd-alerts.js                    # Statistical anomaly alerts
      cmd-report.js                    # Comprehensive project report (MD/JSON/SARIF)
      resolve.js                       # Symbol resolver helper
      graph-helpers.js                 # Adjacency + BFS utilities
      changed-files.js                 # Git diff file resolution
      context-helpers.js               # Data gathering for context/diff/preflight
```

### 10-Stage Indexing Pipeline

1. **Discover** — `git ls-files` or filesystem walk
2. **Detect changes** — SHA-256 hash + mtime for incremental updates
3. **Parse** — tree-sitter parsing with language-specific grammars
4. **Classify** — 3-tier file role classification (source/test/config/build/docs/generated/vendored)
5. **Extract symbols** — Language-specific AST walking for functions, classes, methods, etc.
6. **Extract references** — Imports, calls, type references, inheritance
7. **Resolve references** — Multi-strategy matching (exact, qualified, fuzzy, import-path)
8. **Build edges** — Symbol-level and file-level dependency edges
9. **Graph analysis** — PageRank, Tarjan SCC, Louvain clustering, topological layers
10. **Git analysis** — Commit history, co-change matrix, Renyi entropy, hyperedges

### Key Design Decisions

**Synchronous core pipeline.** The Python original is entirely synchronous. The JS port preserves this: `better-sqlite3` is sync, tree-sitter bindings are sync, git uses `execSync`. Only the MCP server (Phase 7) will be async.

**String-based source.** Python uses `bytes` for source code. Node.js tree-sitter `parse()` takes `string`. Standardized on strings everywhere.

**Grammar loading via `createRequire()`.** Tree-sitter grammar packages are native C addons (CJS). In our ESM project, we load them via `createRequire(import.meta.url)`.

**Custom graph algorithms.** graphology doesn't cover everything NetworkX provides. Custom implementations for Tarjan's SCC (~50 lines), condensation DAG, Kahn's topological sort, and algebraic connectivity estimation.

---

## Installation & Usage

### Docker (recommended)

```bash
# Clone and build
git clone https://github.com/Chris-ReachIndustries/roam-code-JS.git
cd roam-code-JS
docker compose build roam

# Index a project
docker compose run --rm -v /path/to/your/project:/workspace roam index

# Quick overview
docker compose run --rm -v /path/to/your/project:/workspace roam understand

# Search for a symbol
docker compose run --rm -v /path/to/your/project:/workspace roam search MyClass

# Pre-commit safety check
docker compose run --rm -v /path/to/your/project:/workspace roam preflight --staged

# Find dead code
docker compose run --rm -v /path/to/your/project:/workspace roam dead
```

### Local (requires Node.js 18+ and build tools)

```bash
npm install
cd /path/to/your/project

# Index, then query
node /path/to/roam-code-js/bin/roam.js index
node /path/to/roam-code-js/bin/roam.js understand
node /path/to/roam-code-js/bin/roam.js search MyFunction
node /path/to/roam-code-js/bin/roam.js context MyFunction --task refactor
node /path/to/roam-code-js/bin/roam.js trace SourceClass TargetClass
node /path/to/roam-code-js/bin/roam.js diff --staged --tests --coupling
```

> **Note:** Native addons (`tree-sitter`, `better-sqlite3`) require `python3`, `make`, and `g++` to compile. The Docker image includes all of these.

---

## CLI Commands (33 commands)

### Core Commands (Phases 1-3)

| Command | Description |
|---------|-------------|
| `roam index [--force] [--verbose]` | Build or rebuild the codebase index |
| `roam health [--sarif path] [--json]` | Health score 0-100 with modularity, dependencies, complexity |
| `roam map [-n count] [--full] [--json]` | Architecture overview with top symbols by PageRank |

### Query Commands (Phase 4)

| Command | Description |
|---------|-------------|
| `roam search <pattern> [--kind] [--full]` | Search symbols by name pattern, ranked by PageRank |
| `roam symbol <name> [--full]` | Symbol detail: signature, metrics, callers, callees |
| `roam file <paths...> [--changed] [--deps-of]` | File skeleton with symbol tree and kind summary |
| `roam deps <path> [--full]` | File import/imported-by graph with used symbols |
| `roam uses <name> [--full]` | All consumers of a symbol grouped by edge kind |

### Architecture Commands (Phase 4)

| Command | Description |
|---------|-------------|
| `roam clusters [--min-size]` | Louvain communities with cohesion metrics, mega-cluster detection |
| `roam layers` | Topological dependency layers with architecture classification |
| `roam trace <source> <target> [-k paths]` | K-shortest dependency paths with coupling classification |
| `roam weather [-n count]` | Code hotspots ranked by churn × complexity |

### Analysis Commands (Phase 4)

| Command | Description |
|---------|-------------|
| `roam context <names...> [--task] [--for-file]` | AI-optimized context: callers, callees, tests, blast radius |
| `roam diff [range] [--staged] [--tests] [--coupling]` | Blast radius and test impact of changed files |
| `roam preflight [target] [--staged]` | Pre-commit risk analysis with 6 automated checks |
| `roam dead [--by-directory] [--aging] [--sarif path]` | Unreferenced export detection with confidence scoring |
| `roam describe [--write] [--agent-prompt]` | Generate Markdown project description |
| `roam understand [--full]` | Single-call project briefing with all sections |

### Metrics & Quality Commands (Phase 5)

| Command | Description |
|---------|-------------|
| `roam complexity [--threshold] [--by-file] [--sarif]` | Cognitive complexity analysis with SARIF export |
| `roam coupling [paths...] [--min-strength]` | File co-change coupling with strength classification |
| `roam fan [--in\|--out] [--threshold]` | Fan-in/fan-out analysis with God-object risk detection |
| `roam grep <pattern> [--kind] [--file] [--context]` | Semantic grep across symbol names and signatures |
| `roam risk [paths...] [--top]` | Composite risk score: churn × complexity × coupling |
| `roam fitness [--preset] [--gate] [--sarif] [--snapshot]` | Quality gate evaluation (7 presets: default/strict/python/js/go/java/rust) |
| `roam conventions [--sarif]` | Naming convention violation detection |
| `roam breaking [range] [--staged]` | Breaking change detection in modified exports |
| `roam coverage-gaps [--threshold] [--top]` | High-value symbols with no test coverage |
| `roam affected-tests [range] [--staged] [--transitive]` | Test impact analysis for changed code |
| `roam pr-risk [range] [--sarif]` | Comprehensive PR risk assessment |
| `roam trend [--metric] [--last]` | Metrics trends with sparklines and Mann-Kendall test |
| `roam alerts [--threshold]` | Statistical anomaly detection (Modified Z-Score, Western Electric) |
| `roam report [--format md\|json\|sarif] [-o path]` | Full project report in Markdown, JSON, or SARIF |

All commands support `--json` for structured JSON output. Commands marked with `--sarif` can export SARIF 2.1.0 static analysis results.

---

## Smoke Test Results (Phase 5)

### Indexing (7 files, 3 languages)

```
$ roam index --force
Files: 7  Symbols: 31  Edges: 22
Languages: javascript=4, python=2, typescript=1
Avg symbols/file: 4.4  Parse coverage: 100%
```

### All 33 Commands Verified

| # | Command | Status | Sample Output |
|---|---------|--------|---------------|
| 1 | `roam index` | Pass | 7 files, 31 symbols, 22 edges |
| 2 | `roam health` | Pass | Healthy codebase (97/100), 0 critical |
| 3 | `roam map` | Pass | Top symbols by PageRank |
| 4 | `roam search Calculator` | Pass | 1 result, PR: 0.0388 |
| 5 | `roam symbol Calculator` | Pass | callers, callees, metrics |
| 6 | `roam file src/app.js` | Pass | 1 class, 1 constructor, 1 method, 1 function |
| 7 | `roam deps src/app.js` | Pass | 2 imports, used symbols |
| 8 | `roam uses Logger` | Pass | 3 consumers (call, import) |
| 9 | `roam weather` | Pass | 7 hotspots with churn × complexity |
| 10 | `roam clusters` | Pass | 4 clusters, cohesion metrics |
| 11 | `roam layers` | Pass | 4 layers, architecture classification |
| 12 | `roam trace Server fibonacci` | Pass | Paths with coupling classification |
| 13 | `roam context Calculator` | Pass | callers, tests, blast radius |
| 14 | `roam diff` | Pass | Changed file detection + blast radius |
| 15 | `roam preflight` | Pass | 6 risk checks |
| 16 | `roam dead` | Pass | 8 unreferenced exports, ~21 lines |
| 17 | `roam describe` | Pass | Markdown project description |
| 18 | `roam understand` | Pass | Full project briefing |
| 19 | `roam complexity --threshold 0` | Pass | Symbols ranked by cognitive complexity |
| 20 | `roam coupling --min-strength 1` | Pass | Co-change file pairs |
| 21 | `roam fan --threshold 1` | Pass | Fan-in/out with risk flags |
| 22 | `roam grep calc` | Pass | Semantic grep results |
| 23 | `roam risk` | Pass | Composite risk scores per file |
| 24 | `roam fitness` | Pass | Quality gate evaluation (PASS/FAIL) |
| 25 | `roam conventions` | Pass | Naming convention analysis |
| 26 | `roam breaking` | Pass | Breaking change detection |
| 27 | `roam coverage-gaps` | Pass | Untested high-value symbols |
| 28 | `roam affected-tests` | Pass | Test impact analysis |
| 29 | `roam pr-risk` | Pass | PR risk assessment |
| 30 | `roam trend` | Pass | Metrics trend analysis |
| 31 | `roam alerts` | Pass | Statistical anomaly detection |
| 32 | `roam report` | Pass | Comprehensive project report |
| 33 | `--json` (22 commands) | Pass | All produce valid JSON |

### JSON Validation (22/22 commands)

```
JSON OK: health          JSON OK: map           JSON OK: search
JSON OK: symbol          JSON OK: deps          JSON OK: uses
JSON OK: weather         JSON OK: file          JSON OK: clusters
JSON OK: layers          JSON OK: dead          JSON OK: describe
JSON OK: understand      JSON OK: complexity    JSON OK: coupling
JSON OK: fan             JSON OK: grep          JSON OK: risk
JSON OK: fitness         JSON OK: conventions   JSON OK: coverage-gaps
JSON OK: report
```

### SARIF 2.1.0 Export Validation (5/5 valid)

```
VALID: health.sarif       (health issues: cycles, god components, bottlenecks)
VALID: dead.sarif         (unreferenced exports with confidence levels)
VALID: complexity.sarif   (high cognitive complexity symbols)
VALID: fitness.sarif      (quality gate violations)
VALID: report.sarif       (combined analysis: dead code + complexity + health)
```

### Sample Command Outputs (Phase 5)

**`roam fitness`**
```
Fitness — Preset: default

Gate              Threshold  Actual  Op  Status
----------------  ---------  ------  --  ------
avg_complexity    25         0       <=  PASS
max_complexity    75         0       <=  PASS
dead_code_pct     15         3.2     <=  PASS
test_ratio        0.1        0.143   >=  PASS
cycle_count       5          0       <=  PASS

Overall: PASS (5/5 gates)
```

**`roam complexity --threshold 0`**
```
Complex symbols (CC >= 0, showing 31):

Name           Kind  CC  Nest  Params  Lines  Location
fibonacci      fn    3   1     1       4      src/calculator.py:10
...
```

**`roam risk`**
```
Risk Assessment (top 7 files):

Risk    Score  Churn  Cmplx  Coupling  Tests  Path
MEDIUM  0.450  1      0      0         0      src/app.js
LOW     0.200  0      0      0         0      src/calculator.py
...
```

### Previous Multi-Language Test (8 extractors)

```
Files: 9  Symbols: 58  Edges: 7
Languages: python=2, typescript=1, rust=1, json=1, javascript=1, java=1, go=1, c=1
```

---

## Database Schema

The `.roam/index.db` SQLite database contains:

| Table | Purpose |
|-------|---------|
| `files` | File paths, language, role, hash, line count |
| `symbols` | Functions, classes, methods with signatures, docstrings, visibility |
| `edges` | Symbol-to-symbol dependencies (call, import, inherit, reference) |
| `file_edges` | File-to-file aggregated dependencies |
| `symbol_metrics` | Cognitive complexity, Halstead metrics, nesting depth |
| `file_stats` | Per-file commit count, churn, author count, complexity |
| `clusters` | Louvain community assignments with auto-generated labels |
| `graph_metrics` | PageRank, in/out degree, betweenness centrality |
| `git_commits` | Commit hashes, authors, timestamps, messages |
| `git_file_changes` | Per-file lines added/removed per commit |
| `git_cochange` | File co-change frequency matrix |
| `git_hyperedges` | N-ary commit patterns for multi-file changes |

---

## How Language Extractors Work

Each extractor inherits from `LanguageExtractor` (base class) and implements:

```javascript
class PythonExtractor extends LanguageExtractor {
  extractSymbols(tree, source, filePath)   // -> Symbol[]
  extractReferences(tree, source, filePath) // -> Reference[]
  getDocstring(node, source)                // -> string|null
}
```

**Symbols** are named code entities: functions, classes, methods, interfaces, enums, structs, traits, modules, constants, fields, type aliases.

**References** are relationships: imports, function calls, type references, inheritance (`extends`/`implements`), attribute access.

The `GenericExtractor` provides fallback support for any language with a tree-sitter grammar by walking common AST node types (`function_definition`, `class_declaration`, `call_expression`, etc.).

### Tree-sitter API Translation (Python -> Node.js)

| Python | Node.js |
|--------|---------|
| `node.child_by_field_name("x")` | `node.childForFieldName('x')` |
| `node.start_point[0]` | `node.startPosition.row` |
| `node.end_point[0]` | `node.endPosition.row` |
| `node.start_byte` / `end_byte` | `node.startIndex` / `endIndex` |
| `node.prev_sibling` | `node.previousSibling` |
| `source[start:end].decode()` | `source.slice(startIndex, endIndex)` |
| `node.is_named` | `node.isNamed` |
| `node.children` | `node.children` (same) |

---

## Complexity Metrics

For every function/method/constructor, the indexer computes:

| Metric | Description |
|--------|-------------|
| `cognitive_complexity` | SonarSource-inspired metric with triangular nesting penalty |
| `nesting_depth` | Maximum nesting level within the function body |
| `param_count` | Number of function parameters |
| `line_count` | Lines of code in the function body |
| `return_count` | Number of return/throw/raise/yield statements |
| `bool_op_count` | Count of boolean operators (`&&`, `||`, `and`, `or`) |
| `callback_depth` | Depth of nested function/lambda definitions |
| `cyclomatic_density` | Cognitive complexity per line of code |
| `halstead_volume` | Information content (operators + operands) |
| `halstead_difficulty` | Tendency toward errors |
| `halstead_effort` | Mental effort to understand |
| `halstead_bugs` | Estimated bug count (volume / 3000) |

---

## Roadmap (Phases 6-8)

### Phase 6: Salesforce + Bridges + Workspace
- Apex, Aura, VisualForce, SFXML extractors
- Protobuf bridge (`.proto` -> generated stubs)
- Multi-repo workspace support

### Phase 7: MCP Server + Tests
- 20+ MCP tools for AI agent integration
- 33 test files mirroring the Python test suite
- vitest with `pool: 'forks'` for native addon compatibility

### Phase 8: Polish
- Cross-platform testing (Windows, macOS, Linux)
- npm publish configuration
- GitHub Action (`action.yml`)

---

## Original Project

This is a JavaScript port of [roam-code](https://github.com/Cranot/roam-code) by [@Cranot](https://github.com/Cranot). The original Python implementation provides the complete feature set that this port aims to replicate.

## License

MIT
