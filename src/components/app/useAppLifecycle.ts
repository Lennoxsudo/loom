import { useState, useRef, useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriCancellationError } from '../../utils/editorUtils';
import { ensureGlobalSkillsDir } from '../../utils/skills';
import { mcpClient } from '../../utils/mcpClient';
import { useToolStore } from '../../stores/useToolStore';
import { useRulesStore } from '../../stores/useRulesStore';
import { useTranslation } from '../../i18n';
import { browserController, BrowserActionEvent } from '../../utils/browserController';
import { logDebug } from '../../utils/errorHandling';
import type { EditorGroupId, EditorGroupState, OpenFile, OpenFilesByPath } from '../../types/app';
import { AGENT_BUSY_CHANGE_EVENT, type AgentBusyChangeDetail } from '../../types/chat';

export interface UseAppLifecycleOptions {
  openFilesByPath: OpenFilesByPath;
  editorGroups: EditorGroupState[];
  activeGroupId: EditorGroupId;
  setOpenFilesByPath: React.Dispatch<React.SetStateAction<OpenFilesByPath>>;
  setEditorGroups: React.Dispatch<React.SetStateAction<EditorGroupState[]>>;
  setActiveGroupId: (id: EditorGroupId) => void;
}

export interface UseAppLifecycleReturn {
  isAnyAgentBusy: boolean;
  agentBusyPanelsRef: React.MutableRefObject<Set<string>>;
}

export function useAppLifecycle(options: UseAppLifecycleOptions): UseAppLifecycleReturn {
  const { editorGroups, setOpenFilesByPath, setEditorGroups, setActiveGroupId } = options;
  const t = useTranslation();

  const [isAnyAgentBusy, setIsAnyAgentBusy] = useState(false);
  const agentBusyPanelsRef = useRef<Set<string>>(new Set());
  const mcpInitialized = useRef(false);

  useEffect(() => {
    if (isTauri()) {
      const win = getCurrentWindow();
      void win.show().catch((error) => {
        if (!isTauriCancellationError(error)) {
          console.warn('[Window] show failed:', error);
        }
      });

      void ensureGlobalSkillsDir();

      // MCP 服务异步自动启动（fire-and-forget），不阻塞 UI
      if (!mcpInitialized.current) {
        mcpInitialized.current = true;
        mcpClient.startAsync().then((count) => {
          if (count > 0) {
            console.warn(`[MCP] 正在后台启动 ${count} 个服务...`);
          }
        }).catch((err) => {
          console.warn('[MCP] 自动启动失败:', err);
        });
      }
    }

    void useRulesStore.getState().loadRules();

    return () => {
      useToolStore.getState().clearMcpTools();
    };
  }, []);

  useEffect(() => {
    const busyPanels = agentBusyPanelsRef.current;

    const onAgentBusyChange = (event: Event) => {
      const customEvent = event as CustomEvent<AgentBusyChangeDetail>;
      const detail = customEvent.detail;
      if (!detail || !detail.panelId) return;

      if (detail.busy) {
        busyPanels.add(detail.panelId);
      } else {
        busyPanels.delete(detail.panelId);
      }

      setIsAnyAgentBusy(busyPanels.size > 0);
    };

    window.addEventListener(AGENT_BUSY_CHANGE_EVENT, onAgentBusyChange as EventListener);
    return () => {
      window.removeEventListener(AGENT_BUSY_CHANGE_EVENT, onAgentBusyChange as EventListener);
      busyPanels.clear();
    };
  }, []);

  useEffect(() => {
    const handleBrowserAction = (e: Event) => {
      const action = (e as BrowserActionEvent).detail;

      logDebug('收到浏览器控制指令: ' + JSON.stringify(action), 'App');

      if (action.type === 'OPEN') {
        const targetUrl = action.url || 'http://localhost:3000';
        const browserPath = '__browser__';

        const existingGroup = editorGroups.find((g) => g.tabPaths.includes(browserPath));

        if (existingGroup) {
          setActiveGroupId(existingGroup.id);
          setEditorGroups((prev) =>
            prev.map((g) => (g.id === existingGroup.id ? { ...g, activePath: browserPath } : g))
          );

          setOpenFilesByPath((prev) => {
            const existing = prev[browserPath];
            if (existing && existing.kind === 'browser') {
              return {
                ...prev,
                [browserPath]: { ...existing, url: targetUrl },
              };
            }
            return prev;
          });

          browserController.navigate(targetUrl);
        } else {
          const firstGroup = editorGroups[0];
          if (!firstGroup) return;

          const newBrowserTab: OpenFile = {
            kind: 'browser',
            path: browserPath,
            name: t.labels.browser,
            url: targetUrl,
            isDirty: false,
          };

          setOpenFilesByPath((prev) => ({
            ...prev,
            [browserPath]: newBrowserTab,
          }));

          setEditorGroups((prev) =>
            prev.map((g, idx) =>
              idx === 0
                ? {
                    ...g,
                    tabPaths: [browserPath, ...g.tabPaths],
                    activePath: browserPath,
                  }
                : g
            )
          );

          setActiveGroupId(firstGroup.id);
          queueMicrotask(() => browserController.navigate(targetUrl));
        }
      }
    };

    browserController.addEventListener('browser-action', handleBrowserAction);
    return () => {
      browserController.removeEventListener('browser-action', handleBrowserAction);
    };
  }, [editorGroups, setActiveGroupId, setEditorGroups, setOpenFilesByPath, t.labels.browser]);

  return {
    isAnyAgentBusy,
    agentBusyPanelsRef,
  };
}
