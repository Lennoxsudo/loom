import React, { useState, useDeferredValue, memo, useCallback, useMemo, Profiler, ProfilerOnRenderCallback } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { logDebug } from '../utils/errorHandling';
import styles from './FileTree.module.css';
import { useTranslation } from '../i18n';
import { FileTypeIcon } from './shared/FileTypeIcon';
import type { RenamingItem } from '../types/file';

// Throttle utility for scroll events
function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return function(this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
  children_loaded: boolean;
  modified_at?: number;
}

interface FileTreeProps {
  nodes: FileNode[];
  onSelectFile: (path: string) => void;
  onActivateNode?: (
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
  activeFilePath?: string | null;
  autoRevealActiveFile?: boolean;
  selectedNodePaths?: Set<string>;
  clipboardMode?: 'copy' | 'cut' | null;
  clipboardPaths?: Set<string>;
  creatingItem?: { type: 'file' | 'folder'; parentPath: string } | null;
  renamingItem?: RenamingItem | null;
  onConfirmCreate?: (name: string) => void;
  onCancelCreate?: () => void;
  onConfirmRename?: (name: string) => void;
  onCancelRename?: () => void;
  parentPath?: string;
  expandedDirs: Set<string>;
  loadingDirs: Set<string>;
  onToggleDir: (dirPath: string) => void;
  compactFolders?: boolean;
}

type Row =
  | { kind: 'create'; key: string; parentPath: string; level: number }
  | { kind: 'rename'; key: string; node: FileNode; level: number }
  | { kind: 'node'; key: string; node: FileNode; level: number; displayName?: string }
  | { kind: 'loading'; key: string; parentPath: string; level: number };

const ROW_HEIGHT = 26;
const OVERSCAN = 10;

// Performance threshold for deferred rendering
// Reduced from 500 to 200 for better performance on medium-sized directories
const LARGE_DIRECTORY_THRESHOLD = 200;

const normalizePath = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/g, '');

// Simple caches for visible structure calculations to avoid redundant work
const nodeCountCache = new Map<string, number>();
const rowCache = new Map<string, Row[]>();
const NODE_COUNT_CACHE_LIMIT = 100;

function clearOldCacheEntries() {
  if (nodeCountCache.size > NODE_COUNT_CACHE_LIMIT) {
    // Remove oldest entries (first 20%)
    const entries = Array.from(nodeCountCache.entries());
    const toRemove = Math.floor(entries.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      nodeCountCache.delete(entries[i][0]);
    }
  }
  if (rowCache.size > NODE_COUNT_CACHE_LIMIT) {
    const entries = Array.from(rowCache.entries());
    const toRemove = Math.floor(entries.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      rowCache.delete(entries[i][0]);
    }
  }
}

function buildVisibleTreeSignature(
  nodes: FileNode[],
  expandedDirs: Set<string>,
  loadingDirs: Set<string>
): string {
  const parts: string[] = [];
  let visited = 0;
  const SIGNATURE_LIMIT = 4000;

  const walk = (list: FileNode[]) => {
    for (const node of list) {
      if (visited >= SIGNATURE_LIMIT) {
        parts.push('...');
        return;
      }

      const isExpanded = node.is_dir && expandedDirs.has(node.path);
      parts.push(
        `${node.path}|${node.is_dir ? 'd' : 'f'}|${isExpanded ? '1' : '0'}|${node.children_loaded ? '1' : '0'}|${
          node.children?.length ?? 0
        }|${loadingDirs.has(node.path) ? '1' : '0'}`
      );
      visited += 1;

      if (isExpanded && node.children_loaded && node.children && node.children.length > 0) {
        walk(node.children);
        if (visited >= SIGNATURE_LIMIT) {
          return;
        }
      }
    }
  };

  walk(nodes);
  return parts.join('>');
}

