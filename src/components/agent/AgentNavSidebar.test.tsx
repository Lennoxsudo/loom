import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import AgentNavSidebar from './AgentNavSidebar';
import { normalizeProjectPath } from './utils';

const ACTIVE_PATH = 'D:\\active\\project';
const ORPHAN_PATH = 'D:\\orphan\\with-threads';
const ORPHAN_KEY = normalizeProjectPath(ORPHAN_PATH);

function renderSidebar(
  overrides: Partial<React.ComponentProps<typeof AgentNavSidebar>> = {}
) {
  render(
    <I18nProvider defaultLocale="en-US">
      <AgentNavSidebar
        projectPath={ACTIVE_PATH}
        projectName="Active"
        recentWorkspaces={[
          {
            path: ACTIVE_PATH,
            name: 'Active',
            lastOpenedAt: '2026-06-15T12:00:00.000Z',
          },
        ]}
        threadsByProject={{
          [ORPHAN_KEY]: [
            {
              id: 'thread-orphan',
              title: 'Hidden project thread',
              updatedAt: Date.now(),
              sessionKey: 'agent::thread-orphan',
              projectPath: ORPHAN_PATH,
            },
          ],
        }}
        selectedThreadId={null}
        streamingSessionKeys={new Set()}
        hideEmptyProjects={false}
        isProjectExpanded={() => true}
        onToggleProjectExpanded={vi.fn()}
        onToggleHideEmptyProjects={vi.fn()}
        onAddProject={vi.fn()}
        renamingThreadId={null}
        renamingTitle=""
        onRenamingTitleChange={vi.fn()}
        onNewThread={vi.fn()}
        onAutomation={vi.fn()}
        onSelectThreadInProject={vi.fn()}
        onNewThreadInProject={vi.fn()}
        onStartRenameThread={vi.fn()}
        onCommitRenameThread={vi.fn()}
        onCancelRenameThread={vi.fn()}
        onRequestDeleteThread={vi.fn()}
        onRequestDeleteProject={vi.fn()}
        sidebarMode="workspace"
        settingsSection="general"
        onSettingsSectionChange={vi.fn()}
        onOpenSettings={vi.fn()}
        onExitSettings={vi.fn()}
        {...overrides}
      />
    </I18nProvider>
  );
}

describe('AgentNavSidebar', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows projects with threads even when they are not in recent workspaces', () => {
    renderSidebar();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('with-threads')).toBeInTheDocument();
    expect(screen.getByText('Hidden project thread')).toBeInTheDocument();
  });

  it('calls onNewThread without passing the click event', () => {
    const onNewThread = vi.fn();
    renderSidebar({ onNewThread });

    fireEvent.click(screen.getByTestId('agent-new-thread-button'));

    expect(onNewThread).toHaveBeenCalledTimes(1);
    expect(onNewThread).toHaveBeenCalledWith();
  });
});
