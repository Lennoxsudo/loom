import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarArea } from './SidebarArea';
import type { SidebarAreaProps } from './SidebarArea';

vi.mock('../i18n', () => ({
  useTranslation: () => ({
    preview: { filesFilteredByRules: 'files filtered' },
    search: { openFolderToSearch: 'open folder to search' },
  }),
}));

vi.mock('./FileTree', () => ({
  default: () => <div>FileTree</div>,
}));

vi.mock('./ProjectRootHeader', () => ({
  ProjectRootHeader: () => <div>ProjectRootHeader</div>,
}));

vi.mock('./SearchPanel', () => ({
  default: () => <div>SearchPanel</div>,
}));

vi.mock('./GitPanel', () => ({
  default: () => <div>GitPanel</div>,
}));

function createProps(overrides: Partial<SidebarAreaProps> = {}): SidebarAreaProps {
  return {
    sidebarWidth: 280,
    isFileTreeCollapsed: false,
    activeSidebarView: 'explorer',
    isResizing: false,
    projectName: 'demo',
    projectPath: 'D:\\project\\demo',
    sortedVisibleFileTree: [],
    fileTree: [],
    expandedDirs: new Set(),
    loadingDirs: new Set(),
    focusedActiveFilePath: null,
    selectedTreeNodePaths: new Set(),
    treeClipboardMode: null,
    treeClipboardPaths: new Set(),
    autoRevealCurrentFile: true,
    compactFolders: false,
    creatingItem: null,
    renamingItem: null,
    onToggleCollapse: vi.fn(),
    onCreateFolder: vi.fn(),
    onCreateFile: vi.fn(),
    onOpenFolder: vi.fn(),
    onSelectFile: vi.fn(),
    onToggleDir: vi.fn(),
    onConfirmCreate: vi.fn(),
    onCancelCreate: vi.fn(),
    onConfirmRename: vi.fn(),
    onCancelRename: vi.fn(),
    onSetExplorerWorkingDir: vi.fn(),
    onOpenSearchMatch: vi.fn(),
    onOpenGitFile: vi.fn(),
    onSidebarResizeStart: vi.fn(),
    onCollapse: vi.fn(),
    parentPath: null,
    ...overrides,
  };
}

describe('SidebarArea', () => {
  afterEach(() => {
    cleanup();
  });

  it('mounts GitPanel in the background when a project folder is open', () => {
    render(
      <SidebarArea {...createProps({ activeSidebarView: 'explorer', projectPath: 'D:\\demo' })} />
    );

    expect(screen.getByText('GitPanel')).toBeInTheDocument();
  });

  it('does not mount GitPanel before a project is opened and git was never activated', () => {
    render(<SidebarArea {...createProps({ activeSidebarView: 'explorer', projectPath: null })} />);

    expect(screen.queryByText('GitPanel')).not.toBeInTheDocument();
  });

  it('mounts GitPanel when the git sidebar is active', () => {
    render(<SidebarArea {...createProps({ activeSidebarView: 'git' })} />);

    expect(screen.getByText('GitPanel')).toBeInTheDocument();
  });

  it('keeps GitPanel mounted after first activation to avoid reloading on every reopen', () => {
    const { rerender } = render(<SidebarArea {...createProps({ activeSidebarView: 'git' })} />);

    expect(screen.getByText('GitPanel')).toBeInTheDocument();

    rerender(<SidebarArea {...createProps({ activeSidebarView: 'explorer' })} />);

    expect(screen.getByText('GitPanel')).toBeInTheDocument();
  });
});
