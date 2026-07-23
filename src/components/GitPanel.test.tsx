import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GitPanel from './GitPanel';
import { I18nProvider } from '../i18n';
import { NotificationProvider } from '../contexts/NotificationContext';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

const baseCommit = {
  hash: 'abcdef0123456789abcdef0123456789abcdef0',
  subject: 'Initial commit',
  author: 'Alice',
  date: '2024-01-01',
};

function buildCommits(count: number) {
  if (count <= 1) return [baseCommit];
  return [
    ...Array.from({ length: count - 1 }, (_, index) => ({
      hash: `${(index + 1).toString().padStart(40, '0')}`,
      subject: `Commit ${index + 1}`,
      author: 'Bob',
      date: '2024-01-02',
    })),
    baseCommit,
  ];
}

const mockSnapshot = {
  isRepo: true,
  status: {
    isRepo: true,
    branch: 'main',
    upstreamName: null,
    ahead: 0,
    behind: 0,
    mergeInProgress: false,
    rebaseInProgress: false,
    entries: [],
  },
  branches: [{ name: 'main', isCurrent: true, isRemote: false }],
  commits: buildCommits(30),
  conflicted: [],
};

function renderPanel(projectPath = 'D:\\demo-repo') {
  return render(
    <I18nProvider>
      <NotificationProvider>
        <GitPanel
          projectPath={projectPath}
          isActive
          onCollapse={() => {}}
          onOpenFile={() => {}}
          onOpenDiffInEditor={() => {}}
        />
      </NotificationProvider>
    </I18nProvider>
  );
}

