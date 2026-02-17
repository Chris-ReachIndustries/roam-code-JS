/**
 * SARIF 2.1.0 static analysis output.
 * Conforms to the OASIS SARIF v2.1.0 JSON schema.
 */

import { writeFileSync } from 'node:fs';
import { VERSION } from '../index.js';

const SARIF_VERSION = '2.1.0';
const SARIF_SCHEMA = 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json';

/**
 * Create a base SARIF log structure.
 * @param {string} toolName
 * @param {string} [version]
 * @returns {object} SARIF log
 */
export function createSarifLog(toolName = 'roam-code', version = VERSION) {
  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [],
    _toolName: toolName,
    _toolVersion: version,
  };
}

/**
 * Add a run (analysis pass) to a SARIF log.
 * @param {object} log — SARIF log from createSarifLog
 * @param {string} runName — descriptive name of the analysis
 * @param {object[]} rules — array of rule objects from makeRule()
 * @param {object[]} results — array of result objects from makeResult()
 */
export function addRun(log, runName, rules, results) {
  log.runs.push({
    tool: {
      driver: {
        name: log._toolName,
        version: log._toolVersion,
        informationUri: 'https://github.com/Chris-ReachIndustries/roam-code-JS',
        rules: rules,
      },
    },
    results: results,
    invocations: [{
      executionSuccessful: true,
      toolExecutionNotifications: [],
    }],
    automationDetails: {
      id: `${runName}/${new Date().toISOString().replace(/[:.]/g, '-')}`,
    },
  });
}

/**
 * Create a SARIF rule descriptor.
 * @param {string} id — unique rule ID (e.g. 'ROAM001')
 * @param {string} name — human-readable rule name
 * @param {string} shortDesc — short description
 * @param {string} [fullDesc] — full description
 * @param {string} [level='warning'] — default level: error | warning | note
 * @returns {object}
 */
export function makeRule(id, name, shortDesc, fullDesc, level = 'warning') {
  return {
    id,
    name,
    shortDescription: { text: shortDesc },
    fullDescription: { text: fullDesc || shortDesc },
    defaultConfiguration: { level },
    properties: { tags: ['roam-code'] },
  };
}

/**
 * Create a SARIF result.
 * @param {string} ruleId — must match a rule ID
 * @param {string} message — result message text
 * @param {object[]} locations — array of location objects from makeLocation()
 * @param {string} [level] — override level: error | warning | note
 * @param {object} [properties] — additional properties bag
 * @returns {object}
 */
export function makeResult(ruleId, message, locations = [], level, properties) {
  const result = {
    ruleId,
    message: { text: message },
    locations,
  };
  if (level) result.level = level;
  if (properties) result.properties = properties;
  return result;
}

/**
 * Create a SARIF physical location.
 * @param {string} filePath — file path (relative to project root)
 * @param {number} [startLine]
 * @param {number} [endLine]
 * @returns {object}
 */
export function makeLocation(filePath, startLine, endLine) {
  const location = {
    physicalLocation: {
      artifactLocation: {
        uri: filePath.replace(/\\/g, '/'),
        uriBaseId: '%SRCROOT%',
      },
    },
  };
  if (startLine != null) {
    location.physicalLocation.region = { startLine };
    if (endLine != null) location.physicalLocation.region.endLine = endLine;
  }
  return location;
}

/**
 * Write SARIF log to a file.
 * @param {object} log — SARIF log object
 * @param {string} outputPath
 */
export function writeSarif(log, outputPath) {
  // Remove internal properties before writing
  const clean = { ...log };
  delete clean._toolName;
  delete clean._toolVersion;
  writeFileSync(outputPath, JSON.stringify(clean, null, 2), 'utf-8');
}

// -------------------------------------------------------
// Domain-specific converters
// -------------------------------------------------------

/**
 * Convert dead code findings to SARIF results.
 * @param {Array<{name: string, kind: string, file_path: string, line_start: number, line_end: number, _confidence: number}>} items
 * @returns {{rules: object[], results: object[]}}
 */
