import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { CommandExecProgressEvent } from '../types/ai';

export type CommandExecProgressHandler = (event: CommandExecProgressEvent) => void;

/**
 * Subscribe to foreground command execution progress chunks from the Rust backend.
 * Returns an unsubscribe function.
 */
export function subscribeCommandExecProgress(handler: CommandExecProgressHandler): () => void {
  let unlisten: (() => void) | undefined;

  void listen<CommandExecProgressEvent>('command-exec-progress', (event) => {
    handler(event.payload);
  }).then((fn) => {
    unlisten = fn;
  });

  return () => {
    unlisten?.();
  };
}

/**
 * React hook that keeps a stable handler ref for command exec progress events.
 */
export function useCommandExecProgress(handler: CommandExecProgressHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribeCommandExecProgress((event) => {
      handlerRef.current(event);
    });
  }, []);
}
