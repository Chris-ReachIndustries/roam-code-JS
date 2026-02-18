/**
 * Workspace CLI commands.
 * roam workspace init|add|remove|list|index
 */

import { resolve } from 'node:path';
import {
  isWorkspace, loadWorkspaceConfig, saveWorkspaceConfig,
  initWorkspace, addRepo, removeRepo, resolveRepoPaths,
} from './config.js';
import { indexWorkspace } from './indexer.js';
import { formatTable, jsonEnvelope, toJson } from '../output/formatter.js';

/**
 * roam workspace init
 */
export async function executeInit(opts, globalOpts) {
  const root = resolve('.');
  const jsonMode = globalOpts.json || false;

  if (isWorkspace(root)) {
    const existing = loadWorkspaceConfig(root);
    if (jsonMode) {
      console.log(toJson(jsonEnvelope('workspace-init', {
        status: 'already_exists',
        workspace: existing,
      })));
    } else {
      console.log(`Workspace "${existing.name}" already exists at ${root}`);
    }
    return;
  }

  const config = initWorkspace(root, opts.name || null);

  if (jsonMode) {
    console.log(toJson(jsonEnvelope('workspace-init', {
      status: 'created',
      workspace: config,
    })));
  } else {
    console.log(`Workspace "${config.name}" initialized at ${root}`);
    console.log('Add repos with: roam workspace add <path> [--alias name]');
  }
}

/**
 * roam workspace add <path>
 */
export async function executeAdd(opts, globalOpts) {
  const root = resolve('.');
  const jsonMode = globalOpts.json || false;

  let config = loadWorkspaceConfig(root);
  if (!config) {
    if (jsonMode) {
      console.log(toJson(jsonEnvelope('workspace-add', { error: 'No workspace found' })));
    } else {
      console.log('No workspace found. Run "roam workspace init" first.');
    }
    return;
  }

  try {
    const result = addRepo(config, opts.path, root, opts.alias || null);
    saveWorkspaceConfig(root, result.config);

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('workspace-add', {
        status: 'added',
        repo: result.added,
      })));
    } else {
      console.log(`Added repo "${result.added.alias}" (${result.added.path})`);
    }
  } catch (e) {
    if (jsonMode) {
      console.log(toJson(jsonEnvelope('workspace-add', { error: e.message })));
    } else {
      console.log(`Error: ${e.message}`);
    }
  }
}

/**
 * roam workspace remove <alias>
 */
export async function executeRemove(opts, globalOpts) {
  const root = resolve('.');
  const jsonMode = globalOpts.json || false;

  let config = loadWorkspaceConfig(root);
  if (!config) {
    if (jsonMode) {
      console.log(toJson(jsonEnvelope('workspace-remove', { error: 'No workspace found' })));
    } else {
      console.log('No workspace found. Run "roam workspace init" first.');
    }
    return;
  }

  try {
    config = removeRepo(config, opts.alias);
    saveWorkspaceConfig(root, config);

    if (jsonMode) {
      console.log(toJson(jsonEnvelope('workspace-remove', { status: 'removed', alias: opts.alias })));
    } else {
      console.log(`Removed repo "${opts.alias}"`);
    }
  } catch (e) {
    if (jsonMode) {
      console.log(toJson(jsonEnvelope('workspace-remove', { error: e.message })));
    } else {
      console.log(`Error: ${e.message}`);
    }
  }
}

/**
 * roam workspace list
 */
export async function executeList(opts, globalOpts) {
  const root = resolve('.');
  const jsonMode = globalOpts.json || false;

  const config = loadWorkspaceConfig(root);
  if (!config) {
    if (jsonMode) {
      console.log(toJson(jsonEnvelope('workspace-list', { error: 'No workspace found' })));
    } else {
      console.log('No workspace found. Run "roam workspace init" first.');
    }
    return;
  }

  const repos = resolveRepoPaths(root, config);

  if (jsonMode) {
    console.log(toJson(jsonEnvelope('workspace-list', {
      workspace: config.name,
      repos: repos.map(r => ({
        alias: r.alias, path: r.path,
        exists: r.exists, has_git: r.hasGit,
        status: !r.exists ? 'missing' : r.hasGit ? 'ready' : 'no-git',
      })),
    })));
  } else {
    console.log(`Workspace: ${config.name}\n`);
    if (!repos.length) {
      console.log('No repos configured. Run "roam workspace add <path>" to add repos.');
      return;
    }
    const headers = ['Alias', 'Path', 'Status'];
    const rows = repos.map(r => [
      r.alias, r.path,
      !r.exists ? 'MISSING' : r.hasGit ? 'Ready' : 'No .git',
    ]);
    console.log(formatTable(headers, rows));
  }
}

/**
 * roam workspace index
 */
export async function executeIndex(opts, globalOpts) {
  const root = resolve('.');
  await indexWorkspace(root, {
    force: opts.force || false,
    verbose: opts.verbose || false,
  });
}
