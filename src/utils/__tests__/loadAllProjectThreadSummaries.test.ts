import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { loadAllProjectThreadSummaries } from '../agentPersistence';

describe('loadAllProjectThreadSummaries', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('preserves conversation order from project state instead of sorting by updatedAt', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'get_projects_index') {
        return {
          projects: [{ key: 'project-a', path: 'D:\\project-a', updatedAt: '2026-01-01T00:00:00Z' }],
          lastActiveProjectPath: 'D:\\project-a',
        };
      }
      if (cmd === 'get_project_state') {
        const { projectKey } = args as { projectKey: string };
        if (projectKey !== 'project-a') return null;
        return {
          selectedConversationId: 'older-active',
          conversations: [
            {
              id: 'older-active',
              title: 'Older thread',
              projectPath: 'D:\\project-a',
              updatedAt: 100,
              createdAt: 1,
              messages: [],
              previewHistory: [],
              currentPreviewIndex: 0,
            },
            {
              id: 'newer-idle',
              title: 'Newer thread',
              projectPath: 'D:\\project-a',
              updatedAt: 999,
              createdAt: 2,
              messages: [],
              previewHistory: [],
              currentPreviewIndex: 0,
            },
          ],
        };
      }
      throw new Error(`Unexpected invoke: ${cmd}`);
    });

    const grouped = await loadAllProjectThreadSummaries();
    const threads = grouped['d:/project-a'];

    expect(threads?.map((thread) => thread.id)).toEqual(['older-active', 'newer-idle']);
  });
});
