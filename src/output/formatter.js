/**
 * Token-efficient text formatting for AI consumption.
 */

import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { findProjectRoot, getDbPath } from '../db/connection.js';
import { VERSION } from '../index.js';

export const KIND_ABBREV = {
  function: 'fn',
  class: 'cls',
  method: 'meth',
  variable: 'var',
  constant: 'const',
  interface: 'iface',
  struct: 'struct',
  enum: 'enum',
  module: 'mod',
  package: 'pkg',
  trait: 'trait',
  type_alias: 'type',
  property: 'prop',
  field: 'field',
  constructor: 'ctor',
  decorator: 'deco',
};

export function abbrevKind(kind) {
  return KIND_ABBREV[kind] || kind;
}

export function loc(path, line = null) {
  if (line != null) return `${path}:${line}`;
  return path;
}

export function symbolLine(name, kind, signature, path, line = null, extra = '') {
  const parts = [abbrevKind(kind), name];
  if (signature) parts.push(signature);
  parts.push(loc(path, line));
  if (extra) parts.push(extra);
  return parts.join('  ');
}

export function section(title, lines, budget = 0) {
  const out = [title];
  if (budget && lines.length > budget) {
    out.push(...lines.slice(0, budget));
    out.push(`  (+${lines.length - budget} more)`);
  } else {
    out.push(...lines);
  }
  return out.join('\n');
}

export function indent(text, level = 1) {
  const prefix = '  '.repeat(level);
  return text.split('\n').map(line => prefix + line).join('\n');
}

export function truncateLines(lines, budget) {
  if (lines.length <= budget) return lines;
  return [...lines.slice(0, budget), `(+${lines.length - budget} more)`];
}

export function formatSignature(sig, maxLen = 80) {
  if (!sig) return '';
  sig = sig.trim();
  if (sig.length > maxLen) return sig.slice(0, maxLen - 3) + '...';
  return sig;
}

export function formatEdgeKind(kind) {
  return kind.replace(/_/g, ' ');
}

export function formatTable(headers, rows, budget = 0) {
  if (!rows.length) return '(none)';
  const widths = headers.map(h => h.length);
  for (const row of rows) {
    for (let i = 0; i < row.length && i < widths.length; i++) {
      widths[i] = Math.max(widths[i], String(row[i]).length);
    }
  }
  const lines = [];
  lines.push(headers.map((h, i) => h.padEnd(widths[i])).join('  '));
  lines.push(widths.map(w => '-'.repeat(w)).join('  '));
  const displayRows = budget && rows.length > budget ? rows.slice(0, budget) : rows;
  for (const row of displayRows) {
    lines.push(row.map((cell, i) => String(cell).padEnd(widths[i])).join('  '));
  }
  if (budget && rows.length > budget) {
    lines.push(`(+${rows.length - budget} more)`);
  }
  return lines.join('\n');
}

export function toJson(data) {
  return JSON.stringify(data, null, 2);
}

export function jsonEnvelope(command, { summary = null, ...payload } = {}) {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out = {
    command,
    version: VERSION,
    timestamp: ts,
    index_age_s: indexAgeSeconds(),
    project: projectName(),
    summary: summary || {},
  };
  Object.assign(out, payload);
  return out;
}

function indexAgeSeconds() {
  try {
    const dbPath = getDbPath();
    if (existsSync(dbPath)) {
      return Math.floor(Date.now() / 1000 - statSync(dbPath).mtimeMs / 1000);
    }
  } catch {}
  return null;
}

function projectName() {
  try {
    return basename(findProjectRoot());
  } catch {
    return '';
  }
}

export function tableToDicts(headers, rows) {
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

// -- Compact output mode --

export function compactJsonEnvelope(command, payload = {}) {
  const out = { command };
  Object.assign(out, payload);
  return out;
}

export function wsLoc(repo, path, line = null) {
  if (line != null) return `[${repo}] ${path}:${line}`;
  return `[${repo}] ${path}`;
}

export function wsJsonEnvelope(command, workspace, { summary = null, ...payload } = {}) {
  const out = jsonEnvelope(command, { summary, ...payload });
  out.workspace = workspace;
  return out;
}

export function formatTableCompact(headers, rows, budget = 0) {
  if (!rows.length) return '(none)';
  const lines = [headers.join('\t')];
  const displayRows = budget && rows.length > budget ? rows.slice(0, budget) : rows;
  for (const row of displayRows) {
    lines.push(row.map(cell => String(cell)).join('\t'));
  }
  if (budget && rows.length > budget) {
    lines.push(`(+${rows.length - budget} more)`);
  }
  return lines.join('\n');
}
