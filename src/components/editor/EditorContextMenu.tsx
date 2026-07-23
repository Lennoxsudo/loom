import { useRef, useEffect, useMemo, useCallback, useLayoutEffect, useState } from 'react';
import type { EditorGroupId } from '../../types/app';
import { showError } from '../../utils/notification';
import { getExtLower } from '../../utils/pathUtils';
import { isPathUnderRoot, normalizePathForCompare } from '../../utils/pathUtils';
import { useTranslation } from '../../i18n';
import styles from './EditorContextMenu.module.css';

export interface EditorContextMenuProps {
  x: number;
  y: number;
  groupId: EditorGroupId;
  onClose: () => void;
  onRunCommand: (groupId: EditorGroupId, commandId: string) => void;
  editorInstance: {
    getSelection?: () => { isEmpty?: () => boolean } | null;
    getAction?: (id: string) => { isSupported?: () => boolean } | null;
  } | null;
  activeFilePath: string | null;
  projectPath: string | null;
  liveServerStatus: {
    running: boolean;
    port?: number | null;
    root?: string | null;
  };
  onOpenWithLiveServer: (filePath: string, projectPath: string | null) => Promise<void>;
  onOpenInBrowser: (filePath: string, projectPath: string | null) => Promise<void>;
  onStopLiveServer: () => Promise<void>;
  onRefreshLiveServerStatus: () => Promise<unknown>;
}

type MenuEntry =
  | { kind: 'cmd'; key: string; label: string; commandId: string; isEnabled?: boolean }
  | {
      kind: 'action';
      key: string;
      label: string;
      onSelect: () => Promise<void>;
      isEnabled?: boolean;
    }
  | { kind: 'sep'; key: string };

