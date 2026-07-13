/**
 * AgentApp — Agent 独立窗口根组件
 *
 * 当 Tauri 创建独立 Agent 窗口时，该窗口加载同一前端 SPA，
 * 通过 URL 查询参数 ?window=agent&projectPath=... 路由到此组件。
 *
 * 包含自己的 I18nProvider / NotificationProvider（因为不走 App.tsx 的 Provider 树）。
 * 使用自定义 TitleBar 保持与主窗口一致的无边框拖拽风格。
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { I18nProvider } from '../i18n';
import { NotificationProvider } from '../contexts/NotificationContext';
import {
  useSettingsLoading,
  useInitializeSettings,
  useLanguage,
} from '../stores';
import { useCbmStore } from '../stores/useCbmStore';
import { useUsageStore } from '../stores/useUsageStore';
import TitleBar from './TitleBar';
import AgentPanel from './AgentPanel';
import styles from './AgentApp.module.css';

interface AgentAppProps {
  projectPath: string;
}

/* ─── 样式 ─── */

const loadingStateStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'var(--bg-primary)',
  color: 'var(--text-secondary)',
  fontSize: '13px',
};

/* ─── 组件 ─── */

export default function AgentApp({ projectPath: initialProjectPath }: AgentAppProps) {
  const language = useLanguage();
  const loading = useSettingsLoading();
  const initializeSettings = useInitializeSettings();
  const [activeProjectPath, setActiveProjectPath] = useState(initialProjectPath);

  useEffect(() => {
    setActiveProjectPath(initialProjectPath);
  }, [initialProjectPath]);

  const handleProjectPathChange = useCallback((path: string) => {
    setActiveProjectPath(path);
    const params = new URLSearchParams(window.location.search);
    params.set('window', 'agent');
    params.set('projectPath', path);
    const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, []);

  // 初始化设置（加载持久化的设置），与主窗口 AppWithSettings 一致
  useEffect(() => {
    initializeSettings();
    void useUsageStore.getState().initUsage();
    void useCbmStore.getState().initialize();
  }, [initializeSettings]);

  // 当 React 完成渲染（loading 为 false 且不再是全黑状态）后，再显示窗口，避免白屏闪烁
  useEffect(() => {
    if (!loading) {
      setTimeout(() => {
        try {
          void invoke('show_agent_window');
        } catch (_error) {
          // ignore error if not running in Tauri
        }
      }, 50); // slight delay to ensure DOM paint has completed
    }
  }, [loading]);

  const handleFilesChanged = useCallback(
    (paths: string[]) => {
      // 通过 Tauri event 广播回主窗口，让主窗口刷新文件树
      void emit('agent-files-changed', { paths });
    },
    []
  );

  return (
    <I18nProvider defaultLocale={language}>
      <NotificationProvider>
        <div className={styles.root} data-theme="light">
          <TitleBar
            onOpenFolder={() => {}}
            onOpenFile={() => {}}
            hideMenu
          />
          <div className={styles.content} style={loading ? loadingStateStyle : undefined}>
            {loading ? (
              <div data-testid="agent-app-loading">Loading Agent…</div>
            ) : (
              <AgentPanel
                projectPath={activeProjectPath}
                onProjectPathChange={handleProjectPathChange}
                onFilesChanged={handleFilesChanged}
              />
            )}
          </div>
        </div>
      </NotificationProvider>
    </I18nProvider>
  );
}
