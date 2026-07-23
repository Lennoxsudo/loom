import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FileNode } from './FileTree';
import { useTranslation } from '../i18n';
import styles from './FileTreeContextMenu.module.css';

interface FileTreeContextMenuProps {
  x: number;
  y: number;
  node?: FileNode | null;
  onClose: () => void;
  onCreateFile: (node: FileNode) => void;
  onCreateFolder: (node: FileNode) => void;
  isNodeExpanded?: boolean;
  onToggleNodeExpanded?: (node: FileNode) => void;
  onCopyNode?: (node: FileNode) => void;
  onCutNode?: (node: FileNode) => void;
  onPasteIntoNode?: (node: FileNode) => void;
  canPasteIntoNode?: (node: FileNode) => boolean;
  onRename: (node: FileNode) => void;
  onDelete: (node: FileNode) => void;
  onCopyPath: (node: FileNode) => void;
  onCopyRelativePath: (node: FileNode) => void;
  onRevealInExplorer: (node: FileNode) => void;
  onRefresh: (node: FileNode) => void;
  onCreateFileAtRoot?: () => void;
  onCreateFolderAtRoot?: () => void;
  onPasteAtRoot?: () => void;
  canPasteAtRoot?: boolean;
  onCopyPathAtRoot?: () => void;
  onCopyRelativePathAtRoot?: () => void;
  onRevealInExplorerAtRoot?: () => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  onRefreshRoot?: () => void;
}

type MenuEntry =
  | { kind: 'action'; key: string; label: string; onSelect: () => void; isEnabled?: boolean }
  | { kind: 'sep'; key: string };

