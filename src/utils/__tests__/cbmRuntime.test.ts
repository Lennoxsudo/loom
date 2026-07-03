import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  invokeWithRetry,
  invokeWithTimeout,
  normalizeCbmIndexedProject,
  normalizeCbmIndexedProjects,
  cbmIndexedProjectKey,
  scheduleCbmWorkspaceIndex,
  reindexCbmWorkspaceIndex,
  getCbmScheduleOutcome,
  parseCbmCliErrorMessage,
} from '../cbmRuntime';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

import { invoke } from '@tauri-apps/api/core';

describe('cbmRuntime IPC helpers', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('invokeWithTimeout rejects when invoke hangs', async () => {
    vi.mocked(invoke).mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      }),
    );

    await expect(invokeWithTimeout('cbm_sidecar_available', undefined, 50)).rejects.toThrow(
      /timeout/i,
    );
  });

  it('invokeWithRetry retries transient IPC errors', async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(true);

    const result = await invokeWithRetry<boolean>('cbm_sidecar_available', undefined, 5_000);
    expect(result).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe('normalizeCbmIndexedProject', () => {
  it('maps camelCase wire fields to snake_case model', () => {
    const project = normalizeCbmIndexedProject({
      repoPath: 'D:/project/foo',
      displayName: 'foo',
      pathStatus: 'ok',
      indexStatus: 'ready',
      nodeCount: 42,
      indexedAt: '2026-01-01',
    });

    expect(project).toEqual({
      repo_path: 'D:/project/foo',
      display_name: 'foo',
      path_status: 'ok',
      index_status: 'ready',
      node_count: 42,
      indexed_at: '2026-01-01',
      is_stale: false,
    });
  });

  it('accepts legacy snake_case wire fields', () => {
    const project = normalizeCbmIndexedProject({
      repo_path: 'D:/bar',
      display_name: 'bar',
      path_status: 'missing',
      index_status: 'indexing',
    });

    expect(project.repo_path).toBe('D:/bar');
    expect(project.path_status).toBe('missing');
    expect(project.index_status).toBe('indexing');
  });

  it('produces stable unique keys when repo_path is missing', () => {
    const list = normalizeCbmIndexedProjects([
      { displayName: 'a' },
      { displayName: 'a' },
    ]);

    const keys = list.map((project, index) => cbmIndexedProjectKey(project, index));
    expect(new Set(keys).size).toBe(2);
  });
});

describe('scheduleCbmWorkspaceIndex', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('passes force: true when reindexCbmWorkspaceIndex is called', async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: 'scheduled',
      repoPath: 'D:/project/foo',
    });

    await reindexCbmWorkspaceIndex('D:/project/foo', { maxFiles: 50_000 });

    expect(invoke).toHaveBeenCalledWith('cbm_schedule_workspace_index', {
      repoPath: 'D:/project/foo',
      maxFiles: 50_000,
      force: true,
    });
  });

  it('does not pass force by default for scheduleCbmWorkspaceIndex', async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: 'scheduled',
      repoPath: 'D:/project/foo',
    });

    await scheduleCbmWorkspaceIndex('D:/project/foo');

    expect(invoke).toHaveBeenCalledWith('cbm_schedule_workspace_index', {
      repoPath: 'D:/project/foo',
      maxFiles: null,
      force: false,
    });
  });
});

describe('getCbmScheduleOutcome', () => {
  it('maps schedule statuses to outcomes', () => {
    expect(getCbmScheduleOutcome({ status: 'scheduled', repoPath: 'x' })).toBe('scheduled');
    expect(getCbmScheduleOutcome({ status: 'in_progress', repoPath: 'x' })).toBe('in_progress');
    expect(getCbmScheduleOutcome(null)).toBe('failed');
  });
});

describe('parseCbmCliErrorMessage', () => {
  it('extracts error field from CBM JSON payloads', () => {
    expect(
      parseCbmCliErrorMessage(
        '{"project":"D-project","status":"delete_failed","error":"Permission denied"}',
      ),
    ).toBe('Permission denied');
  });

  it('returns plain text when payload is not JSON', () => {
    expect(parseCbmCliErrorMessage('sidecar unavailable')).toBe('sidecar unavailable');
  });
});