export function deadCodeToSarif(items) {
  const rules = [
    makeRule('ROAM-DEAD-100', 'dead-code-certain', 'Unreferenced exported symbol (100% confidence)', null, 'warning'),
    makeRule('ROAM-DEAD-080', 'dead-code-likely', 'Likely unreferenced symbol (80% confidence)', null, 'warning'),
    makeRule('ROAM-DEAD-070', 'dead-code-possible', 'Possibly unreferenced symbol (70% confidence)', null, 'note'),
    makeRule('ROAM-DEAD-060', 'dead-code-uncertain', 'Uncertain unreferenced symbol (60% confidence)', null, 'note'),
  ];

  const results = items.map(item => {
    const conf = item._confidence || 100;
    let ruleId;
    if (conf >= 100) ruleId = 'ROAM-DEAD-100';
    else if (conf >= 80) ruleId = 'ROAM-DEAD-080';
    else if (conf >= 70) ruleId = 'ROAM-DEAD-070';
    else ruleId = 'ROAM-DEAD-060';

    return makeResult(
      ruleId,
      `Unreferenced export: ${item.kind} '${item.name}' (${conf}% confidence)`,
      [makeLocation(item.file_path, item.line_start, item.line_end)],
      conf >= 100 ? 'warning' : 'note',
      { confidence: conf, kind: item.kind },
    );
  });

  return { rules, results };
}

/**
 * Convert high-complexity findings to SARIF results.
 * @param {Array<{name: string, kind: string, file_path: string, line_start: number, cognitive_complexity: number}>} items
 * @returns {{rules: object[], results: object[]}}
 */
export function complexityToSarif(items) {
  const rules = [
    makeRule('ROAM-CC-HIGH', 'high-complexity', 'Symbol with high cognitive complexity', 'Cognitive complexity exceeds recommended threshold', 'warning'),
    makeRule('ROAM-CC-CRITICAL', 'critical-complexity', 'Symbol with critical cognitive complexity', 'Cognitive complexity greatly exceeds recommended threshold', 'error'),
  ];

  const results = items.map(item => {
    const cc = item.cognitive_complexity || 0;
    const ruleId = cc > 50 ? 'ROAM-CC-CRITICAL' : 'ROAM-CC-HIGH';
    return makeResult(
      ruleId,
      `${item.kind} '${item.name}' has cognitive complexity ${cc}`,
      [makeLocation(item.file_path, item.line_start)],
      cc > 50 ? 'error' : 'warning',
      { cognitive_complexity: cc, kind: item.kind },
    );
  });

  return { rules, results };
}

/**
 * Convert convention violations to SARIF results.
 * @param {Array<{name: string, file_path: string, line_start: number, violation: string, expected: string}>} items
 * @returns {{rules: object[], results: object[]}}
 */
export function conventionToSarif(items) {
  const rules = [
    makeRule('ROAM-CONV-NAMING', 'naming-convention', 'Naming convention violation', null, 'note'),
    makeRule('ROAM-CONV-EXPORT', 'export-convention', 'Export pattern inconsistency', null, 'note'),
    makeRule('ROAM-CONV-FILE', 'file-naming', 'File naming convention violation', null, 'note'),
  ];

  const results = items.map(item => {
    let ruleId = 'ROAM-CONV-NAMING';
    if (item.violation && item.violation.includes('export')) ruleId = 'ROAM-CONV-EXPORT';
    if (item.violation && item.violation.includes('file')) ruleId = 'ROAM-CONV-FILE';

    return makeResult(
      ruleId,
      `${item.violation}: '${item.name}' (expected: ${item.expected || 'N/A'})`,
      item.file_path ? [makeLocation(item.file_path, item.line_start)] : [],
      'note',
    );
  });

  return { rules, results };
}

/**
 * Convert health check issues to SARIF results.
 * @param {Array<{name: string, kind: string, file: string, severity: string, category: string, detail: string}>} items
 * @returns {{rules: object[], results: object[]}}
 */
export function healthToSarif(items) {
  const rules = [
    makeRule('ROAM-HEALTH-CYCLE', 'dependency-cycle', 'Dependency cycle detected', null, 'warning'),
    makeRule('ROAM-HEALTH-GOD', 'god-component', 'Component with excessive coupling', null, 'warning'),
    makeRule('ROAM-HEALTH-BN', 'bottleneck', 'Architectural bottleneck', null, 'warning'),
    makeRule('ROAM-HEALTH-LAYER', 'layer-violation', 'Dependency layer violation', null, 'note'),
  ];

  const results = items.map(item => {
    let ruleId = 'ROAM-HEALTH-CYCLE';
    if (item.category === 'god') ruleId = 'ROAM-HEALTH-GOD';
    else if (item.category === 'bottleneck') ruleId = 'ROAM-HEALTH-BN';
    else if (item.category === 'layer') ruleId = 'ROAM-HEALTH-LAYER';

    const level = item.severity === 'CRITICAL' ? 'error' : item.severity === 'WARNING' ? 'warning' : 'note';
    return makeResult(
      ruleId,
      item.detail || `${item.category}: ${item.name}`,
      item.file ? [makeLocation(item.file)] : [],
      level,
      { severity: item.severity, category: item.category },
    );
  });

  return { rules, results };
}
