import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '../../i18n';
import AgentProjectTree from './AgentProjectTree';
import { normalizeProjectPath } from './utils';

const PROJECT_PATH = 'D:\\test\\project';
const PROJECT_KEY = normalizeProjectPath(PROJECT_PATH);

function renderTree(overrides: Partial<React.ComponentProps<typeof AgentProjectTree>> = {}) {
  const onSelectThread = vi.fn();
  const onNewThreadInProject = vi.fn();
  const onToggleExpanded = vi.fn();

  render(
    <I18nProvider defaultLocale="en-US">
      <AgentProjectTree
        projects={[
          {
            path: PROJECT_PATH,
            name: 'Loom',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
          },
        ]}
        threadsByProject={{
          [PROJECT_KEY]: [
            {
              id: 'thread-1',
              title: 'Fix Read File Batch Execution',
              updatedAt: Date.now() - 18 * 60 * 60 * 1000,
              sessionKey: 'agent::thread-1',
              projectPath: PROJECT_PATH,
              branchName: 'main',
            },
          ],
        }}
        activeProjectPath={PROJECT_PATH}
        selectedThreadId="thread-1"
        streamingSessionKeys={new Set()}
        hideEmptyProjects={false}
        isExpanded={() => true}
        onToggleExpanded={onToggleExpanded}
        onAddProject={vi.fn()}
        onToggleHideEmptyProjects={vi.fn()}
        onSelectThread={onSelectThread}
        onNewThreadInProject={onNewThreadInProject}
        renamingThreadId={null}
        renamingTitle=""
        onRenamingTitleChange={vi.fn()}
        onStartRename={vi.fn()}
        onCommitRename={vi.fn()}
        onCancelRename={vi.fn()}
        onRequestDelete={vi.fn()}
        onRequestDeleteProject={vi.fn()}
        {...overrides}
      />
    </I18nProvider>
  );

  return { onSelectThread, onNewThreadInProject, onToggleExpanded };
}

describe('AgentProjectTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders project header and nested thread', () => {
    renderTree();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Loom')).toBeInTheDocument();
    expect(screen.getByText('Fix Read File Batch Execution')).toBeInTheDocument();
  });

  it('shows empty state for projects without conversations', () => {
    renderTree({
      threadsByProject: { [PROJECT_KEY]: [] },
    });
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
  });

  it('calls onSelectThread with project path and thread id', () => {
    const { onSelectThread } = renderTree();
    const tree = screen.getByTestId('agent-project-tree');
    fireEvent.click(within(tree).getByText('Fix Read File Batch Execution'));
    expect(onSelectThread).toHaveBeenCalledWith(PROJECT_PATH, 'thread-1');
  });

  it('toggles project expansion from project row', () => {
    const { onToggleExpanded } = renderTree();
    const tree = screen.getByTestId('agent-project-tree');
    fireEvent.click(within(tree).getByText('Loom'));
    expect(onToggleExpanded).toHaveBeenCalledWith(PROJECT_PATH);
  });

  it('calls onNewThreadInProject with project path when + is clicked', () => {
    const { onNewThreadInProject } = renderTree();
    const tree = screen.getByTestId('agent-project-tree');
    const newThreadLabel = within(tree).getByLabelText('New thread');
    fireEvent.click(newThreadLabel);
    expect(onNewThreadInProject).toHaveBeenCalledWith(PROJECT_PATH);
    expect(onNewThreadInProject).toHaveBeenCalledTimes(1);
  });

  it('opens delete project menu on project context menu and requests delete', () => {
    const onRequestDeleteProject = vi.fn();
    renderTree({ onRequestDeleteProject });
    const tree = screen.getByTestId('agent-project-tree');
    fireEvent.contextMenu(within(tree).getByText('Loom'));
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Delete project' }));
    expect(onRequestDeleteProject).toHaveBeenCalledWith(
      expect.objectContaining({ path: PROJECT_PATH, name: 'Loom' })
    );
  });

  it('shows streaming blocked label when project has streaming session', () => {
    renderTree({
      streamingSessionKeys: new Set(['agent::thread-1']),
      onRequestDeleteProject: vi.fn(),
    });
    const tree = screen.getByTestId('agent-project-tree');
    fireEvent.contextMenu(within(tree).getByText('Loom'));
    expect(
      screen.getByRole('menuitem', {
        name: 'A conversation is still streaming. Try again when it finishes.',
      })
    ).toBeInTheDocument();
  });

  it('shows streaming loader on the left when session is running', () => {
    renderTree({
      streamingSessionKeys: new Set(['agent::thread-1']),
    });
    expect(screen.getByTestId('session-streaming-loader')).toBeInTheDocument();
    expect(screen.getByTitle('Running')).toBeInTheDocument();
  });

  it('highlights the selected thread even when active project path casing differs', () => {
    const { container } = render(
      <I18nProvider defaultLocale="en-US">
        <AgentProjectTree
          projects={[
            {
              path: PROJECT_PATH,
              name: 'Loom',
              lastOpenedAt: '2026-01-01T00:00:00.000Z',
            },
          ]}
          threadsByProject={{
            [PROJECT_KEY]: [
              {
                id: 'thread-1',
                title: 'Fix Read File Batch Execution',
                updatedAt: Date.now(),
                sessionKey: 'agent::thread-1',
                projectPath: PROJECT_PATH,
              },
            ],
          }}
          activeProjectPath="d:\\test\\project"
          selectedThreadId="thread-1"
          streamingSessionKeys={new Set()}
          hideEmptyProjects={false}
          isExpanded={() => true}
          onToggleExpanded={vi.fn()}
          onAddProject={vi.fn()}
          onToggleHideEmptyProjects={vi.fn()}
          onSelectThread={vi.fn()}
          onNewThreadInProject={vi.fn()}
          renamingThreadId={null}
          renamingTitle=""
          onRenamingTitleChange={vi.fn()}
          onStartRename={vi.fn()}
          onCommitRename={vi.fn()}
          onCancelRename={vi.fn()}
          onRequestDelete={vi.fn()}
          onRequestDeleteProject={vi.fn()}
        />
      </I18nProvider>
    );

    expect(container.querySelector('[class*="threadItemActive"]')).toBeTruthy();
  });
});