export function FileTreeContextMenu({
  x,
  y,
  node,
  onClose,
  onCreateFile,
  onCreateFolder,
  isNodeExpanded,
  onToggleNodeExpanded,
  onCopyNode,
  onCutNode,
  onPasteIntoNode,
  canPasteIntoNode,
  onRename,
  onDelete,
  onCopyPath,
  onCopyRelativePath,
  onRevealInExplorer,
  onRefresh,
  onCreateFileAtRoot,
  onCreateFolderAtRoot,
  onPasteAtRoot,
  canPasteAtRoot,
  onCopyPathAtRoot,
  onCopyRelativePathAtRoot,
  onRevealInExplorerAtRoot,
  onExpandAll,
  onCollapseAll,
  onRefreshRoot,
}: FileTreeContextMenuProps) {
  const t = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y, ready: false });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      setPosition({ left: x, top: y, ready: true });
      return;
    }

    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);

    setPosition({
      left: Math.min(Math.max(x, margin), maxLeft),
      top: Math.min(Math.max(y, margin), maxTop),
      ready: true,
    });
  }, [x, y]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const menuEntries = useMemo<MenuEntry[]>(() => {
    const entries: MenuEntry[] = [];

    if (!node) {
      if (onCreateFileAtRoot) {
        entries.push({
          kind: 'action',
          key: 'new-file-root',
          label: t.fileTree.newFile,
          onSelect: onCreateFileAtRoot,
        });
      }
      if (onCreateFolderAtRoot) {
        entries.push({
          kind: 'action',
          key: 'new-folder-root',
          label: t.fileTree.newFolder,
          onSelect: onCreateFolderAtRoot,
        });
      }
      if (onCreateFileAtRoot || onCreateFolderAtRoot) {
        entries.push({ kind: 'sep', key: 'sep-root-create' });
      }
      if (onPasteAtRoot) {
        entries.push({
          kind: 'action',
          key: 'paste-root',
          label: t.actions.paste,
          onSelect: onPasteAtRoot,
          isEnabled: canPasteAtRoot !== false,
        });
        entries.push({ kind: 'sep', key: 'sep-root-paste' });
      }
      if (onCopyPathAtRoot) {
        entries.push({
          kind: 'action',
          key: 'copy-path-root',
          label: t.fileTree.copyPath,
          onSelect: onCopyPathAtRoot,
        });
      }
      if (onCopyRelativePathAtRoot) {
        entries.push({
          kind: 'action',
          key: 'copy-relative-path-root',
          label: t.fileTree.copyRelativePath,
          onSelect: onCopyRelativePathAtRoot,
        });
      }
      if (onRevealInExplorerAtRoot) {
        entries.push({
          kind: 'action',
          key: 'reveal-in-explorer-root',
          label: t.fileTree.revealInExplorer,
          onSelect: onRevealInExplorerAtRoot,
        });
      }
      if (onCopyPathAtRoot || onCopyRelativePathAtRoot || onRevealInExplorerAtRoot) {
        entries.push({ kind: 'sep', key: 'sep-root-path' });
      }
      if (onExpandAll) {
        entries.push({
          kind: 'action',
          key: 'expand-all',
          label: t.fileTree.expandAll,
          onSelect: onExpandAll,
        });
      }
      if (onCollapseAll) {
        entries.push({
          kind: 'action',
          key: 'collapse-all',
          label: t.fileTree.collapseAll,
          onSelect: onCollapseAll,
        });
      }
      if (onRefreshRoot) {
        entries.push({
          kind: 'action',
          key: 'refresh-root',
          label: t.fileTree.refresh,
          onSelect: onRefreshRoot,
        });
      }
      return entries;
    }

    if (node.is_dir) {
      entries.push(
        {
          kind: 'action',
          key: 'new-file',
          label: t.fileTree.newFile,
          onSelect: () => onCreateFile(node),
        },
        {
          kind: 'action',
          key: 'new-folder',
          label: t.fileTree.newFolder,
          onSelect: () => onCreateFolder(node),
        },
        ...(onToggleNodeExpanded
          ? [
              {
                kind: 'action' as const,
                key: 'toggle-expand',
                label: isNodeExpanded ? t.actions.collapse : t.actions.expand,
                onSelect: () => onToggleNodeExpanded(node),
              },
            ]
          : []),
        { kind: 'sep', key: 'sep-create' }
      );
    }

    entries.push(
      ...(onCopyNode
        ? [
            {
              kind: 'action' as const,
              key: 'copy-node',
              label: t.actions.copy,
              onSelect: () => onCopyNode(node),
            },
          ]
        : []),
      ...(onCutNode
        ? [
            {
              kind: 'action' as const,
              key: 'cut-node',
              label: t.actions.cut,
              onSelect: () => onCutNode(node),
            },
          ]
        : []),
      ...(onPasteIntoNode
        ? [
            {
              kind: 'action' as const,
              key: 'paste-node',
              label: t.actions.paste,
              onSelect: () => onPasteIntoNode(node),
              isEnabled: canPasteIntoNode ? canPasteIntoNode(node) : true,
            },
          ]
        : []),
      ...(onCopyNode || onCutNode || onPasteIntoNode
        ? [{ kind: 'sep' as const, key: 'sep-copy-paste' }]
        : []),
      { kind: 'action', key: 'rename', label: t.fileTree.rename, onSelect: () => onRename(node) },
      { kind: 'action', key: 'delete', label: t.fileTree.delete, onSelect: () => onDelete(node) },
      { kind: 'sep', key: 'sep-path' },
      {
        kind: 'action',
        key: 'copy-path',
        label: t.fileTree.copyPath,
        onSelect: () => onCopyPath(node),
      },
      {
        kind: 'action',
        key: 'copy-relative-path',
        label: t.fileTree.copyRelativePath,
        onSelect: () => onCopyRelativePath(node),
      },
      {
        kind: 'action',
        key: 'reveal-in-explorer',
        label: t.fileTree.revealInExplorer,
        onSelect: () => onRevealInExplorer(node),
      }
    );

    if (node.is_dir) {
      entries.push(
        { kind: 'sep', key: 'sep-refresh' },
        {
          kind: 'action',
          key: 'refresh',
          label: t.fileTree.refresh,
          onSelect: () => onRefresh(node),
        }
      );
    }

    return entries;
  }, [
    canPasteAtRoot,
    canPasteIntoNode,
    isNodeExpanded,
    node,
    onCollapseAll,
    onCopyNode,
    onCopyPath,
    onCopyPathAtRoot,
    onCopyRelativePath,
    onCopyRelativePathAtRoot,
    onCreateFile,
    onCreateFileAtRoot,
    onCreateFolder,
    onCreateFolderAtRoot,
    onCutNode,
    onDelete,
    onExpandAll,
    onPasteAtRoot,
    onPasteIntoNode,
    onRefresh,
    onRefreshRoot,
    onRename,
    onRevealInExplorer,
    onRevealInExplorerAtRoot,
    onToggleNodeExpanded,
    t,
  ]);

  return (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? 'visible' : 'hidden',
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {menuEntries.map((entry) => {
        if (entry.kind === 'sep') {
          return <div key={entry.key} className={styles.menuSeparator} />;
        }

        return (
          <div
            key={entry.key}
            className={`${styles.menuItem} ${entry.isEnabled === false ? styles.menuItemDisabled : ''}`}
            onClick={() => {
              if (entry.isEnabled === false) {
                return;
              }
              entry.onSelect();
              onClose();
            }}
          >
            {entry.label}
          </div>
        );
      })}
    </div>
  );
}
