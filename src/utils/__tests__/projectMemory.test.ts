import { describe, expect, it } from 'vitest';
import {
  formatProjectMemoryContext,
  getProjectMemoryContentHash,
  prependProjectMemoryToFirstUserMessage,
  serializeMemoryEntry,
  shouldInjectProjectMemory,
  slugifyMemoryId,
  type ProjectMemoryEntry,
} from '../projectMemory';

function entry(partial: Partial<ProjectMemoryEntry> & Pick<ProjectMemoryEntry, 'id' | 'title' | 'body'>): ProjectMemoryEntry {
  return {
    tags: [],
    source: 'agent',
    updatedAt: '2026-07-31T00:00:00.000Z',
    filePath: `/Users/me/.loom/memory/abc123/${partial.id}.md`,
    ...partial,
  };
}

describe('projectMemory', () => {
  it('slugifies ids', () => {
    expect(slugifyMemoryId('Zustand Selectors!')).toBe('zustand-selectors');
    expect(slugifyMemoryId('  CSS Modules  ')).toBe('css-modules');
  });

  it('serializes and formats inject block', () => {
    const text = serializeMemoryEntry({
      id: 'css-modules',
      title: 'CSS Modules',
      body: 'Use CSS Modules for components.',
      tags: ['frontend'],
      source: 'agent',
      updatedAt: '2026-07-31T00:00:00.000Z',
    });
    expect(text).toContain('id: css-modules');
    expect(text).toContain('Use CSS Modules for components.');

    const formatted = formatProjectMemoryContext([
      entry({ id: 'css-modules', title: 'CSS Modules', body: 'Use CSS Modules.', tags: ['frontend'] }),
    ]);
    expect(formatted).toContain('[Project Memory]');
    expect(formatted).toContain('CSS Modules');
    expect(formatted).toContain('[End Project Memory]');
  });

  it('shouldInjectProjectMemory respects hash', () => {
    const text = formatProjectMemoryContext([
      entry({ id: 'a', title: 'A', body: 'Body A' }),
    ]);
    expect(shouldInjectProjectMemory(text, false)).toBe(true);
    expect(shouldInjectProjectMemory(text, true)).toBe(false);
    const hash = getProjectMemoryContentHash(text);
    expect(shouldInjectProjectMemory(text, true, hash)).toBe(false);
    expect(shouldInjectProjectMemory(text + 'x', true, hash)).toBe(true);
  });

  it('omits empty entries and respects inject budget', () => {
    expect(formatProjectMemoryContext([])).toBe('');
    const big = 'x'.repeat(5000);
    const formatted = formatProjectMemoryContext([
      entry({ id: 'a', title: 'A', body: big }),
      entry({ id: 'b', title: 'B', body: big }),
      entry({ id: 'c', title: 'C', body: big }),
    ]);
    expect(formatted).toContain('[Project Memory]');
    expect(formatted).toContain('additional memory entries omitted');
  });

  it('prepends memory to the first user message only', () => {
    const memory = formatProjectMemoryContext([
      entry({ id: 'a', title: 'A', body: 'Use CSS Modules.' }),
    ]);
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    expect(prependProjectMemoryToFirstUserMessage(messages, memory)).toBe(true);
    expect(messages[1].content).toContain('[Project Memory]');
    expect(messages[1].content).toContain('hello');
    expect(messages[0].content).toBe('sys');
  });
});
