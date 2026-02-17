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
| 5. Remaining Commands + SARIF | All 70+ commands, SARIF 2.1.0 export, anomaly detection | Planned | ~45 files |
| 6. Salesforce + Bridges + Workspace | Apex/Aura/VF extractors, protobuf bridge, multi-repo workspace | Planned | ~12 files |
| 7. MCP Server + Test Suite | 20+ MCP tools, 33 test files | Planned | ~35 files |
| 8. Polish | Cross-platform testing, npm publish, GitHub Action | Planned | — |

**Current:** ~12,000 lines of source across 55 files. Phases 1-4 complete and verified.

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
    commands/
      cmd-index.js                     # Build/rebuild index
      cmd-health.js                    # Health score 0-100
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
      cmd-dead.js                      # Unreferenced export detection
      cmd-describe.js                  # Markdown project description
      cmd-understand.js                # Single-call project briefing
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
docker compose run --rm -v /path/to/your/project:/workspace roam index /workspace

# Health check
docker compose run --rm -v /path/to/your/project:/workspace roam health /workspace

# Architecture map
docker compose run --rm -v /path/to/your/project:/workspace roam map /workspace
```

### Local (requires Node.js 18+ and build tools)

```bash
npm install
node bin/roam.js index /path/to/your/project
node bin/roam.js health /path/to/your/project
node bin/roam.js map /path/to/your/project
```

> **Note:** Native addons (`tree-sitter`, `better-sqlite3`) require `python3`, `make`, and `g++` to compile. The Docker image includes all of these.

---

## CLI Commands (19 commands)

### Core Commands (Phases 1-3)

| Command | Description |
|---------|-------------|
| `roam index [--force] [--verbose]` | Build or rebuild the codebase index |
| `roam health [--json]` | Health score 0-100 with modularity, dependencies, complexity |
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
| `roam dead [--by-directory] [--aging] [--decay]` | Unreferenced export detection with confidence scoring |
| `roam describe [--write] [--agent-prompt]` | Generate Markdown project description |
| `roam understand [--full]` | Single-call project briefing with all sections |

All commands support `--json` for structured JSON output.

---

## Smoke Test Results

Multi-language test project indexed across 8 languages:

```
Files: 9  Symbols: 58  Edges: 7
Languages: python=2, typescript=1, rust=1, json=1, javascript=1, java=1, go=1, c=1
```

### Symbols extracted per language:

| Language | Count | Kinds |
|----------|-------|-------|
| TypeScript | 18 | classes, interfaces, enums, methods, fields, type aliases, constructors |
| Go | 9 | structs, interfaces, functions, methods, fields, modules |
| Java | 8 | classes, interfaces, methods, constructors, fields, modules |
| Python | 7 | classes, functions, methods, properties |
| Rust | 7 | structs, traits, methods, fields |
| JavaScript | 6 | classes, functions, methods, constructors, constants |
| C | 3 | functions, typedefs |

### Complexity metrics (AST-based):

```
fibonacci (function): cognitive=2  nesting=1  params=1  halstead_vol=92.5
multiply  (method):   cognitive=1  nesting=1  params=3  halstead_vol=62.3
Start     (method):   cognitive=1  nesting=1  params=0  halstead_vol=23.3
```

### File role classification:

```
package.json           -> config
src/Service.java       -> source
src/app.ts             -> source
src/buffer.c           -> source
src/lib.rs             -> source
src/server.go          -> source
src/utils/helpers.js   -> source
src/utils/math.py      -> source
src/utils/test_math.py -> test
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

## Roadmap (Phases 5-8)

### Phase 5: Full Command Set + SARIF
- All 70+ commands ported from Python
- SARIF 2.1.0 export for CI/CD integration
- Statistical anomaly detection (Z-score, Theil-Sen, Mann-Kendall, CUSUM)
- Quality gate presets

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
