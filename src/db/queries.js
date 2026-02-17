/** Named SQL query constants used across commands. */

// File queries
export const FILE_BY_PATH = 'SELECT * FROM files WHERE path = ?';
export const FILE_BY_ID = 'SELECT * FROM files WHERE id = ?';
export const ALL_FILES = 'SELECT * FROM files ORDER BY path';
export const FILES_BY_LANGUAGE = 'SELECT * FROM files WHERE language = ? ORDER BY path';
export const FILE_COUNT = 'SELECT COUNT(*) as cnt FROM files';

// Symbol queries
export const SYMBOLS_IN_FILE = `
    SELECT s.*, f.path as file_path
    FROM symbols s JOIN files f ON s.file_id = f.id
    WHERE s.file_id = ? ORDER BY s.line_start
`;
export const SYMBOL_BY_NAME = `
    SELECT s.*, f.path as file_path
    FROM symbols s JOIN files f ON s.file_id = f.id
    WHERE s.name = ?
`;
export const SYMBOL_BY_QUALIFIED = `
    SELECT s.*, f.path as file_path
    FROM symbols s JOIN files f ON s.file_id = f.id
    WHERE s.qualified_name = ?
`;
export const SYMBOL_BY_ID = `
    SELECT s.*, f.path as file_path
    FROM symbols s JOIN files f ON s.file_id = f.id
    WHERE s.id = ?
`;
export const SEARCH_SYMBOLS = `
    SELECT s.*, f.path as file_path, COALESCE(gm.pagerank, 0) as pagerank
    FROM symbols s JOIN files f ON s.file_id = f.id
    LEFT JOIN graph_metrics gm ON s.id = gm.symbol_id
    WHERE s.name LIKE ? COLLATE NOCASE
    ORDER BY COALESCE(gm.pagerank, 0) DESC, s.name LIMIT ?
`;
export const EXPORTED_SYMBOLS = `
    SELECT s.*, f.path as file_path
    FROM symbols s JOIN files f ON s.file_id = f.id
    WHERE s.is_exported = 1 ORDER BY f.path, s.line_start
`;
export const TOP_SYMBOLS_BY_PAGERANK = `
    SELECT s.*, f.path as file_path, gm.pagerank
    FROM symbols s
    JOIN files f ON s.file_id = f.id
    JOIN graph_metrics gm ON s.id = gm.symbol_id
    WHERE s.kind IN ('function', 'class', 'method', 'interface')
    ORDER BY gm.pagerank DESC LIMIT ?
`;

// Edge queries
export const CALLERS_OF = `
    SELECT s.*, f.path as file_path, e.kind as edge_kind, e.line as edge_line
    FROM edges e
    JOIN symbols s ON e.source_id = s.id
    JOIN files f ON s.file_id = f.id
    WHERE e.target_id = ?
`;
export const CALLEES_OF = `
    SELECT s.*, f.path as file_path, e.kind as edge_kind, e.line as edge_line
    FROM edges e
    JOIN symbols s ON e.target_id = s.id
    JOIN files f ON s.file_id = f.id
    WHERE e.source_id = ?
`;
export const ALL_EDGES = 'SELECT * FROM edges';

// File edge queries
export const FILE_IMPORTS = `
    SELECT f.*, SUM(fe.symbol_count) as symbol_count
    FROM file_edges fe JOIN files f ON fe.target_file_id = f.id
    WHERE fe.source_file_id = ?
    GROUP BY fe.target_file_id
`;
export const FILE_IMPORTED_BY = `
    SELECT f.*, SUM(fe.symbol_count) as symbol_count
    FROM file_edges fe JOIN files f ON fe.source_file_id = f.id
    WHERE fe.target_file_id = ?
    GROUP BY fe.source_file_id
`;
export const ALL_FILE_EDGES = 'SELECT * FROM file_edges';

// Graph metrics
export const METRICS_FOR_SYMBOL = 'SELECT * FROM graph_metrics WHERE symbol_id = ?';
export const TOP_BY_BETWEENNESS = `
    SELECT s.*, f.path as file_path, gm.*
    FROM graph_metrics gm
    JOIN symbols s ON gm.symbol_id = s.id
    JOIN files f ON s.file_id = f.id
    ORDER BY gm.betweenness DESC LIMIT ?
`;
export const TOP_BY_DEGREE = `
    SELECT s.*, f.path as file_path, gm.*
    FROM graph_metrics gm
    JOIN symbols s ON gm.symbol_id = s.id
    JOIN files f ON s.file_id = f.id
    ORDER BY (gm.in_degree + gm.out_degree) DESC LIMIT ?
`;

