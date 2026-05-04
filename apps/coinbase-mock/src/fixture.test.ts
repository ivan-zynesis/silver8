import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixture } from './fixture.js';

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mock-fixture-'));
  const path = join(dir, 'fixture.jsonl');
  writeFileSync(path, content);
  return path;
}

describe('loadFixture', () => {
  it('parses a valid JSONL file', () => {
    const path = tmpFile([
      JSON.stringify({ channel: 'l2_data', timestamp: 't', sequence_num: 1, events: [] }),
      JSON.stringify({ channel: 'heartbeats', timestamp: 't', sequence_num: 2, events: [] }),
    ].join('\n'));
    const env = loadFixture(path);
    expect(env).toHaveLength(2);
    expect(env[0].channel).toBe('l2_data');
    expect(env[1].sequence_num).toBe(2);
  });

  it('skips empty lines', () => {
    const path = tmpFile([
      '',
      JSON.stringify({ channel: 'l2_data', timestamp: 't', sequence_num: 1, events: [] }),
      '',
      '',
      JSON.stringify({ channel: 'l2_data', timestamp: 't', sequence_num: 2, events: [] }),
      '',
    ].join('\n'));
    expect(loadFixture(path)).toHaveLength(2);
  });

  it('throws on malformed JSON with the line number', () => {
    const path = tmpFile([
      JSON.stringify({ channel: 'l2_data', timestamp: 't', sequence_num: 1, events: [] }),
      '{not json',
    ].join('\n'));
    expect(() => loadFixture(path)).toThrow(/line 2/);
  });

  it('throws on schema-invalid envelope', () => {
    const path = tmpFile(JSON.stringify({ channel: 'l2_data' /* missing fields */ }));
    expect(() => loadFixture(path)).toThrow(/validation error/);
  });
});
