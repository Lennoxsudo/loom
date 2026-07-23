import { memo, type CSSProperties, useEffect, useState } from 'react';
import FileTree from './FileTree';
import { ProjectRootHeader } from './ProjectRootHeader';
import SearchPanel from './SearchPanel';
import GitPanel, { type GitPanelProps } from './GitPanel';
import type { FileNode } from './FileTree';
import type { RenamingItem } from '../types/file';
import { useTranslation } from '../i18n';
import { IndexedProjectsExplorerList } from './IndexedProjectsExplorerList';
import type { CbmIndexedProject } from '../hooks/useIndexedProjects';

export interface SidebarAreaProps {
  sidebarWidth: number;
  isFileTreeCollapsed: boolean;
  activeSidebarView: 'explorer' | 'search' | 'git';
  isResizing: boolean;
  projectName: string;
  projectPath: string | null;
  sortedVisibleFileTree: FileNode[];
  fileTree: FileNode[];
  expandedDirs: Set<string>;
  loadingDirs: Set<string>;
  focusedActiveFilePath: string | null;
  selectedTreeNodePaths: Set<string>;
  treeClipboardMode: 'copy' | 'cut' | null;
  treeClipboardPaths: Set<string>;
  autoRevealCurrentFile: boolean;
  compactFolders: boolean;
  creatingItem: { parentPath: string; type: 'file' | 'folder' } | null;
  renamingItem: RenamingItem | null;
  onToggleCollapse: () => void;
  onCreateFolder: () => void;
  onCreateFile: () => void;
  onOpenFolder: () => void;
  onSelectFile: (filePath: string) => void;
  onActivateTreeNode?: (
    node: FileNode,
    options?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; contextMenu?: boolean }
  ) => void;
  onContextMenuNode?: (
    node: FileNode,
    x: number,
    y: number,
    options?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  ) => void;
  onContextMenuBlank?: (x: number, y: number) => void;
  onToggleDir: (path: string) => void;
  onConfirmCreate: (name: string) => void;
  onCancelCreate: () => void;
  onConfirmRename: (name: string) => void;
  onCancelRename: () => void;
  onSetExplorerWorkingDir: (dir: string | null) => void;
  onOpenSearchMatch: (filePath: string, line: number, column: number, matchLen: number) => void;
  onOpenGitFile: (absolutePath: string) => void;
  onOpenGitFileAtLine?: (absolutePath: string, line: number) => void;
  onGitWorkspaceChanged?: () => void;
  onOpenGitDiffInEditor?: GitPanelProps['onOpenDiffInEditor'];
  onSidebarResizeStart: (e: React.MouseEvent) => void;
  onCollapse: () => void;
  parentPath: string | null | undefined;
  showIndexedProjects?: boolean;
  cbmReady?: boolean;
  indexedProjects?: CbmIndexedProject[];
  indexedProjectsLoading?: boolean;
  onOpenIndexedProject?: (path: string) => void;
  onDeleteIndexedProject?: (path: string) => void;
}

const sidebarStyle: CSSProperties = {
  backgroundColor: 'var(--bg-sidebar)',
  display: 'flex',
  flexDirection: 'column',
};

const explorerContainerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
};

const searchContainerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
};

const gitContainerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
};

const fileListContainerStyle: CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  paddingTop: '10px',
  display: 'flex',
  flexDirection: 'column',
};

const emptyStateStyle: CSSProperties = {
  padding: '20px',
  color: 'var(--text-secondary)',
  fontSize: '12px',
  textAlign: 'center',
};

const resizeHandleStyle: CSSProperties = {
  width: '2px',
  cursor: 'col-resize',
  flexShrink: 0,
  userSelect: 'none',
};

