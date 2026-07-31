import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getToolHandler } from '../registry';

vi.mock('../../../utils/projectMemory', () => ({
  loadProjectMemoryEntries: vi.fn(),
  getProjectMemoryEntry: vi.fn(),
  upsertProjectMemory: vi.fn(),
  deleteProjectMemory: vi.fn(),
}));

import {
  deleteProjectMemory,
  getProjectMemoryEntry,
  loadProjectMemoryEntries,
  upsertProjectMemory,
} from '../../../utils/projectMemory';

describe('memoryHandlers', () => {
  const baseDir = 'D:/project/demo';
  const entry = {
    id: 'css-modules',
    title: 'CSS Modules',
    body: 'Use CSS Modules.',
    tags: ['frontend'],
    source: 'agent' as const,
    updatedAt: '2026-07-31T00:00:00.000Z',
    filePath: 'C:/Users/me/.loom/memory/abc/css-modules.md',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails without baseDir', async () => {
    const handler = getToolHandler('memory');
    expect(handler).toBeDefined();
    const result = await handler!.execute({ action: 'list' }, {});
    expect(result.error).toBeTruthy();
  });

  it('lists entries', async () => {
    vi.mocked(loadProjectMemoryEntries).mockResolvedValue([entry]);
    const handler = getToolHandler('memory');
    const result = await handler!.execute({ action: 'list' }, { baseDir });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('css-modules');
    expect(result.output).toContain('CSS Modules');
    expect(loadProjectMemoryEntries).toHaveBeenCalledWith(baseDir);
  });

  it('gets an entry', async () => {
    vi.mocked(getProjectMemoryEntry).mockResolvedValue(entry);
    const handler = getToolHandler('memory');
    const result = await handler!.execute({ action: 'get', id: 'css-modules' }, { baseDir });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('Use CSS Modules.');
  });

  it('upserts an entry', async () => {
    vi.mocked(upsertProjectMemory).mockResolvedValue(entry);
    const handler = getToolHandler('memory');
    const result = await handler!.execute(
      {
        action: 'upsert',
        title: 'CSS Modules',
        body: 'Use CSS Modules.',
        tags: ['frontend'],
      },
      { baseDir }
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('Saved project memory');
    expect(upsertProjectMemory).toHaveBeenCalledWith(baseDir, {
      id: undefined,
      title: 'CSS Modules',
      body: 'Use CSS Modules.',
      tags: ['frontend'],
    });
  });

  it('deletes an entry', async () => {
    vi.mocked(deleteProjectMemory).mockResolvedValue(true);
    const handler = getToolHandler('memory');
    const result = await handler!.execute({ action: 'delete', id: 'css-modules' }, { baseDir });
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('Deleted project memory: css-modules');
  });
});
