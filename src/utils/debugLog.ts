import { invoke } from '@tauri-apps/api/core';

function canUseTauriInvoke(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).__TAURI_INTERNALS__ === 'object';
}

export function debugLog(source: string, payload: Record<string, unknown>): void {
  if (!canUseTauriInvoke()) {
    return;
  }

  const message = JSON.stringify(payload);
  void invoke('debug_log', { source, message }).catch(() => {
    // ignore debug logging failures
  });
}