export function EditorContextMenu({
  x,
  y,
  groupId,
  onClose,
  onRunCommand,
  editorInstance,
  activeFilePath,
  projectPath,
  liveServerStatus,
  onOpenWithLiveServer,
  onOpenInBrowser,
  onStopLiveServer,
  onRefreshLiveServerStatus,
}: EditorContextMenuProps) {
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
    const { innerWidth, innerHeight } = window;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(margin, innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, innerHeight - rect.height - margin);

    setPosition({
      left: Math.min(Math.max(x, margin), maxLeft),
      top: Math.min(Math.max(y, margin), maxTop),
      ready: true,
    });
  }, [x, y]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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

  const hasSelection = useMemo(() => {
    const selection = editorInstance?.getSelection?.();
    return !!selection && (typeof selection.isEmpty === 'function' ? !selection.isEmpty() : true);
  }, [editorInstance]);

  const actionSupported = useCallback(
    (commandId: string): boolean => {
      try {
        const action = editorInstance?.getAction?.(commandId);
        if (!action) return true;
        if (typeof action.isSupported === 'function') {
          return !!action.isSupported();
        }
        return true;
      } catch {
        return true;
      }
    },
    [editorInstance]
  );

  const liveServerContext = useMemo(() => {
    const isHtmlActive = activeFilePath
      ? (() => {
          const ext = getExtLower(activeFilePath);
          return ext === 'html' || ext === 'htm';
        })()
      : false;

    const hasProject = !!projectPath;
    const inProject =
      !!activeFilePath && hasProject && isPathUnderRoot(activeFilePath, projectPath);
    const liveMatchesProject =
      liveServerStatus.running &&
      !!liveServerStatus.port &&
      (!liveServerStatus.root ||
        (hasProject &&
          normalizePathForCompare(liveServerStatus.root) === normalizePathForCompare(projectPath)));

    return {
      canLiveServerStart: !!activeFilePath && isHtmlActive && inProject,
      canLiveServerOpen: !!activeFilePath && isHtmlActive && inProject && liveMatchesProject,
      canLiveServerStop: liveServerStatus.running,
    };
  }, [activeFilePath, projectPath, liveServerStatus]);

  const runMenuAction = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      showError(String(e));
    } finally {
      onClose();
    }
  };

  const menuEntries: MenuEntry[] = useMemo(
    () => [
      {
        kind: 'cmd',
        key: 'undo',
        label: t.editorContextMenu.undo,
        commandId: 'undo',
        isEnabled: actionSupported('undo'),
      },
      { kind: 'sep', key: 'sep-1' },
      {
        kind: 'cmd',
        key: 'cut',
        label: t.editorContextMenu.cut,
        commandId: 'editor.action.clipboardCutAction',
        isEnabled: hasSelection && actionSupported('editor.action.clipboardCutAction'),
      },
      {
        kind: 'cmd',
        key: 'copy',
        label: t.editorContextMenu.copy,
        commandId: 'editor.action.clipboardCopyAction',
        isEnabled: hasSelection && actionSupported('editor.action.clipboardCopyAction'),
      },
      {
        kind: 'cmd',
        key: 'copyAllCode',
        label: t.editorContextMenu.copyAllCode,
        commandId: 'editor.copyAllCode',
        isEnabled: !!editorInstance,
      },
      {
        kind: 'cmd',
        key: 'paste',
        label: t.editorContextMenu.paste,
        commandId: 'editor.action.clipboardPasteAction',
        isEnabled: actionSupported('editor.action.clipboardPasteAction'),
      },
      {
        kind: 'cmd',
        key: 'selectAll',
        label: t.editorContextMenu.selectAll,
        commandId: 'editor.action.selectAll',
        isEnabled: actionSupported('editor.action.selectAll'),
      },
      { kind: 'sep', key: 'sep-2' },
      {
        kind: 'cmd',
        key: 'find',
        label: t.editorContextMenu.find,
        commandId: 'actions.find',
        isEnabled: actionSupported('actions.find'),
      },
      {
        kind: 'cmd',
        key: 'replace',
        label: t.editorContextMenu.replace,
        commandId: 'editor.action.startFindReplaceAction',
        isEnabled: actionSupported('editor.action.startFindReplaceAction'),
      },
      {
        kind: 'cmd',
        key: 'gotoLine',
        label: t.editorContextMenu.gotoLine,
        commandId: 'editor.action.gotoLine',
        isEnabled: actionSupported('editor.action.gotoLine'),
      },
      {
        kind: 'cmd',
        key: 'format',
        label: t.editorContextMenu.formatDocument,
        commandId: 'editor.action.formatDocument',
        isEnabled: actionSupported('editor.action.formatDocument'),
      },
      { kind: 'sep', key: 'sep-live-1' },
      {
        kind: 'action',
        key: 'live-open',
        label: t.editorContextMenu.openWithLiveServer,
        isEnabled: liveServerContext.canLiveServerStart,
        onSelect: async () => {
          if (activeFilePath) {
            await onOpenWithLiveServer(activeFilePath, projectPath);
          }
        },
      },
      {
        kind: 'action',
        key: 'live-open-browser',
        label: t.editorContextMenu.openInBrowser,
        isEnabled: liveServerContext.canLiveServerOpen,
        onSelect: async () => {
          if (activeFilePath) {
            await onOpenInBrowser(activeFilePath, projectPath);
          }
        },
      },
      {
        kind: 'action',
        key: 'live-stop',
        label: t.editorContextMenu.stopLiveServer,
        isEnabled: liveServerContext.canLiveServerStop,
        onSelect: async () => {
          await onStopLiveServer();
          await onRefreshLiveServerStatus();
        },
      },
    ],
    [
      t,
      actionSupported,
      hasSelection,
      liveServerContext,
      activeFilePath,
      projectPath,
      onOpenWithLiveServer,
      onOpenInBrowser,
      onStopLiveServer,
      onRefreshLiveServerStatus,
    ]
  );

  return (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? 'visible' : 'hidden',
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {menuEntries.map((entry) => {
        if (entry.kind === 'sep') {
          return <div key={entry.key} className={styles.menuSeparator} />;
        }

        const enabled = entry.isEnabled !== false;

        return (
          <div
            key={entry.key}
            className={`${styles.menuItem} ${!enabled ? styles.menuItemDisabled : ''}`}
            onClick={() => {
              if (!enabled) return;
              if (entry.kind === 'cmd') {
                onRunCommand(groupId, entry.commandId);
                onClose();
                return;
              }
              void runMenuAction(() => entry.onSelect());
            }}
          >
            {entry.label}
          </div>
        );
      })}
    </div>
  );
}
