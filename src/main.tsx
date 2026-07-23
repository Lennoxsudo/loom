import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App';
import AgentApp from './components/AgentApp';
import ErrorBoundary from './components/ErrorBoundary';
import { debugLog } from './utils/debugLog';
import { isTauriCancellationError } from './utils/errorHandling';
import { migrateLegacyStorageKeys } from './utils/migrateLegacyStorage';
import { resolveWindowRoute } from './utils/windowRoute';
// 导入 monaco-loader 触发模块求值时的自启动加载（不阻塞）
import './monaco-loader';
// 导入并初始化Monaco编辑器系统
import { initializeMonacoSystem } from './utils/monacoLoader';
import './styles/variables.css';
import './styles/base.css';
import './styles/scrollbar.css';

migrateLegacyStorageKeys();

window.addEventListener('unhandledrejection', (event) => {
  if (isTauriCancellationError(event.reason)) {
    event.preventDefault();
  }
});

function getCurrentWindowLabel(): string | null {
  try {
    return getCurrentWindow().label;
  } catch {
    return null;
  }
}

const route = resolveWindowRoute(window.location, {
  windowLabel: getCurrentWindowLabel(),
});
debugLog('main-entry', {
  href: window.location.href,
  pathname: window.location.pathname,
  search: window.location.search,
  hash: window.location.hash,
  windowLabel: getCurrentWindowLabel(),
  routeKind: route.kind,
  routeProjectPath: route.kind === 'agent' ? route.projectPath : null,
});

// 初始化Monaco编辑器系统（异步不阻塞渲染）
initializeMonacoSystem().catch((error) => {
  console.error('Failed to initialize Monaco editor system:', error);
});

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

if (route.kind === 'agent') {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <AgentApp projectPath={route.projectPath} />
      </ErrorBoundary>
    </React.StrictMode>
  );
} else {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
