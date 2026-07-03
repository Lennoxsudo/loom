import { useRef, useCallback, useEffect } from 'react';
import type { EditorGroupId, OpenFilesByPath } from '../../types/app';
import type { MonacoEditor, EditorInstanceMap } from '../../types/monaco';
import { normalizePathForCompare } from '../../utils/pathUtils';
import { copyEditorContent, pasteEditorContent } from '../../utils/editorClipboard';
import { logDebug } from '../../utils/errorHandling';
import type { PendingSearchJump } from './types';

export interface UseEditorOperationsOptions {
  tabSize: number;
  openFilesByPath: OpenFilesByPath;
  programmaticRefreshPathsRef: React.MutableRefObject<Set<string>>;
  editorGroups: Array<{ id: EditorGroupId; activePath: string | null }>;
  activeGroupId: EditorGroupId;
  setActiveGroupId: (id: EditorGroupId) => void;
  setEditorContextMenu: (menu: { x: number; y: number; groupId: EditorGroupId } | null) => void;
}

export interface UseEditorOperationsReturn {
  editorInstanceByGroupRef: React.MutableRefObject<EditorInstanceMap>;
  editorMountedFilePathByGroupRef: React.MutableRefObject<Partial<Record<EditorGroupId, string>>>;
  pendingSearchJumpRef: React.MutableRefObject<PendingSearchJump>;
  handleEditorMount: (groupId: EditorGroupId, editor: unknown, filePath: string) => void;
  tryApplyPendingSearchJump: () => boolean;
  applyEditorIndentOptions: (editor: unknown) => void;
  layoutEditors: () => void;
  runEditorCommand: (groupId: EditorGroupId, commandId: string) => Promise<void>;
  openSearchMatch: (
    filePath: string,
    line: number,
    column: number,
    matchLen: number,
    openFileInGroup: (filePath: string, targetGroupId: EditorGroupId) => Promise<void>
  ) => Promise<void>;
}

