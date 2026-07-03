/**
 * Hook to subscribe to backend automation-triggered events
 * and deliver prompts into the appropriate thread loop.
 *
 * When an automation fires, the Rust backend emits `agent-automation-triggered`.
 * This hook listens for that event and:
 * 1. If a targetThreadId is specified, switches to that thread (loading context if needed)
 *    and sends the prompt via the provided sendMessage callback.
 * 2. If no targetThreadId, creates a new thread with the prompt.
 *
 * All automation-triggered runs respect the P1 approval/sandbox tier
 * because they go through the same sendMessage → tool approval pipeline.
 */

import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { AutomationTriggeredEvent } from '../../../types/automation';
import { useAutomationStore } from '../../../stores/useAutomationStore';

interface UseAutomationEventOptions {
  /** Switch to a specific thread by ID + project path */
  onSelectThread: (threadId: string, projectPath?: string) => void;
  /** Send a message in the current thread with optional overrides */
  sendMessage: (overrides?: { draftMessage?: string }) => Promise<void>;
  /** Currently selected agent ID */
  selectedAgentId: string | null;
}

export function useAutomationEvent({
  onSelectThread,
  sendMessage,
  selectedAgentId,
}: UseAutomationEventOptions) {
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  const onSelectThreadRef = useRef(onSelectThread);
  onSelectThreadRef.current = onSelectThread;
  const selectedAgentIdRef = useRef(selectedAgentId);
  selectedAgentIdRef.current = selectedAgentId;

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listen<AutomationTriggeredEvent>(
        'agent-automation-triggered',
        async (event) => {
          const { taskId, targetThreadId, prompt, targetProjectPath } = event.payload;

          const { recordRun } = useAutomationStore.getState();

          try {
            // If a target thread is specified, switch to it first
            if (targetThreadId) {
              onSelectThreadRef.current(targetThreadId, targetProjectPath);
            }

            // Wait a tick for the thread switch to take effect
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Send the prompt through the normal message pipeline.
            // This goes through the P1 approval/sandbox tier automatically.
            await sendMessageRef.current({ draftMessage: prompt });

            // Record successful run
            recordRun(taskId, 'succeeded', 'Prompt delivered to thread');
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);

            // Check if it was blocked by approval
            if (message.includes('approval') || message.includes('拦截')) {
              recordRun(taskId, 'blocked_by_approval', message);
            } else {
              recordRun(taskId, 'failed', message);
            }
          }
        }
      );
    };

    void setup();

    return () => {
      unlisten?.();
    };
  }, []);
}
