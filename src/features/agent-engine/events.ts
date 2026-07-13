/**
 * Agent engine boundary events / callback contracts.
 *
 * The engine must not import React UI components. Host layers (AgentPanel,
 * ChatPanel, hooks) inject behavior via {@link ToolContext} callbacks and may
 * optionally subscribe to {@link agentEngineEvents} for observability.
 *
 * @module features/agent-engine/events
 */

import type { QuestionInput, UserAnswer } from './toolArgs';

/** Callbacks the UI host injects into tool execution. */
export interface EngineHostCallbacks {
  /** Present ask-user questions and resolve with answers. */
  onAskUserQuestion?: (agentId: string, questions: QuestionInput[]) => Promise<UserAnswer[]>;
  /** Request tool approval for subagent / guarded tools. */
  onRequestToolApproval?: (req: {
    taskId: string;
    toolName: string;
    detailPreview: string;
  }) => Promise<'approve' | 'reject'>;
  /**
   * Notify host that a plan is ready for human review.
   * Non-blocking: the agent turn ends after this tool; Accept/Reject is handled in the UI.
   */
  onExitPlanMode?: (req: {
    conversationId: string;
    agentId?: string;
    plan: string;
    title?: string;
  }) => void | Promise<void>;
  /** Optional: notified when a tool call starts. */
  onToolCall?: (info: { toolName: string; toolCallId: string }) => void;
  /** Optional: notified when a tool call ends. */
  onToolCallEnd?: (info: {
    toolName: string;
    toolCallId: string;
    success: boolean;
    error?: string;
  }) => void;
}

export type AgentEngineEventMap = {
  toolCallStart: { toolName: string; toolCallId: string };
  toolCallEnd: {
    toolName: string;
    toolCallId: string;
    success: boolean;
    error?: string;
  };
  approvalRequired: {
    taskId: string;
    toolName: string;
    detailPreview: string;
  };
};

type Handler<T> = (payload: T) => void;

/**
 * Minimal typed pub/sub for engine observability (not required for core tool flow).
 * Product behavior still flows through ToolContext callbacks.
 */
class AgentEngineEventBus {
  private listeners = new Map<keyof AgentEngineEventMap, Set<Handler<unknown>>>();

  on<K extends keyof AgentEngineEventMap>(
    event: K,
    handler: Handler<AgentEngineEventMap[K]>
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Handler<unknown>);
    return () => {
      set!.delete(handler as Handler<unknown>);
    };
  }

  emit<K extends keyof AgentEngineEventMap>(event: K, payload: AgentEngineEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as Handler<AgentEngineEventMap[K]>)(payload);
      } catch {
        // Host listeners must not break tool execution
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const agentEngineEvents = new AgentEngineEventBus();