// Cluster queries
export const CLUSTER_FOR_SYMBOL = 'SELECT * FROM clusters WHERE symbol_id = ?';
export const ALL_CLUSTERS = `
    SELECT c.cluster_id, c.cluster_label, COUNT(*) as size,
           GROUP_CONCAT(s.name, ', ') as members
    FROM clusters c JOIN symbols s ON c.symbol_id = s.id
    GROUP BY c.cluster_id ORDER BY size DESC
`;

// Git queries
export const FILE_STATS_BY_ID = 'SELECT * FROM file_stats WHERE file_id = ?';
export const TOP_CHURN_FILES = `
    SELECT fs.*, f.path, f.language
    FROM file_stats fs JOIN files f ON fs.file_id = f.id
    ORDER BY fs.total_churn DESC LIMIT ?
`;
export const COCHANGE_FOR_FILE = `
    SELECT f.path, gc.cochange_count
    FROM git_cochange gc JOIN files f ON (
        CASE WHEN gc.file_id_a = ? THEN gc.file_id_b ELSE gc.file_id_a END
    ) = f.id
    WHERE gc.file_id_a = ? OR gc.file_id_b = ?
    ORDER BY gc.cochange_count DESC LIMIT ?
`;
export const BLAME_FOR_FILE = `
    SELECT gc.author, gc.message, gc.timestamp, gfc.lines_added, gfc.lines_removed
    FROM git_file_changes gfc
    JOIN git_commits gc ON gfc.commit_id = gc.id
    WHERE gfc.file_id = ?
    ORDER BY gc.timestamp DESC
`;

// Dead code
export const UNREFERENCED_EXPORTS = `
    SELECT s.*, f.path as file_path
    FROM symbols s
    JOIN files f ON s.file_id = f.id
    WHERE s.is_exported = 1
    AND s.id NOT IN (SELECT target_id FROM edges)
    AND s.kind IN ('function', 'class', 'method')
    ORDER BY f.path, s.line_start
`;

// Directory / module queries
export const FILES_IN_DIR = "SELECT * FROM files WHERE path LIKE ? ORDER BY path";
export const SYMBOLS_IN_DIR = `
    SELECT s.*, f.path as file_path
    FROM symbols s JOIN files f ON s.file_id = f.id
    WHERE f.path LIKE ? AND s.is_exported = 1
    ORDER BY f.path, s.line_start
`;

// Phase 4 additions

// Complexity metrics per symbol
export const SYMBOL_METRICS = 'SELECT * FROM symbol_metrics WHERE symbol_id = ?';

// Cluster members with PageRank
export const CLUSTER_MEMBERS = `
    SELECT s.id, s.name, s.kind, f.path as file_path, COALESCE(gm.pagerank, 0) as pagerank
    FROM clusters c
    JOIN symbols s ON c.symbol_id = s.id
    JOIN files f ON s.file_id = f.id
    LEFT JOIN graph_metrics gm ON s.id = gm.symbol_id
    WHERE c.cluster_id = ?
    ORDER BY COALESCE(gm.pagerank, 0) DESC
`;

// File stats by path
export const FILE_STATS_BY_PATH = `
    SELECT fs.*, f.path, f.language
    FROM file_stats fs JOIN files f ON fs.file_id = f.id
    WHERE f.path = ?
`;

// Distribution queries
export const LANGUAGE_DISTRIBUTION = `
    SELECT language, COUNT(*) as cnt FROM files
    WHERE language IS NOT NULL
    GROUP BY language ORDER BY cnt DESC
`;
export const SYMBOL_KIND_DISTRIBUTION = `
    SELECT kind, COUNT(*) as cnt FROM symbols
    GROUP BY kind ORDER BY cnt DESC
`;

// All symbols with file + optional PageRank (for batch lookups)
export const ALL_SYMBOLS_WITH_FILE = `
    SELECT s.*, f.path as file_path
    FROM symbols s JOIN files f ON s.file_id = f.id
`;

// File search (fuzzy)
export const FILE_SEARCH = `
    SELECT * FROM files WHERE path LIKE ? ORDER BY path LIMIT ?
`;