function getCompactDirectoryRow(
  node: FileNode,
  compactFolders: boolean
): { node: FileNode; displayName?: string } {
  if (!compactFolders) {
    return { node };
  }

  if (!node.is_dir || !node.children_loaded || !node.children || node.children.length !== 1) {
    return { node };
  }

  const segments = [node.name];
  let current = node;

  while (
    current.children_loaded &&
    current.children &&
    current.children.length === 1 &&
    current.children[0].is_dir
  ) {
    current = current.children[0];
    segments.push(current.name);
  }

  if (current.path === node.path) {
    return { node };
  }

  return {
    node: current,
    displayName: segments.join('/'),
  };
}

// ============================================================================
// Performance Monitoring
// ============================================================================

const renderMetrics = {
  lastRenderTime: 0,
  averageRenderTime: 0,
  renderCount: 0,
  totalRenderTime: 0,
};

const handleFileTreeProfiler: ProfilerOnRenderCallback = (
  _id,
  phase,
  actualDuration,
  _baseDuration,
  _startTime,
  _commitTime
) => {
  renderMetrics.renderCount++;
  renderMetrics.lastRenderTime = actualDuration;
  renderMetrics.totalRenderTime += actualDuration;
  renderMetrics.averageRenderTime = renderMetrics.totalRenderTime / renderMetrics.renderCount;

  if (import.meta.env.DEV && actualDuration > 16) {
    logDebug(`Slow ${phase} render: ${actualDuration.toFixed(2)}ms (avg: ${renderMetrics.averageRenderTime.toFixed(2)}ms)`, 'FileTree');
  }
};

// ============================================================================
// Memoized Components
// ============================================================================

interface FileTreeRowProps {
  node: FileNode;
  level: number;
  displayName?: string;
  isExpanded: boolean;
  isActive: boolean;
  isSelected: boolean;
  isClipboardNode: boolean;
  isCutNode: boolean;
  clipboardMode?: 'copy' | 'cut' | null;
  onToggleDir: (dirPath: string) => void;
  onSelectFile: (path: string) => void;
  onActivateNode?: (
    node: FileNode,
    options?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; contextMenu?: boolean }
  ) => void;
  onContextMenuNode?: (
    node: FileNode,
    x: number,
    y: number,
    options?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  ) => void;
}

/**
 * Memoized file tree row component for optimal re-render performance.
 * Only re-renders when its specific props change.
 */