describe('GitPanel extensions', () => {
  beforeEach(() => {
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'git_workspace_snapshot') {
        return Promise.resolve(mockSnapshot);
      }
      if (cmd === 'git_workspace_log') {
        const limit = (args?.limit as number) ?? 30;
        const commits =
          limit > 30
            ? [
                ...buildCommits(30),
                {
                  hash: '1111111111111111111111111111111111111111',
                  subject: 'Second commit',
                  author: 'Bob',
                  date: '2024-01-02',
                },
              ]
            : buildCommits(30);
        return Promise.resolve({ commits });
      }
      if (cmd === 'git_workspace_commit_detail') {
        return Promise.resolve({
          meta: {
            hash: args?.hash,
            subject: 'Initial commit',
            author: 'Alice',
            date: '2024-01-01',
            body: null,
          },
          files: [
            { path: 'README.md', oldPath: null, status: 'added', additions: 1, deletions: 0 },
          ],
          truncated: false,
          truncatedInfo: null,
        });
      }
      if (cmd === 'git_workspace_stash_list') {
        return Promise.resolve([]);
      }
      if (cmd === 'git_workspace_stash_save') {
        return Promise.resolve(undefined);
      }
      if (cmd === 'git_workspace_stash_apply') {
        return Promise.resolve(undefined);
      }
      if (cmd === 'git_workspace_create_branch') {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });
  });

  afterEach(() => {
    cleanup();
    invokeMock.mockReset();
  });

  it('restores commit draft when git sidebar becomes active again', async () => {
    const user = userEvent.setup();
    const draft = 'draft after tab switch';
    const repoPath = 'D:\\draft-tab-switch';

    const view = render(
      <I18nProvider>
        <NotificationProvider>
          <GitPanel
            projectPath={repoPath}
            isActive
            onCollapse={() => {}}
            onOpenFile={() => {}}
            onOpenDiffInEditor={() => {}}
          />
        </NotificationProvider>
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/摘要（必填）|Summary \(required\)/i)).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText(/摘要（必填）|Summary \(required\)/i), draft);

    view.rerender(
      <I18nProvider>
        <NotificationProvider>
          <GitPanel
            projectPath={repoPath}
            isActive={false}
            onCollapse={() => {}}
            onOpenFile={() => {}}
            onOpenDiffInEditor={() => {}}
          />
        </NotificationProvider>
      </I18nProvider>
    );

    view.rerender(
      <I18nProvider>
        <NotificationProvider>
          <GitPanel
            projectPath={repoPath}
            isActive
            onCollapse={() => {}}
            onOpenFile={() => {}}
            onOpenDiffInEditor={() => {}}
          />
        </NotificationProvider>
      </I18nProvider>
    );

    expect(await screen.findByDisplayValue(draft)).toBeInTheDocument();
  });

  it('keeps commit draft after panel unmount and remount', async () => {
    const user = userEvent.setup();
    const draft = 'feat: keep commit draft across navigation';

    const view = renderPanel('D:\\commit-draft');

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/摘要（必填）|Summary \(required\)/i)).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText(/摘要（必填）|Summary \(required\)/i), draft);
    view.unmount();

    renderPanel('D:\\commit-draft');

    expect(await screen.findByDisplayValue(draft)).toBeInTheDocument();
  });

  it('warns when Windows reserved repo files are present', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'git_workspace_snapshot') {
        return Promise.resolve(mockSnapshot);
      }
      if (cmd === 'find_windows_reserved_repo_files') {
        return Promise.resolve(['nul']);
      }
      if (cmd === 'git_workspace_stash_list') {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });

    renderPanel('D:\\reserved-warning');

    expect(await screen.findByText(/无法加入 Git|Cannot add to Git/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Windows 保留文件名|Windows reserved device name/i)
    ).toBeInTheDocument();
  });

  it('shows files for the active changes tab', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'git_workspace_snapshot') {
        return Promise.resolve({
          ...mockSnapshot,
          status: {
            ...mockSnapshot.status,
            entries: [
              {
                filePath: 'src/foo.ts',
                displayPath: 'src/foo.ts',
                indexStatus: ' ',
                worktreeStatus: 'M',
                untracked: false,
                conflict: false,
              },
              {
                filePath: 'readme.md',
                displayPath: 'readme.md',
                indexStatus: ' ',
                worktreeStatus: ' ',
                untracked: true,
                conflict: false,
              },
            ],
          },
        });
      }
      if (cmd === 'git_workspace_stash_list') {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });

    renderPanel('D:\\changes-tab');

    expect(await screen.findByText('foo.ts')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('tab', { name: /未跟踪|Untracked/i }));

    expect(await screen.findByText('readme.md')).toBeInTheDocument();
  });

  it('hides workspace bulk actions when there are no unstaged changes', async () => {
    renderPanel('D:\\empty-workspace');

    expect(await screen.findByText(/暂无文件|No files/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /全部暂存|Stage all/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /全部丢弃|Discard all/i })).not.toBeInTheDocument();
  });

  it('shows latest commit in the bottom dock when there are unpushed commits', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'git_workspace_snapshot') {
        return Promise.resolve({
          ...mockSnapshot,
          status: { ...mockSnapshot.status, ahead: 1, upstreamName: 'origin/main' },
        });
      }
      if (cmd === 'git_workspace_stash_list') {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });

    renderPanel('D:\\bottom-commit');

    const notice = await screen.findByRole('status');
    expect(within(notice).getByText(/最近提交|Latest commit/i)).toBeInTheDocument();
    expect(within(notice).getByText('Commit 1')).toBeInTheDocument();
  });

  it('hides bottom commit notice after a successful push', async () => {
    const user = userEvent.setup();
    let ahead = 1;

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'git_workspace_snapshot') {
        return Promise.resolve({
          ...mockSnapshot,
          status: { ...mockSnapshot.status, ahead, upstreamName: 'origin/main' },
        });
      }
      if (cmd === 'git_workspace_push') {
        ahead = 0;
        return Promise.resolve(undefined);
      }
      if (cmd === 'git_workspace_stash_list') {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });

    renderPanel('D:\\push-hide-notice');

    expect(await screen.findByRole('status')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^推送$|^Push$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  it('prefetches git history when a project opens while the panel is inactive', async () => {
    render(
      <I18nProvider>
        <NotificationProvider>
          <GitPanel
            projectPath="D:\\prefetch"
            isActive={false}
            onCollapse={() => {}}
            onOpenFile={() => {}}
            onOpenDiffInEditor={() => {}}
          />
        </NotificationProvider>
      </I18nProvider>
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'git_workspace_snapshot',
        expect.objectContaining({ repoPath: expect.stringContaining('prefetch') })
      );
    });
  });

  it('loads more commits with an increased limit', async () => {
    const user = userEvent.setup();
    renderPanel('D:\\load-more');

    await waitFor(() => {
      expect(screen.getAllByText('Commit 1').length).toBeGreaterThan(0);
    });

    expect(await screen.findByText('Initial commit')).toBeInTheDocument();

    const loadMore = await screen.findByRole('button', { name: /加载更多|Load more/i });
    await user.click(loadMore);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'git_workspace_log',
        expect.objectContaining({ limit: 60 })
      );
    });

    expect(await screen.findByText('Second commit')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /加载更多|Load more/i })).not.toBeInTheDocument();
    });
  });

  it('fetches commit detail when a commit row is clicked', async () => {
    const user = userEvent.setup();
    renderPanel('D:\\commit-detail');

    await waitFor(() => {
      expect(screen.getAllByText('Commit 1').length).toBeGreaterThan(0);
    });

    invokeMock.mockClear();

    const commitRow = screen.getByRole('button', { name: '0000000 Commit 1' });
    await user.click(commitRow);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'git_workspace_commit_detail',
        expect.objectContaining({
          hash: `${'0'.repeat(39)}1`,
        })
      );
    });

    expect(await screen.findByText('README.md')).toBeInTheDocument();
  });

  it('runs stash save happy path', async () => {
    const user = userEvent.setup();
    renderPanel('D:\\stash-save');

    const stashBtn = await screen.findByRole('button', { name: /^暂藏$|^Stash$/i });
    invokeMock.mockClear();

    await user.click(stashBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'git_workspace_stash_save',
        expect.objectContaining({
          options: expect.objectContaining({ message: undefined }),
        })
      );
    });
  });

  it('does not create branch when name is invalid', async () => {
    const user = userEvent.setup();
    renderPanel('D:\\branch-invalid');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /新建分支|New branch/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /新建分支|New branch/i }));

    const input = await screen.findByPlaceholderText(/分支名|Branch name/i);
    await user.clear(input);
    await user.type(input, 'bad..branch');

    const confirmButtons = screen.getAllByRole('button', { name: /^确定$|^OK$/i });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    expect(invokeMock).not.toHaveBeenCalledWith('git_workspace_create_branch', expect.anything());
  });
});
