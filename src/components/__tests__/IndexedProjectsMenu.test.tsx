import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { confirm } from '@tauri-apps/plugin-dialog';
import IndexedProjectsMenu from '../IndexedProjectsMenu';
import type { CbmIndexedProject } from '../../hooks/useIndexedProjects';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    graph: {
      indexedProjects: 'Indexed',
      indexedProjectsEmpty: 'No indexed projects',
      indexedProjectsIndexing: 'Indexing…',
      indexedProjectsDelete: 'Delete index',
      indexedProjectsDeleteConfirm: 'Delete this index?',
      sidecarUnavailable: 'Graph not ready',
      title: 'Code Graph',
    },
    common: { loading: 'Loading…' },
  }),
}));

const sampleProject: CbmIndexedProject = {
  repo_path: 'D:/project/foo',
  display_name: 'foo',
  path_status: 'ok',
  index_status: 'ready',
  is_stale: false,
};

describe('IndexedProjectsMenu', () => {
  const onOpenMenu = vi.fn();
  const onOpenProject = vi.fn();
  const onDeleteIndex = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(confirm).mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  async function openMenu(user: ReturnType<typeof userEvent.setup>) {
    const buttons = screen.getAllByRole('button', { name: /Indexed/i });
    await user.click(buttons[buttons.length - 1]!);
  }

  it('opens project folder when clicking a healthy row', async () => {
    const user = userEvent.setup();
    render(
      <IndexedProjectsMenu
        enabled
        cbmReady
        projects={[sampleProject]}
        loading={false}
        onOpenMenu={onOpenMenu}
        onOpenProject={onOpenProject}
        onDeleteIndex={onDeleteIndex}
      />
    );

    await openMenu(user);
    expect(onOpenMenu).toHaveBeenCalled();
    await user.click(screen.getByText('foo'));
    expect(onOpenProject).toHaveBeenCalledWith('D:/project/foo');
  });

  it('invokes delete index from row action', async () => {
    const user = userEvent.setup();
    render(
      <IndexedProjectsMenu
        enabled
        cbmReady
        projects={[sampleProject]}
        loading={false}
        onOpenMenu={onOpenMenu}
        onOpenProject={onOpenProject}
        onDeleteIndex={onDeleteIndex}
      />
    );

    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Delete index' }));
    await waitFor(() => {
      expect(onDeleteIndex).toHaveBeenCalledWith('D:/project/foo');
    });
  });

  it('does not delete when confirm is cancelled', async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    const user = userEvent.setup();
    render(
      <IndexedProjectsMenu
        enabled
        cbmReady
        projects={[sampleProject]}
        loading={false}
        onOpenMenu={onOpenMenu}
        onOpenProject={onOpenProject}
        onDeleteIndex={onDeleteIndex}
      />,
    );

    await openMenu(user);
    await user.click(screen.getByRole('button', { name: 'Delete index' }));
    await waitFor(() => {
      expect(confirm).toHaveBeenCalled();
    });
    expect(onDeleteIndex).not.toHaveBeenCalled();
  });

  it('cleans up stale rows instead of opening folder', async () => {
    const user = userEvent.setup();
    const stale: CbmIndexedProject = { ...sampleProject, path_status: 'missing' };
    render(
      <IndexedProjectsMenu
        enabled
        cbmReady
        projects={[stale]}
        loading={false}
        onOpenMenu={onOpenMenu}
        onOpenProject={onOpenProject}
        onDeleteIndex={onDeleteIndex}
      />
    );

    await openMenu(user);
    await user.click(screen.getByText('foo'));
    expect(onDeleteIndex).toHaveBeenCalledWith('D:/project/foo');
    expect(onOpenProject).not.toHaveBeenCalled();
  });
});
