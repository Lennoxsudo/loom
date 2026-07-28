import { describe, it, expect } from 'vitest';
import { appendReadFilesSection, collectReadFilePathsFromMessages } from '../readFilePaths';
import type { CompactableMessage } from '../types';

describe('compact/readFilePaths', () => {
  it('collects paths from read tool results', () => {
    const messages: CompactableMessage[] = [
      {
        id: '1',
        role: 'tool',
        tool_name: 'read',
        text: '文件内容 (src/App.tsx):\n\n```\nexport {}\n```',
      },
      {
        id: '2',
        role: 'tool',
        tool_name: 'read',
        text: '文件内容 (src/main.ts):\n\n```\nmain\n```',
      },
    ];

    expect(collectReadFilePathsFromMessages(messages)).toEqual(['src/App.tsx', 'src/main.ts']);
  });

  it('collects paths from assistant read tool_calls', () => {
    const messages: CompactableMessage[] = [
      {
        id: '1',
        role: 'assistant',
        text: '',
        tool_calls: [
          {
            function: {
              name: 'read',
              arguments: JSON.stringify({ path: 'package.json' }),
            },
          },
        ],
      },
    ];

    expect(collectReadFilePathsFromMessages(messages)).toEqual(['package.json']);
  });

  it('deduplicates paths and skips non-read tools', () => {
    const messages: CompactableMessage[] = [
      {
        id: '1',
        role: 'tool',
        tool_name: 'read',
        text: '文件内容 (src/App.tsx):\n\n```\n1\n```',
      },
      {
        id: '2',
        role: 'tool',
        tool_name: 'term',
        text: 'npm test\nPASS',
      },
      {
        id: '3',
        role: 'assistant',
        tool_calls: [
          {
            function: {
              name: 'read',
              arguments: JSON.stringify({ path: 'src/App.tsx' }),
            },
          },
        ],
      },
    ];

    expect(collectReadFilePathsFromMessages(messages)).toEqual(['src/App.tsx']);
  });

  it('appends Files Read section when missing', () => {
    const summary = appendReadFilesSection('## Task\nFix bug', ['a.ts', 'b.ts']);
    expect(summary).toContain('## Files Read');
    expect(summary).toContain('- a.ts');
    expect(summary).toContain('- b.ts');
  });

  it('does not duplicate Files Read section', () => {
    const summary = appendReadFilesSection('## Files Read\n- a.ts', ['b.ts']);
    expect(summary).toBe('## Files Read\n- a.ts');
  });
});
