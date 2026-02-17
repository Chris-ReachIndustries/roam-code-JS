/**
 * Build graphology graphs from the Roam SQLite index.
 */

import Graph from 'graphology';
const { DirectedGraph } = Graph;

/**
 * Build a directed graph from symbol edges.
 * Nodes are symbol IDs with attributes: name, kind, file_path, qualified_name.
 * Edges carry a `kind` attribute.
 */
export function buildSymbolGraph(db) {
  const G = new DirectedGraph();

  // Load nodes
  const nodes = db.prepare(
    'SELECT s.id, s.name, s.kind, s.qualified_name, f.path AS file_path ' +
    'FROM symbols s JOIN files f ON s.file_id = f.id'
  ).all();
  for (const row of nodes) {
    G.addNode(row.id, {
      name: row.name,
      kind: row.kind,
      qualified_name: row.qualified_name,
      file_path: row.file_path,
    });
  }

  // Load edges
  const edges = db.prepare('SELECT source_id, target_id, kind FROM edges').all();
  for (const { source_id, target_id, kind } of edges) {
    if (G.hasNode(source_id) && G.hasNode(target_id)) {
      // graphology doesn't allow duplicate edges by default; use mergeEdge
      G.mergeEdge(source_id, target_id, { kind });
    }
  }

  return G;
}

/**
 * Build a directed graph from file-level edges.
 * Nodes are file IDs with attributes: path, language.
 * Edges carry `kind` and `symbol_count` attributes.
 */
export function buildFileGraph(db) {
  const G = new DirectedGraph();

  const files = db.prepare('SELECT id, path, language FROM files').all();
  for (const { id, path, language } of files) {
    G.addNode(id, { path, language });
  }

  const edges = db.prepare(
    'SELECT source_file_id, target_file_id, kind, symbol_count FROM file_edges'
  ).all();
  for (const { source_file_id, target_file_id, kind, symbol_count } of edges) {
    if (G.hasNode(source_file_id) && G.hasNode(target_file_id)) {
      G.mergeEdge(source_file_id, target_file_id, { kind, symbol_count });
    }
  }

  return G;
}
