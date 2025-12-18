import { describe, it, expect } from 'vitest';
import { normalizeAssistantMarkdownForRender } from './chat-markdown';

describe('normalizeAssistantMarkdownForRender', () => {
  it('inserts newline after code fence language', () => {
    const input = '```html<!DOCTYPE html>\n<body></body>\n```';
    const out = normalizeAssistantMarkdownForRender(input);
    expect(out).toMatch(/^```html\s*\r?\n/);
    expect(out).toContain('<!DOCTYPE html>');
  });

  it('converts mermaidgraph to mermaid fenced block', () => {
    const input = [
      'mermaidgraph',
      '  A --> B',
      '``',
      '',
    ].join('\n');
    const out = normalizeAssistantMarkdownForRender(input);
    expect(out).toContain('```mermaid');
    expect(out).toContain('A --> B');
    expect(out).toContain('```');
  });

  it('repairs inline mermaidgraph fence headers', () => {
    const input = '```mermaidgraph LR A-->B\n```';
    const out = normalizeAssistantMarkdownForRender(input);
    expect(out).toContain('```mermaid');
    expect(out).toContain('graph LR');
  });
});