const FileTreeRow = memo<FileTreeRowProps>(({
  node,
  level,
  displayName,
  isExpanded,
  isActive,
  isSelected,
  isClipboardNode,
  isCutNode,
  clipboardMode,
  onToggleDir,
  onSelectFile,
  onActivateNode,
  onContextMenuNode,
}) => {
  const t = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: node.path,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: node.path,
    disabled: !node.is_dir,
  });

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const selectionOptions = {
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
    };
    onActivateNode?.(node, selectionOptions);
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      return;
    }
    if (node.is_dir) {
      onToggleDir(node.path);
    } else {
      onSelectFile(node.path);
    }
  }, [node, onActivateNode, onToggleDir, onSelectFile]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!onContextMenuNode) return;
    e.preventDefault();
    e.stopPropagation();
    const selectionOptions = {
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
    };
    onActivateNode?.(node, { ...selectionOptions, contextMenu: true });
    onContextMenuNode(node, e.clientX, e.clientY, selectionOptions);
  }, [node, onActivateNode, onContextMenuNode]);

  const handleNativeDragStart = useCallback((e: React.DragEvent) => {
    if (node.is_dir) {
      e.preventDefault();
      return;
    }

    e.dataTransfer.setData('application/file-path', node.path);
    e.dataTransfer.setData('application/file-name', node.name);
    e.dataTransfer.effectAllowed = 'copy';
  }, [node.path, node.name, node.is_dir]);

  const rowClasses = [
    styles.treeRow,
    !node.is_dir && styles.treeRowFile,
    isSelected && styles.treeRowSelected,
    isActive && styles.treeRowActive,
    isClipboardNode && styles.treeRowClipboard,
    isCutNode && styles.treeRowCut,
    isOver && styles.treeRowDropTarget,
    isDragging && styles.treeRowDragging,
  ].filter(Boolean).join(' ');

  const paddingLeft = `${level * 10 + 5}px`;

  return (
    <div
      ref={(el) => {
        setDragRef(el);
        setDropRef(el);
      }}
      {...listeners}
      {...attributes}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={node.path}
      className={rowClasses}
      style={{ paddingLeft }}
    >
      <span className={styles.iconSpacer}>
        {node.is_dir ? (
          <span className={`${styles.expandIcon} ${isExpanded ? styles.expandIconExpanded : ''}`}>
            ▶
          </span>
        ) : (
          <span className={styles.iconSpacerSmall} />
        )}
      </span>
      <span
        className={`${styles.fileIcon} ${!node.is_dir ? styles.fileIconDraggable : ''}`}
        {...(!node.is_dir
          ? {
              draggable: true,
              onDragStart: handleNativeDragStart,
              onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
              onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
              title: t.fileTree.dragToChatHint,
            }
          : {})}
      >
        <FileTypeIcon
          name={node.name}
          isDir={node.is_dir}
          isExpanded={isExpanded}
        />
      </span>
      <span className={styles.fileName}>
        {displayName ?? node.name}
      </span>
      {isClipboardNode && clipboardMode && (!node.is_dir || clipboardMode === 'cut') ? (
        <span
          className={`${styles.clipboardBadge} ${
            clipboardMode === 'cut' ? styles.clipboardBadgeCut : styles.clipboardBadgeCopy
          }`}
          title={clipboardMode === 'cut' ? 'Cut selection' : 'Copied selection'}
        />
      ) : null}
    </div>
  );
});

FileTreeRow.displayName = 'FileTreeRow';

// ============================================================================
// Create Item Input
// ============================================================================

interface CreateItemInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputValue: string;
  setInputValue: (value: string) => void;
  isFolder: boolean;
  onConfirm?: (name: string) => void;
  onCancel?: () => void;
  isEditingRef: React.MutableRefObject<boolean>;
  onFocusInput?: (input: HTMLInputElement) => void;
}

const CreateItemInput = memo<CreateItemInputProps>(({
  inputRef,
  inputValue,
  setInputValue,
  isFolder,
  onConfirm,
  onCancel,
  isEditingRef,
  onFocusInput,
}) => {
  const iconName = inputValue.trim() || (isFolder ? 'newfolder' : 'newfile');
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onConfirm?.(inputValue);
      setInputValue('');
    } else if (e.key === 'Escape') {
      onCancel?.();
      setInputValue('');
    }
  }, [inputValue, onConfirm, onCancel, setInputValue]);

  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (isEditingRef.current) return;

    const relatedTarget = e.relatedTarget as HTMLElement;
    if (relatedTarget && e.currentTarget.contains(relatedTarget)) return;

    if (inputValue.trim()) {
      onConfirm?.(inputValue);
    } else {
      onCancel?.();
    }
    setInputValue('');
  }, [inputValue, onConfirm, onCancel, setInputValue, isEditingRef]);

  return (
    <div className={styles.createInputContainer}>
      <span className={styles.iconSpacer}>
        <span className={styles.iconSpacerSmall} />
      </span>
      <span className={styles.fileIcon}>
        <FileTypeIcon name={iconName} isDir={isFolder} />
      </span>
      <input
        ref={inputRef}
        autoFocus
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onFocus={(e) => onFocusInput?.(e.currentTarget)}
        className={styles.createInput}
      />
    </div>
  );
});

CreateItemInput.displayName = 'CreateItemInput';

// ============================================================================
// Loading Row Component
// ============================================================================

interface LoadingRowProps {
  level: number;
}