export function useEditorOperations(
  options: UseEditorOperationsOptions
): UseEditorOperationsReturn {
  const {
    tabSize,
    openFilesByPath,
    programmaticRefreshPathsRef,
    editorGroups,
    activeGroupId,
    setActiveGroupId,
    setEditorContextMenu,
  } = options;

  const editorInstanceByGroupRef = useRef<EditorInstanceMap>({});
  const editorMountedFilePathByGroupRef = useRef<Partial<Record<EditorGroupId, string>>>({});
  const pendingSearchJumpRef = useRef<PendingSearchJump>(null);
  const editorGroupsRef = useRef(editorGroups);
  editorGroupsRef.current = editorGroups;

  const applyEditorIndentOptions = useCallback(
    (editor: unknown) => {
      const ed = editor as MonacoEditor | null;
      if (!ed) return;
      try {
        ed.updateOptions({
          tabSize,
          insertSpaces: true,
          detectIndentation: false,
        });
      } catch {
        /* ignore editor options update errors */
      }

      try {
        const model = ed.getModel();
        model?.updateOptions({
          tabSize,
          insertSpaces: true,
        });
      } catch {
        /* ignore model options update errors */
      }
    },
    [tabSize]
  );

  const tryApplyPendingSearchJump = useCallback((): boolean => {
    const pending = pendingSearchJumpRef.current;
    if (!pending) return false;

    const mountedPath = editorMountedFilePathByGroupRef.current[pending.groupId];
    if (
      mountedPath &&
      normalizePathForCompare(mountedPath).toLowerCase() !==
        normalizePathForCompare(pending.filePath).toLowerCase()
    ) {
      return false;
    }

    const group = editorGroupsRef.current.find((g) => g.id === pending.groupId);
    if (!group || !group.activePath) {
      return false;
    }

    const normalizePath = (p: string) => {
      return p.replace(/\\/g, '/').toLowerCase().trim();
    };

    const getFileName = (p: string) => {
      return p.split(/[\\/]/).pop()?.toLowerCase() || '';
    };

    const normActive = normalizePath(group.activePath);
    const normPending = normalizePath(pending.filePath);

    if (normActive !== normPending) {
      const activeFileName = getFileName(group.activePath);
      const pendingFileName = getFileName(pending.filePath);

      if (activeFileName !== pendingFileName) {
        return false;
      }
    }

    const editor = editorInstanceByGroupRef.current[pending.groupId];
    if (!editor) {
      return false;
    }

    let lineMaxColumn: number | null = null;

    try {
      if (typeof editor?.getModel === 'function') {
        const model = editor.getModel();
        if (!model) {
          return false;
        }

        try {
          const target = openFilesByPath[pending.filePath];
          const expectedLen = target && target.kind === 'text' ? target.content.length : 0;
          if (expectedLen > 0 && typeof model?.getValueLength === 'function') {
            const actualLen = model.getValueLength();
            if (typeof actualLen === 'number' && actualLen === 0) {
              return false;
            }
          }
        } catch {
          return false;
        }

        try {
          if (typeof model?.getLineCount === 'function') {
            const lineCount = model.getLineCount();
            if (typeof lineCount === 'number' && pending.line > lineCount) {
              return false;
            }
          }

          if (typeof model?.getLineMaxColumn === 'function') {
            const maxCol = model.getLineMaxColumn(pending.line);
            if (typeof maxCol === 'number') {
              lineMaxColumn = maxCol;
            }
          }
        } catch {
          return false;
        }

        const currentPath =
          model?.uri?.fsPath || model?.uri?.path || model?.uri?.toString?.() || '';
        if (currentPath) {
          const normCurrent = normalizePath(currentPath);
          let normCurrentDecoded = normCurrent;
          try {
            normCurrentDecoded = decodeURIComponent(normCurrent);
          } catch {
            /* ignore decode error */
          }

          const normTarget = normalizePath(pending.filePath);
          const exactMatch = normCurrentDecoded === normTarget || normCurrent === normTarget;
          const includesMatch = normCurrentDecoded.includes(normTarget);
          const endsWithMatch =
            normCurrentDecoded.endsWith(normTarget) || normCurrent.endsWith(normTarget);
          const fileNameMatch = getFileName(currentPath) === getFileName(pending.filePath);
          const match = exactMatch || includesMatch || endsWithMatch || fileNameMatch;

          if (!match) {
            return false;
          }
        }
      }
    } catch {
      return false;
    }

    let startColumn = pending.column;
    let endColumn = Math.max(startColumn + Math.max(pending.matchLen, 1), startColumn);
    if (typeof lineMaxColumn === 'number') {
      const maxCol = Math.max(lineMaxColumn, 1);
      startColumn = Math.min(Math.max(startColumn, 1), maxCol);
      endColumn = Math.min(Math.max(endColumn, startColumn), maxCol);
    }

    if (typeof editor?.revealRangeInCenter === 'function') {
      try {
        editor.revealRangeInCenter({
          startLineNumber: pending.line,
          startColumn,
          endLineNumber: pending.line,
          endColumn,
        });
      } catch {
        /* ignore reveal errors */
      }
    }

    try {
      editor?.revealLineInCenter?.(pending.line);
    } catch {
      /* ignore reveal errors */
    }

    try {
      editor?.setPosition?.({ lineNumber: pending.line, column: pending.column });
    } catch {
      /* ignore position errors */
    }

    try {
      if (typeof editor?.getPosition === 'function') {
        const pos = editor.getPosition();
        if (!pos || pos.lineNumber !== pending.line) return false;
      }
    } catch {
      return false;
    }

    try {
      editor?.setSelection?.({
        startLineNumber: pending.line,
        startColumn,
        endLineNumber: pending.line,
        endColumn,
      });
    } catch {
      /* ignore selection errors */
    }

    try {
      if (typeof editor?.getSelection === 'function') {
        const sel = editor.getSelection();
        if (!sel) return false;
        if (typeof sel.startLineNumber === 'number' && sel.startLineNumber !== pending.line)
          return false;
      }
    } catch {
      return false;
    }

    try {
      editor?.focus?.();
    } catch {
      /* ignore focus errors */
    }

    pendingSearchJumpRef.current = null;
    return true;
  }, [openFilesByPath]);

  const handleEditorMount = useCallback(
    (groupId: EditorGroupId, editor: unknown, filePath: string) => {
      const ed = editor as MonacoEditor;
      editorInstanceByGroupRef.current[groupId] = ed;
      editorMountedFilePathByGroupRef.current[groupId] = filePath;
      applyEditorIndentOptions(editor);

      try {
        const expectedFile = openFilesByPath[filePath];
        const expectedContent =
          expectedFile && expectedFile.kind === 'text' ? expectedFile.content : null;
        const model = ed.getModel();
        if (model && typeof expectedContent === 'string') {
          const currentContent = model.getValue();
          if (currentContent !== expectedContent) {
            const normalizedPath = normalizePathForCompare(filePath).toLowerCase();
            programmaticRefreshPathsRef.current.add(normalizedPath);
            model.setValue(expectedContent);
            window.setTimeout(() => {
              programmaticRefreshPathsRef.current.delete(normalizedPath);
            }, 0);
          }
        }
      } catch {
        /* ignore initial model sync errors */
      }

      const waitForModelAndJump = () => {
        const pending = pendingSearchJumpRef.current;
        if (!pending || pending.groupId !== groupId) {
          return;
        }

        const checkModelReady = () => {
          try {
            const model = ed.getModel();
            return !!model;
          } catch {
            return false;
          }
        };

        if (checkModelReady()) {
          setTimeout(() => {
            tryApplyPendingSearchJump();
          }, 50);

          setTimeout(() => {
            tryApplyPendingSearchJump();
          }, 150);

          return;
        }

        let pollAttempts = 0;
        const maxPollAttempts = 30;

        const pollForModel = () => {
          if (!pendingSearchJumpRef.current || pendingSearchJumpRef.current.groupId !== groupId) {
            return;
          }

          if (checkModelReady()) {
            setTimeout(() => {
              tryApplyPendingSearchJump();
            }, 50);
            return;
          }

          pollAttempts++;
          if (pollAttempts < maxPollAttempts) {
            setTimeout(pollForModel, 50);
          } else {
            console.warn('Model not ready after polling, attempting jump anyway');
            tryApplyPendingSearchJump();
          }
        };

        setTimeout(pollForModel, 50);
      };

      try {
        ed.onDidChangeModel(() => {
          setTimeout(() => {
            tryApplyPendingSearchJump();
          }, 50);
        });
      } catch {
        /* ignore model change listener errors */
      }

      setTimeout(waitForModelAndJump, 100);

      try {
        const dom = ed.getDomNode();
        if (dom) {
          const handler = (ev: MouseEvent) => {
            try {
              ev.preventDefault();
              ev.stopPropagation();
            } catch {
              /* ignore event errors */
            }

            setActiveGroupId(groupId);
            setEditorContextMenu({ x: ev.clientX, y: ev.clientY, groupId });
          };
          dom.addEventListener('contextmenu', handler);

          try {
            ed.onDidDispose(() => {
              dom.removeEventListener('contextmenu', handler);
            });
          } catch {
            /* ignore dispose listener errors */
          }
        }
      } catch {
        /* ignore dom node errors */
      }

      try {
        ed.layout();
      } catch {
        /* ignore layout errors */
      }
      requestAnimationFrame(() => {
        try {
          ed.layout();
        } catch {
          /* ignore layout errors */
        }
      });
    },
    [
      applyEditorIndentOptions,
      openFilesByPath,
      programmaticRefreshPathsRef,
      tryApplyPendingSearchJump,
      setActiveGroupId,
      setEditorContextMenu,
    ]
  );

  const layoutEditors = useCallback(() => {
    const e1 = editorInstanceByGroupRef.current['group-1'];
    const e2 = editorInstanceByGroupRef.current['group-2'];
    try {
      e1?.layout?.();
    } catch {
      /* ignore layout errors */
    }
    try {
      e2?.layout?.();
    } catch {
      /* ignore layout errors */
    }
  }, []);

  const runEditorCommand = useCallback(async (groupId: EditorGroupId, commandId: string) => {
    const editor = editorInstanceByGroupRef.current[groupId];
    if (!editor) return;

    try {
      editor.focus();
    } catch {
      /* ignore focus errors */
    }

    if (commandId === 'editor.action.clipboardPasteAction') {
      await pasteEditorContent(editor as MonacoEditor);
      return;
    }

    if (commandId === 'editor.copyAllCode') {
      await copyEditorContent(editor as MonacoEditor, { fullDocument: true });
      return;
    }

    try {
      const action = editor.getAction(commandId);
      if (action && action.run) {
        await action.run();
        return;
      }
    } catch {
      /* ignore action errors */
    }

    try {
      editor.trigger('editor-context-menu', commandId, null);
    } catch {
      /* ignore trigger errors */
    }
  }, []);

  const openSearchMatch = useCallback(
    async (
      filePath: string,
      line: number,
      column: number,
      matchLen: number,
      openFileInGroup: (filePath: string, targetGroupId: EditorGroupId) => Promise<void>
    ) => {
      const targetGroupId = activeGroupId;

      pendingSearchJumpRef.current = { groupId: targetGroupId, filePath, line, column, matchLen };

      await openFileInGroup(filePath, targetGroupId);

      const waitForSearchJumpPrereqs = async () => {
        const deadline = Date.now() + 2000;
        const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase().trim();
        const getFileName = (p: string) => p.split(/[\\/]/).pop()?.toLowerCase() || '';
        const targetNorm = normalize(filePath);
        const targetName = getFileName(filePath);

        while (Date.now() < deadline) {
          if (!pendingSearchJumpRef.current) return;

          const group = editorGroupsRef.current.find((g) => g.id === targetGroupId);
          const activePath = group?.activePath;
          const editor = editorInstanceByGroupRef.current[targetGroupId];
          const mountedPath = editorMountedFilePathByGroupRef.current[targetGroupId];

          if (activePath) {
            const activeNorm = normalize(activePath);
            const activeName = getFileName(activePath);
            const pathReady = activeNorm === targetNorm || activeName === targetName;
            const mountedReady = !mountedPath || normalize(mountedPath) === targetNorm;
            if (pathReady && editor && mountedReady) return;
          }

          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        }
      };

      await waitForSearchJumpPrereqs();

      let attempts = 0;
      const maxAttempts = 100;

      const tryJump = () => {
        if (!pendingSearchJumpRef.current) {
          return;
        }

        const success = tryApplyPendingSearchJump();

        if (success) {
          logDebug('Search jump succeeded on attempt ' + (attempts + 1), 'EditorOperations');
          return;
        }

        attempts++;

        if (attempts >= maxAttempts) {
          console.warn('Search jump failed after max attempts:', {
            filePath,
            line,
            column,
            attempts,
          });
          pendingSearchJumpRef.current = null;
          return;
        }

        let delay: number;
        if (attempts <= 5) {
          requestAnimationFrame(tryJump);
          return;
        } else if (attempts <= 20) {
          delay = 50;
        } else if (attempts <= 50) {
          delay = 100;
        } else {
          delay = 200;
        }

        setTimeout(tryJump, delay);
      };

      const immediateSuccess = tryApplyPendingSearchJump();
      if (!immediateSuccess) {
        requestAnimationFrame(tryJump);
      }
    },
    [activeGroupId, tryApplyPendingSearchJump]
  );

  useEffect(() => {
    const groupIds: EditorGroupId[] = ['group-1', 'group-2'];
    for (const groupId of groupIds) {
      const editor = editorInstanceByGroupRef.current[groupId];
      if (editor) applyEditorIndentOptions(editor);
    }

    try {
      const seenModels = new Set<unknown>();
      for (const groupId of groupIds) {
        const model = editorInstanceByGroupRef.current[groupId]?.getModel?.();
        if (!model || seenModels.has(model)) continue;
        seenModels.add(model);
        model.updateOptions?.({
          tabSize,
          insertSpaces: true,
        });
      }
    } catch {
      /* ignore model options update errors */
    }
  }, [applyEditorIndentOptions, tabSize]);

  useEffect(() => {
    tryApplyPendingSearchJump();
  }, [editorGroups, tryApplyPendingSearchJump]);

  return {
    editorInstanceByGroupRef,
    editorMountedFilePathByGroupRef,
    pendingSearchJumpRef,
    handleEditorMount,
    tryApplyPendingSearchJump,
    applyEditorIndentOptions,
    layoutEditors,
    runEditorCommand,
    openSearchMatch,
  };
}
