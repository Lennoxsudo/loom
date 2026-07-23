import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useNotification } from '../contexts/NotificationContext';
import { useTranslation } from '../i18n';

export function useCbmIndexEvents(enabled: boolean) {
  const { showInfo, showWarning } = useNotification();
  const t = useTranslation();

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const unsubs: Array<() => void> = [];

    const addListener = async (event: string, handler: (payload: unknown) => void) => {
      const unlisten = await listen(event, handler);
      if (cancelled) {
        unlisten();
      } else {
        unsubs.push(unlisten);
      }
    };

    void Promise.all([
      addListener('cbm-index-started', (event) => {
        const payload = event as { payload?: { repo_path?: string } };
        const name = payload.payload?.repo_path?.split(/[\\/]/).pop();
        if (name) {
          showInfo(t.graph.indexStarted.replace('{name}', name));
        }
      }),
      addListener('cbm-index-complete', (event) => {
        const payload = event as { payload?: { repo_path?: string } };
        const name = payload.payload?.repo_path?.split(/[\\/]/).pop();
        if (name) {
          showInfo(t.graph.indexComplete.replace('{name}', name));
        }
      }),
      addListener('cbm-index-failed', (event) => {
        const payload = event as { payload?: { repo_path?: string; error?: string } };
        const name = payload.payload?.repo_path?.split(/[\\/]/).pop() ?? '';
        const detail = payload.payload?.error?.trim();
        const message = detail
          ? `${t.graph.indexFailed.replace('{name}', name)}: ${detail}`
          : t.graph.indexFailed.replace('{name}', name);
        showWarning(message);
      }),
    ]);

    return () => {
      cancelled = true;
      for (const unsub of unsubs) unsub();
    };
  }, [
    enabled,
    showInfo,
    showWarning,
    t.graph.indexComplete,
    t.graph.indexFailed,
    t.graph.indexStarted,
  ]);
}
