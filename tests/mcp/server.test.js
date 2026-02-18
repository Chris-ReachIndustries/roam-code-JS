import { describe, it, expect } from 'vitest';
import { captureOutput } from '../../src/mcp/capture.js';
import { TOOL_NAMES } from '../../src/mcp/tool-names.js';

describe('captureOutput', () => {
  it('captures console.log output', async () => {
    const text = await captureOutput(() => {
      console.log('hello');
      console.log('world');
    });
    expect(text).toBe('hello\nworld');
  });

  it('captures console.error output', async () => {
    const text = await captureOutput(() => {
      console.error('error message');
    });
    expect(text).toBe('error message');
  });

  it('captures console.warn output', async () => {
    const text = await captureOutput(() => {
      console.warn('warning');
    });
    expect(text).toBe('warning');
  });

  it('intercepts process.exit', async () => {
    const text = await captureOutput(() => {
      console.log('before exit');
      process.exit(1);
      console.log('after exit'); // Should not reach here
    });
    expect(text).toBe('before exit');
  });

  it('restores console methods after execution', async () => {
    const origLog = console.log;
    await captureOutput(() => { console.log('test'); });
    expect(console.log).toBe(origLog);
  });

  it('restores console methods even on error', async () => {
    const origLog = console.log;
    await captureOutput(() => {
      throw new Error('test error');
    });
    expect(console.log).toBe(origLog);
  });

  it('captures error messages', async () => {
    const text = await captureOutput(() => {
      throw new Error('something broke');
    });
    expect(text).toContain('something broke');
  });

  it('handles async functions', async () => {
    const text = await captureOutput(async () => {
      console.log('async output');
    });
    expect(text).toBe('async output');
  });
});

describe('TOOL_NAMES', () => {
  it('has 22 tools', () => {
    expect(TOOL_NAMES.length).toBe(22);
  });

  it('contains all expected tool names', () => {
    expect(TOOL_NAMES).toContain('understand');
    expect(TOOL_NAMES).toContain('health');
    expect(TOOL_NAMES).toContain('search_symbol');
    expect(TOOL_NAMES).toContain('context');
    expect(TOOL_NAMES).toContain('trace');
    expect(TOOL_NAMES).toContain('impact');
    expect(TOOL_NAMES).toContain('file_info');
    expect(TOOL_NAMES).toContain('preflight');
    expect(TOOL_NAMES).toContain('dead_code');
    expect(TOOL_NAMES).toContain('repo_map');
    expect(TOOL_NAMES).toContain('breaking_changes');
    expect(TOOL_NAMES).toContain('affected_tests');
    expect(TOOL_NAMES).toContain('pr_risk');
    expect(TOOL_NAMES).toContain('complexity_report');
    expect(TOOL_NAMES).toContain('coverage_gaps');
    expect(TOOL_NAMES).toContain('risk');
    expect(TOOL_NAMES).toContain('clusters');
    expect(TOOL_NAMES).toContain('layers');
    expect(TOOL_NAMES).toContain('coupling');
    expect(TOOL_NAMES).toContain('conventions');
    expect(TOOL_NAMES).toContain('deps');
    expect(TOOL_NAMES).toContain('uses');
  });

  it('has unique tool names', () => {
    const unique = new Set(TOOL_NAMES);
    expect(unique.size).toBe(TOOL_NAMES.length);
  });
});