function SidebarAreaBase({
  sidebarWidth,
  isFileTreeCollapsed,
  activeSidebarView,
  isResizing,
  projectName,
  projectPath,
  sortedVisibleFileTree,
  fileTree,
  expandedDirs,
  loadingDirs,
  focusedActiveFilePath,
  selectedTreeNodePaths,
  treeClipboardMode,
  treeClipboardPaths,
  autoRevealCurrentFile,
  compactFolders,
  creatingItem,
  renamingItem,
  onToggleCollapse,
  onCreateFolder,
  onCreateFile,
  onOpenFolder,
  onSelectFile,
  onActivateTreeNode,
  onContextMenuNode,
  onContextMenuBlank,
  onToggleDir,
  onConfirmCreate,
  onCancelCreate,
  onConfirmRename,
  onCancelRename,
  onSetExplorerWorkingDir,
  onOpenSearchMatch,
  onOpenGitFile,
  onOpenGitFileAtLine,
  onGitWorkspaceChanged,
  onOpenGitDiffInEditor,
  onSidebarResizeStart,
  onCollapse,
  parentPath,
  showIndexedProjects = false,
  cbmReady = false,
  indexedProjects = [],
  indexedProjectsLoading = false,
  onOpenIndexedProject,
  onDeleteIndexedProject,
}: SidebarAreaProps) {
  const t = useTranslation();
  const [hasActivatedGitPanel, setHasActivatedGitPanel] = useState(activeSidebarView === 'git');

  useEffect(() => {
    if (activeSidebarView === 'git') {
      setHasActivatedGitPanel(true);
    }
  }, [activeSidebarView]);

  if (isFileTreeCollapsed) {
    return null;
  }

  const resolvedProjectPath = projectPath ?? undefined;

  return (
    <>
      <div
        style={{
          ...sidebarStyle,
          width: `${sidebarWidth}px`,
          display: 'flex',
        }}
      >
        <div
          style={{
            ...explorerContainerStyle,
            display: activeSidebarView === 'explorer' ? 'flex' : 'none',
          }}
        >
          <ProjectRootHeader
            projectName={projectName}
            projectPath={resolvedProjectPath || ''}
            isFileTreeCollapsed={isFileTreeCollapsed}
            onToggleCollapse={onToggleCollapse}
            onCreateFolder={onCreateFolder}
            onCreateFile={onCreateFile}
            onOpenFolder={onOpenFolder}
            onContextMenuBlank={onContextMenuBlank}
          />

          <div style={fileListContainerStyle}>
            {!resolvedProjectPath && showIndexedProjects ? (
              <IndexedProjectsExplorerList
                enabled={showIndexedProjects}
                cbmReady={cbmReady}
                projects={indexedProjects}
                loading={indexedProjectsLoading}
                onOpenProject={(path) => onOpenIndexedProject?.(path)}
                onDeleteIndex={(path) => onDeleteIndexedProject?.(path)}
              />
            ) : null}

            {sortedVisibleFileTree.length > 0 ? (
              <div style={{ flex: 1, minHeight: 0 }}>
                <FileTree
                  nodes={sortedVisibleFileTree}
                  onSelectFile={onSelectFile}
                  onActivateNode={(node, options) => {
                    onActivateTreeNode?.(node, options);
                    if (!node?.path) return;
                    onSetExplorerWorkingDir(node.is_dir ? node.path : null);
                  }}
                  selectedNodePaths={selectedTreeNodePaths}
                  onContextMenuNode={onContextMenuNode}
                  onContextMenuBlank={onContextMenuBlank}
                  activeFilePath={focusedActiveFilePath}
                  autoRevealActiveFile={autoRevealCurrentFile}
                  creatingItem={creatingItem}
                  renamingItem={renamingItem}
                  clipboardMode={treeClipboardMode}
                  clipboardPaths={treeClipboardPaths}
                  compactFolders={compactFolders}
                  onConfirmCreate={onConfirmCreate}
                  onCancelCreate={onCancelCreate}
                  onConfirmRename={onConfirmRename}
                  onCancelRename={onCancelRename}
                  parentPath={parentPath ?? undefined}
                  expandedDirs={expandedDirs}
                  loadingDirs={loadingDirs}
                  onToggleDir={onToggleDir}
                />
              </div>
            ) : resolvedProjectPath ? (
              <div style={emptyStateStyle}>
                {fileTree.length > 0 ? t.preview.filesFilteredByRules : t.search.openFolderToSearch}
              </div>
            ) : !showIndexedProjects ||
              (!indexedProjectsLoading && indexedProjects.length === 0) ? (
              <div style={emptyStateStyle}>{t.search.openFolderToSearch}</div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            ...searchContainerStyle,
            display: activeSidebarView === 'search' ? 'flex' : 'none',
          }}
        >
          <SearchPanel
            projectPath={resolvedProjectPath || ''}
            onCollapse={onCollapse}
            onOpenMatch={onOpenSearchMatch}
          />
        </div>

        {(hasActivatedGitPanel || Boolean(resolvedProjectPath)) && (
          <div
            style={{
              ...gitContainerStyle,
              display: activeSidebarView === 'git' ? 'flex' : 'none',
            }}
          >
            <GitPanel
              projectPath={resolvedProjectPath || ''}
              isActive={activeSidebarView === 'git'}
              onCollapse={onCollapse}
              onOpenFile={onOpenGitFile}
              onOpenFileAtLine={onOpenGitFileAtLine}
              onWorkspaceChanged={onGitWorkspaceChanged}
              onOpenDiffInEditor={onOpenGitDiffInEditor}
            />
          </div>
        )}
      </div>

      <div
        onMouseDown={onSidebarResizeStart}
        style={{
          ...resizeHandleStyle,
          backgroundColor: isResizing ? 'var(--panel-resizer-active)' : 'var(--panel-resizer)',
          transition: isResizing ? 'none' : 'background-color 0.1s',
        }}
        onMouseEnter={(e) => {
          if (!isResizing) e.currentTarget.style.backgroundColor = 'var(--panel-resizer-active)';
        }}
        onMouseLeave={(e) => {
          if (!isResizing) e.currentTarget.style.backgroundColor = 'var(--panel-resizer)';
        }}
      />
    </>
  );
}

export const SidebarArea = memo(SidebarAreaBase);