const LoadingRow = memo<LoadingRowProps>(({ level }) => (
  <div
    className={styles.loadingRow}
    style={{ paddingLeft: `${level * 10 + 34}px` }}
  >
    Loading...
  </div>
));

LoadingRow.displayName = 'LoadingRow';

// ============================================================================
// Main FileTree Component
// ============================================================================

const FileTree: React.FC<FileTreeProps> = ({
  nodes,
  onSelectFile,
  onActivateNode,
  onContextMenuNode,
  onContextMenuBlank,
  activeFilePath,
  autoRevealActiveFile = true,
  selectedNodePaths,
  clipboardMode,
  clipboardPaths,
  creatingItem,
  renamingItem,
  onConfirmCreate,
  onCancelCreate,
  onConfirmRename,
  onCancelRename,
  parentPath,
  expandedDirs,
  loadingDirs,
  onToggleDir,
  compactFolders = true,
}) => {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const [createInputValue, setCreateInputValue] = useState('');
  const [renameInputValue, setRenameInputValue] = useState('');
  const createInputRef = React.useRef<HTMLInputElement>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const isCreatingRef = React.useRef(false);
  const isRenamingRef = React.useRef(false);
  const pendingRevealActiveFilePathRef = React.useRef<string | null>(activeFilePath ?? null);

  // Memoize normalized paths to avoid unnecessary recalculations
  const normalizedRoot = useMemo(() => 
    parentPath ? normalizePath(parentPath) : '', 
    [parentPath]
  );
  const normalizedCreating = useMemo(() => 
    creatingItem ? normalizePath(creatingItem.parentPath) : '', 
    [creatingItem]
  );
  const normalizedRenaming = useMemo(() =>
    renamingItem ? normalizePath(renamingItem.path) : '',
    [renamingItem]
  );
  const visibleTreeSignature = useMemo(
    () => buildVisibleTreeSignature(nodes, expandedDirs, loadingDirs),
    [nodes, expandedDirs, loadingDirs]
  );

  // Compute total node count to determine if we need deferred rendering
  // Using cache to avoid redundant computations for the same node structure
  const nodeCount = useMemo(() => {
    const cacheKey = visibleTreeSignature;
    
    // Check cache first
    if (nodeCountCache.has(cacheKey)) {
      return nodeCountCache.get(cacheKey)!;
    }
    
    const count = (list: FileNode[]): number => 
      list.reduce((acc, node) => {
        if (node.is_dir && expandedDirs.has(node.path) && node.children) {
          return acc + 1 + count(node.children);
        }
        return acc + 1;
      }, 0);
    
    const result = count(nodes);
    
    // Cache the result
    nodeCountCache.set(cacheKey, result);
    clearOldCacheEntries();
    
    return result;
  }, [nodes, expandedDirs, visibleTreeSignature]);

  const isLargeDirectory = nodeCount > LARGE_DIRECTORY_THRESHOLD;

  // Compute rows - use deferred value for large directories
  const urgentRows = useMemo<Row[]>(() => {
    const cacheKey = [
      visibleTreeSignature,
      normalizedRoot,
      compactFolders ? 'compact' : 'expanded',
      creatingItem?.type ?? '',
      normalizedCreating,
      normalizedRenaming,
    ].join('::');
    const cachedRows = rowCache.get(cacheKey);
    if (cachedRows) {
      return cachedRows;
    }

    const out: Row[] = [];

    if (creatingItem && normalizedRoot && normalizedCreating === normalizedRoot) {
      out.push({
        kind: 'create',
        key: `create:${normalizedRoot}`,
        parentPath: normalizedRoot,
        level: 0,
      });
    }

    const walk = (list: FileNode[], level: number) => {
      for (const originalNode of list) {
        const { node, displayName } = getCompactDirectoryRow(originalNode, compactFolders);
        const key = `node:${node.path}`;
        if (renamingItem && normalizePath(node.path) === normalizedRenaming) {
          out.push({ kind: 'rename', key: `rename:${node.path}`, node, level });
        } else {
          out.push({ kind: 'node', key, node, level, displayName });
        }

        if (node.is_dir && expandedDirs.has(node.path)) {
          if (creatingItem && normalizedCreating === normalizePath(node.path)) {
            out.push({
              kind: 'create',
              key: `create:${node.path}`,
              parentPath: node.path,
              level: level + 1,
            });
          }

          if (!node.children_loaded) {
            if (loadingDirs.has(node.path)) {
              out.push({
                kind: 'loading',
                key: `loading:${node.path}`,
                parentPath: node.path,
                level: level + 1,
              });
            }
            continue;
          }

          if (node.children && node.children.length > 0) {
            walk(node.children, level + 1);
          }
        }
      }
    };

    walk(nodes, 0);
    rowCache.set(cacheKey, out);
    clearOldCacheEntries();
    return out;
  }, [
    nodes,
    expandedDirs,
    loadingDirs,
    creatingItem,
    renamingItem,
    normalizedRoot,
    normalizedCreating,
    normalizedRenaming,
    visibleTreeSignature,
    compactFolders,
  ]);

  // Defer rendering for large directories to keep UI responsive
  // useDeferredValue 必须在顶层调用，不能条件调用
  const deferredRows = useDeferredValue(urgentRows);
  const rows = isLargeDirectory ? deferredRows : urgentRows;

  // Track viewport height with ResizeObserver
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
    });
    ro.observe(el);
    setViewportHeight(el.clientHeight);

    return () => ro.disconnect();
  }, []);

  const totalHeight = rows.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
  );

  // Auto-scroll to editing row and focus input
  React.useEffect(() => {
    const idx = rows.findIndex((r) => {
      if (creatingItem && r.kind === 'create') {
        return normalizePath((r as { parentPath: string }).parentPath) === normalizedCreating;
      }
      if (renamingItem && r.kind === 'rename') {
        return normalizePath(r.node.path) === normalizedRenaming;
      }
      return false;
    });
    if (idx === -1) return;

    const el = scrollRef.current;
    if (!el) return;

    const top = idx * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < el.scrollTop) {
      el.scrollTop = top;
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, bottom - el.clientHeight);
    }

    const targetInputRef = creatingItem ? createInputRef : renamingItem ? renameInputRef : null;
    const editingRef = creatingItem ? isCreatingRef : isRenamingRef;

    if (targetInputRef?.current) {
      editingRef.current = true;
      setTimeout(() => {
        targetInputRef.current?.focus();
        setTimeout(() => {
          editingRef.current = false;
        }, 50);
      }, 0);
    }
  }, [creatingItem, renamingItem, rows, normalizedCreating, normalizedRenaming]);

  React.useEffect(() => {
    pendingRevealActiveFilePathRef.current = activeFilePath ?? null;
  }, [activeFilePath]);

  React.useEffect(() => {
    if (!autoRevealActiveFile || !activeFilePath) {
      return;
    }

    if (pendingRevealActiveFilePathRef.current !== activeFilePath) {
      return;
    }

    const idx = rows.findIndex((row) => row.kind === 'node' && row.node.path === activeFilePath);
    if (idx === -1) {
      return;
    }

    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const top = idx * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    const viewportTop = el.scrollTop;
    const viewportBottom = viewportTop + el.clientHeight;

    if (top >= viewportTop && bottom <= viewportBottom) {
      pendingRevealActiveFilePathRef.current = null;
      return;
    }

    const centeredTop = Math.max(0, top - Math.max(0, Math.floor((el.clientHeight - ROW_HEIGHT) / 2)));
    el.scrollTop = centeredTop;
    pendingRevealActiveFilePathRef.current = null;
  }, [activeFilePath, autoRevealActiveFile, rows]);

  React.useEffect(() => {
    if (!renamingItem) {
      setRenameInputValue('');
      return;
    }
    setRenameInputValue(renamingItem.name);
  }, [renamingItem]);

  // Stable callback references for memoized children
  const handleSelectFile = useCallback((path: string) => {
    onSelectFile(path);
  }, [onSelectFile]);

  const handleToggleDir = useCallback((dirPath: string) => {
    onToggleDir(dirPath);
  }, [onToggleDir]);

  const handleActivateNode = useCallback((node: FileNode, options?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; contextMenu?: boolean }) => {
    onActivateNode?.(node, options);
  }, [onActivateNode]);

  const handleContextMenuNode = useCallback((
    node: FileNode,
    x: number,
    y: number,
    options?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  ) => {
    onContextMenuNode?.(node, x, y, options);
  }, [onContextMenuNode]);

  // Throttle scroll events to improve performance during rapid scrolling
  const handleScroll = useCallback(
    throttle((e: React.UIEvent<HTMLDivElement>) => {
      setScrollTop(e.currentTarget.scrollTop);
    }, 16), // ~60fps
    []
  );

  return (
    <Profiler id="FileTree" onRender={handleFileTreeProfiler}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onContextMenu={(e) => {
          if (!onContextMenuBlank) return;
          e.preventDefault();
          onContextMenuBlank(e.clientX, e.clientY);
        }}
        className={styles.container}
        data-file-tree="true"
        data-large-directory={isLargeDirectory || undefined}
      >
        <div className={styles.virtualList} style={{ height: `${totalHeight}px` }}>
          {rows.slice(startIndex, endIndex).map((row, i) => {
            const index = startIndex + i;
            const top = index * ROW_HEIGHT;

            return (
              <div
                key={row.key}
                className={styles.row}
                style={{ top }}
              >
                {row.kind === 'create' ? (
                  <div style={{ paddingLeft: `${row.level * 10}px` }}>
                    <CreateItemInput
                      inputRef={createInputRef}
                      inputValue={createInputValue}
                      setInputValue={setCreateInputValue}
                      isFolder={creatingItem?.type === 'folder'}
                      onConfirm={onConfirmCreate}
                      onCancel={onCancelCreate}
                      isEditingRef={isCreatingRef}
                    />
                  </div>
                ) : row.kind === 'rename' ? (
                  <div style={{ paddingLeft: `${row.level * 10}px` }}>
                    <CreateItemInput
                      inputRef={renameInputRef}
                      inputValue={renameInputValue}
                      setInputValue={setRenameInputValue}
                      isFolder={row.node.is_dir}
                      onConfirm={onConfirmRename}
                      onCancel={onCancelRename}
                      isEditingRef={isRenamingRef}
                      onFocusInput={(input) => {
                        const dotIndex = row.node.is_dir ? -1 : row.node.name.lastIndexOf('.');
                        const selectionEnd = dotIndex > 0 ? dotIndex : row.node.name.length;
                        input.setSelectionRange(0, selectionEnd);
                      }}
                    />
                  </div>
                ) : row.kind === 'loading' ? (
                  <LoadingRow level={row.level} />
                ) : (
                  <FileTreeRow
                    node={row.node}
                    level={row.level}
                    displayName={row.displayName}
                    isExpanded={row.node.is_dir && expandedDirs.has(row.node.path)}
                    isActive={!row.node.is_dir && row.node.path === activeFilePath}
                    isSelected={selectedNodePaths?.has(row.node.path) ?? false}
                    isClipboardNode={clipboardPaths?.has(row.node.path) ?? false}
                    isCutNode={clipboardMode === 'cut' && (clipboardPaths?.has(row.node.path) ?? false)}
                    clipboardMode={clipboardMode}
                    onToggleDir={handleToggleDir}
                    onSelectFile={handleSelectFile}
                    onActivateNode={handleActivateNode}
                    onContextMenuNode={handleContextMenuNode}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Profiler>
  );
};

export default FileTree;
