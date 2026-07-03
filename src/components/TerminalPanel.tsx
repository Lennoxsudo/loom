import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { useTranslation } from '../i18n';
import { useThemeMode } from '../stores';
import { applyTerminalTheme, getTerminalTheme } from './terminalTheme';
import { ChevronDownIcon, PlusIcon } from './shared/Icons';
import styles from './TerminalPanel.module.css';

type TerminalPanelProps = {
  height: number;
  visible: boolean;
  onCloseAll: () => void;
  onHide: () => void;
  onHasTerminalsChange: (hasTerminals: boolean) => void;
  projectPath: string;
  workingDir?: string;
};

type TerminalTab = {
  id: string;
  title: string;
  pid: number | null;
};

type TerminalDescriptor = {
  terminal_id: string;
  title: string;
  pid?: number | null;
  shell_type?: string;
};

type TerminalDataEvent = {
  terminal_id: string;
  data: string;
};

type TerminalClosedEvent = {
  terminal_id: string;
};

type TerminalOutputChunk = {
  data: string;
  next_seq: number;
  truncated: boolean;
};

const MAX_REPLAY_BYTES = 256_000;
const PTY_RESIZE_DEBOUNCE_MS = 120;

type SyncedTerminalSize = { rows: number; cols: number };

export default function TerminalPanel({
  height,
  visible,
  onCloseAll,
  onHide,
  onHasTerminalsChange,
  projectPath,
  workingDir,
}: TerminalPanelProps) {
  const t = useTranslation();
  const themeMode = useThemeMode();
  const viewportOuterRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalReadyRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  const tabsRef = useRef<TerminalTab[]>([]);
  const fittedAfterDataRef = useRef(new Set<string>());
  const ensurePendingRef = useRef(false);
  const visibleRef = useRef(visible);
  const wasVisibleRef = useRef(visible);
  const onCloseAllRef = useRef(onCloseAll);
  const lastSyncedSizeByTerminalRef = useRef(new Map<string, SyncedTerminalSize>());
  const resizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    onCloseAllRef.current = onCloseAll;
  }, [onCloseAll]);

  useEffect(() => {
    onHasTerminalsChange(tabs.length > 0);
  }, [tabs.length, onHasTerminalsChange]);

  const syncTerminalSize = useCallback((terminalId: string, options?: { force?: boolean }) => {
    if (!terminalReadyRef.current) return;
    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;

    fitAddon.fit();
    const rows = term.rows || 24;
    const cols = term.cols || 80;
    const last = lastSyncedSizeByTerminalRef.current.get(terminalId);
    if (!options?.force && last?.rows === rows && last?.cols === cols) {
      return;
    }

    lastSyncedSizeByTerminalRef.current.set(terminalId, { rows, cols });
    void invoke('set_terminal_size', { terminalId, rows, cols });
  }, []);

  const scheduleTerminalResize = useCallback(() => {
    if (!visibleRef.current || !terminalReadyRef.current) return;
    const terminalId = activeIdRef.current;
    if (!terminalId) return;

    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;

    fitAddon.fit();

    if (resizeDebounceRef.current) {
      clearTimeout(resizeDebounceRef.current);
    }

    resizeDebounceRef.current = setTimeout(() => {
      resizeDebounceRef.current = null;
      if (activeIdRef.current !== terminalId) return;
      syncTerminalSize(terminalId);
    }, PTY_RESIZE_DEBOUNCE_MS);
  }, [syncTerminalSize]);

  const openTerminalIfNeeded = useCallback(() => {
    if (!visibleRef.current) return;
    if (terminalReadyRef.current) return;
    const term = terminalRef.current;
    const container = viewportRef.current;
    if (!term || !container) return;
    term.open(container);
    terminalReadyRef.current = true;
    requestAnimationFrame(() => {
      const activeTerminalId = activeIdRef.current;
      if (!activeTerminalId) return;
      syncTerminalSize(activeTerminalId, { force: true });
    });
  }, [syncTerminalSize]);

  const fitTerminalNow = useCallback(
    (terminalId: string) => {
      openTerminalIfNeeded();
      syncTerminalSize(terminalId, { force: true });
    },
    [openTerminalIfNeeded, syncTerminalSize]
  );

  const replayTerminal = useCallback(
    async (terminalId: string) => {
      const term = terminalRef.current;
      if (!term) return;
      fitTerminalNow(terminalId);
      if (!terminalReadyRef.current) return;
      term.clear();

      const result = await invoke<TerminalOutputChunk>('get_terminal_output', {
        terminalId,
        sinceSeq: 0,
        maxBytes: MAX_REPLAY_BYTES,
      });

      if (result.data) {
        term.write(result.data);
      }
    },
    [fitTerminalNow]
  );

  const activateTerminal = useCallback(
    async (terminalId: string) => {
      setActiveId(terminalId);
      activeIdRef.current = terminalId;
      await invoke('set_active_terminal', { terminalId });
      await replayTerminal(terminalId);
    },
    [replayTerminal]
  );

  const ensureTerminal = useCallback(async () => {
    const resolvedWorkingDir = workingDir || projectPath || undefined;
    const descriptor = await invoke<TerminalDescriptor>('ensure_terminal', {
      workingDir: resolvedWorkingDir,
    });
    setTabs((prev) => {
      const existing = prev.find((tab) => tab.id === descriptor.terminal_id);
      if (!existing) {
        return [
          ...prev,
          { id: descriptor.terminal_id, title: descriptor.title, pid: descriptor.pid ?? null },
        ];
      }

      return prev.map((tab) =>
        tab.id === descriptor.terminal_id
          ? { ...tab, title: descriptor.title, pid: descriptor.pid ?? tab.pid }
          : tab
      );
    });
    fittedAfterDataRef.current.delete(descriptor.terminal_id);
    await activateTerminal(descriptor.terminal_id);
  }, [activateTerminal, projectPath, workingDir]);

  const createTerminal = useCallback(async () => {
    const resolvedWorkingDir = workingDir || projectPath || undefined;
    const descriptor = await invoke<TerminalDescriptor>('create_terminal', {
      workingDir: resolvedWorkingDir,
    });
    setTabs((prev) => [
      ...prev,
      { id: descriptor.terminal_id, title: descriptor.title, pid: descriptor.pid ?? null },
    ]);
    fittedAfterDataRef.current.delete(descriptor.terminal_id);
    await activateTerminal(descriptor.terminal_id);
  }, [activateTerminal, projectPath, workingDir]);

  const closeTerminal = useCallback(
    async (terminalId: string) => {
      await invoke('close_terminal', { terminalId });
      fittedAfterDataRef.current.delete(terminalId);
      lastSyncedSizeByTerminalRef.current.delete(terminalId);

      const currentTabs = tabs;
      const remaining = currentTabs.filter((tab) => tab.id !== terminalId);
      const isLast = remaining.length === 0;
      let nextActive: string | null = activeIdRef.current;

      if (isLast) {
        nextActive = null;
      } else if (terminalId === activeIdRef.current) {
        const closedIndex = currentTabs.findIndex((tab) => tab.id === terminalId);
        const nextIndex = Math.min(closedIndex, remaining.length - 1);
        nextActive = remaining[nextIndex].id;
      }

      setTabs(remaining);

      if (isLast || !nextActive) {
        setActiveId(null);
        onCloseAll();
        return;
      }

      if (terminalId === activeIdRef.current) {
        await activateTerminal(nextActive);
      }
    },
    [activateTerminal, onCloseAll, tabs]
  );

  useEffect(() => {
    if (!viewportRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 12,
      lineHeight: 1.1,
      letterSpacing: 0,
      fontWeight: '400',
      fontWeightBold: '600',
      fontFamily: '"Cascadia Mono", "JetBrains Mono", "Fira Code", Consolas, "SF Mono", monospace',
      theme: getTerminalTheme(themeMode),
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    openTerminalIfNeeded();

    scheduleTerminalResize();

    const resizeObserver = new ResizeObserver(() => scheduleTerminalResize());
    if (viewportOuterRef.current) {
      resizeObserver.observe(viewportOuterRef.current);
    } else {
      resizeObserver.observe(viewportRef.current);
    }

    const dataDisposable = term.onData((input) => {
      const terminalId = activeIdRef.current;
      if (!terminalId) return;
      void invoke('write_to_terminal', { terminalId, data: input, source: 'user' });
    });

    const unlistenData = listen<TerminalDataEvent>('terminal-data', (event) => {
      const payload = event.payload;
      if (!payload || payload.terminal_id !== activeIdRef.current) return;
      if (!visibleRef.current) return;
      if (!terminalReadyRef.current) return;
      if (!fittedAfterDataRef.current.has(payload.terminal_id)) {
        fittedAfterDataRef.current.add(payload.terminal_id);
        fitTerminalNow(payload.terminal_id);
      }
      term.write(payload.data);
    });

    const unlistenCreated = listen<TerminalDescriptor>('terminal-created', (event) => {
      const descriptor = event.payload;
      if (!descriptor || !descriptor.terminal_id) return;

      setTabs((prev) => {
        const exists = prev.find((tab) => tab.id === descriptor.terminal_id);
        if (exists) {
          return prev.map((tab) =>
            tab.id === descriptor.terminal_id
              ? { ...tab, title: descriptor.title, pid: descriptor.pid ?? tab.pid }
              : tab
          );
        }
        return [
          ...prev,
          { id: descriptor.terminal_id, title: descriptor.title, pid: descriptor.pid ?? null },
        ];
      });

      if (!activeIdRef.current) {
        setActiveId(descriptor.terminal_id);
        activeIdRef.current = descriptor.terminal_id;
        void invoke('set_active_terminal', { terminalId: descriptor.terminal_id });
        if (visibleRef.current) {
          void activateTerminal(descriptor.terminal_id);
        }
      }
    });

    const unlistenClosed = listen<TerminalClosedEvent>('terminal-closed', (event) => {
      const payload = event.payload;
      const terminalId = payload?.terminal_id;
      if (!terminalId) return;

      fittedAfterDataRef.current.delete(terminalId);
      lastSyncedSizeByTerminalRef.current.delete(terminalId);

      const currentTabs = tabsRef.current;
      const closedIndex = currentTabs.findIndex((tab) => tab.id === terminalId);
      if (closedIndex === -1) return;

      const remaining = currentTabs.filter((tab) => tab.id !== terminalId);
      const wasActive = terminalId === activeIdRef.current;

      let nextActive: string | null = activeIdRef.current;
      if (remaining.length === 0) {
        nextActive = null;
      } else if (wasActive) {
        const nextIndex = Math.min(closedIndex, remaining.length - 1);
        nextActive = remaining[nextIndex].id;
      }

      setTabs(remaining);

      if (remaining.length === 0 || !nextActive) {
        setActiveId(null);
        activeIdRef.current = null;
        onCloseAllRef.current();
        return;
      }

      if (wasActive) {
        setActiveId(nextActive);
        activeIdRef.current = nextActive;
        if (visibleRef.current) {
          void activateTerminal(nextActive);
        } else {
          void invoke('set_active_terminal', { terminalId: nextActive });
        }
      }
    });

    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
      unlistenData.then((fn) => fn());
      unlistenCreated.then((fn) => fn());
      unlistenClosed.then((fn) => fn());
      terminalReadyRef.current = false;
      term.dispose();
    };
  }, [activateTerminal, ensureTerminal, fitTerminalNow, openTerminalIfNeeded, scheduleTerminalResize]);

  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    applyTerminalTheme(term, themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!visible) return;
    openTerminalIfNeeded();
    scheduleTerminalResize();
  }, [height, openTerminalIfNeeded, scheduleTerminalResize, visible]);

  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      return;
    }
    openTerminalIfNeeded();
    if (!wasVisibleRef.current && activeIdRef.current) {
      void replayTerminal(activeIdRef.current);
    }
    wasVisibleRef.current = true;
  }, [openTerminalIfNeeded, replayTerminal, visible]);

  useEffect(() => {
    if (!visible) return;
    if (tabs.length > 0) return;
    if (ensurePendingRef.current) return;
    ensurePendingRef.current = true;
    void ensureTerminal().finally(() => {
      ensurePendingRef.current = false;
    });
  }, [ensureTerminal, tabs.length, visible]);

  return (
    <div
      className={`${styles.panelRoot} ${styles.fade} ${visible ? styles.visible : styles.hidden} ${visible ? '' : styles.panelHidden}`}
      style={{
        height: visible ? `${height}px` : '0px',
        minHeight: visible ? '140px' : '0px',
      }}
    >
      <div className={styles.tabsBar}>
        <div className={styles.tabStrip}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={styles.tabChrome}
              data-active={tab.id === activeId}
            >
              <button
                type="button"
                onClick={() => void activateTerminal(tab.id)}
                aria-label={tab.title}
                title={`PID: ${tab.pid ?? 'N/A'}`}
                className={styles.tabButton}
              >
                {tab.title}
              </button>
              <button
                type="button"
                aria-label={`${t.actions.close}${tab.title}`}
                title={`${t.actions.close}${tab.title}`}
                onClick={() => void closeTerminal(tab.id)}
                className={styles.tabClose}
              >
                <span className={styles.tabCloseGlyph}>x</span>
              </button>
            </div>
          ))}
        </div>

        <div className={styles.toolbar}>
          <button
            type="button"
            aria-label={t.terminal.newTerminal}
            title={t.terminal.newTerminal}
            onClick={() => void createTerminal()}
            className={styles.toolButton}
          >
            <PlusIcon size={14} />
          </button>
          <button
            type="button"
            aria-label={t.terminal.hideTerminal}
            title={t.terminal.hideTerminal}
            onClick={onHide}
            className={styles.toolButton}
          >
            <ChevronDownIcon size={12} />
          </button>
        </div>
      </div>

      <div ref={viewportOuterRef} className={styles.viewportShell}>
        <div ref={viewportRef} className={styles.viewport} />
      </div>
    </div>
  );
}
