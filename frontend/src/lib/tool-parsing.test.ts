import { describe, it, expect } from 'vitest';
import { extractLastJsonValue, normalizeToolArgumentsJson, mergeToolCallArguments } from './tool-parsing';

describe('tool-parsing', () => {
  it('extractLastJsonValue returns last JSON from concatenation', () => {
    const v = extractLastJsonValue('{"a":1}{"a":2}');
    expect(v).toEqual({ a: 2 });
  });

  it('normalizeToolArgumentsJson handles concatenated objects', () => {
    const out = normalizeToolArgumentsJson('{"query":"warsaw","count":5}{"query":"warsaw","count":5}');
    expect(JSON.parse(out)).toEqual({ query: 'warsaw', count: 5 });
  });

  it('normalizeToolArgumentsJson wraps arrays as input', () => {
    const out = normalizeToolArgumentsJson('["a", "b"]');
    expect(JSON.parse(out)).toEqual({ input: ['a', 'b'] });
  });

  it('mergeToolCallArguments prefers complete JSON payloads', () => {
    const merged = mergeToolCallArguments('{"query":"wa', '{"query":"warsaw","count":5}');
    expect(merged).toBe('{"query":"warsaw","count":5}');
  });
});

