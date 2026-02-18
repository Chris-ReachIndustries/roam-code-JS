/**
 * Workspace configuration management.
 * Handles .roam/workspace.json for multi-repo indexing.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const WORKSPACE_FILE = 'workspace.json';
const ROAM_DIR = '.roam';

/**
 * Check if a directory is a workspace root.
 * @param {string} root
 * @returns {boolean}
 */
export function isWorkspace(root) {
  return existsSync(join(root, ROAM_DIR, WORKSPACE_FILE));
}

/**
 * Load workspace configuration.
 * @param {string} root - Workspace root directory
 * @returns {object|null} Workspace config or null
 */
export function loadWorkspaceConfig(root) {
  const configPath = join(root, ROAM_DIR, WORKSPACE_FILE);
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Save workspace configuration.
 * @param {string} root - Workspace root directory
 * @param {object} config - Workspace config object
 */
export function saveWorkspaceConfig(root, config) {
  const roamDir = join(root, ROAM_DIR);
  mkdirSync(roamDir, { recursive: true });
  const configPath = join(roamDir, WORKSPACE_FILE);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Create a new workspace configuration.
 * @param {string} root - Workspace root directory
 * @param {string} [name] - Workspace name (defaults to directory basename)
 * @returns {object} The new config
 */
export function initWorkspace(root, name = null) {
  const config = {
    name: name || basename(resolve(root)),
    repos: [],
  };
  saveWorkspaceConfig(root, config);
  return config;
}

/**
 * Add a repo to the workspace configuration.
 * @param {object} config - Workspace config
 * @param {string} repoPath - Relative or absolute path to the repo
 * @param {string} root - Workspace root (for resolving relative paths)
 * @param {string} [alias] - Optional alias (defaults to directory basename)
 * @returns {{ config: object, added: object }} Updated config and added repo entry
 */
export function addRepo(config, repoPath, root, alias = null) {
  const absPath = resolve(root, repoPath);
  const relPath = repoPath.startsWith('/') || repoPath.includes(':')
    ? repoPath
    : repoPath.replace(/\\/g, '/');

  const repoAlias = alias || basename(absPath);

  // Check for duplicate alias
  if (config.repos.some(r => r.alias === repoAlias)) {
    throw new Error(`Repo alias "${repoAlias}" already exists in workspace`);
  }

  const entry = { path: relPath, alias: repoAlias };
  config.repos.push(entry);
  return { config, added: entry };
}

/**
 * Remove a repo from the workspace configuration by alias.
 * @param {object} config - Workspace config
 * @param {string} alias - Repo alias to remove
 * @returns {object} Updated config
 */
export function removeRepo(config, alias) {
  const idx = config.repos.findIndex(r => r.alias === alias);
  if (idx === -1) throw new Error(`Repo alias "${alias}" not found in workspace`);
  config.repos.splice(idx, 1);
  return config;
}

/**
 * Resolve repo paths to absolute paths with validation.
 * @param {string} root - Workspace root directory
 * @param {object} config - Workspace config
 * @returns {{ alias: string, path: string, absPath: string, exists: boolean, hasGit: boolean }[]}
 */
export function resolveRepoPaths(root, config) {
  return config.repos.map(repo => {
    const absPath = resolve(root, repo.path);
    const exists = existsSync(absPath);
    const hasGit = exists && existsSync(join(absPath, '.git'));
    return {
      alias: repo.alias,
      path: repo.path,
      absPath,
      exists,
      hasGit,
    };
  });
}

/**
 * Get the alias for a repo path.
 * @param {object} config
 * @param {string} repoPath
 * @returns {string|null}
 */
export function getRepoAlias(config, repoPath) {
  const entry = config.repos.find(r => r.path === repoPath);
  return entry ? entry.alias : null;
}
