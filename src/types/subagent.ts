/**
 * Types and task contracts for the Multi-Agent Subagent system.
 *
 * Defines the interaction contract between the parent agent and the subagent.
 */

/**
 * Status of a subagent run
 */
export type SubagentRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * The input task contract from parent agent to subagent
 */
export interface SubagentTask {
  /** Unique identifier for the subagent task */
  id: string;
  /** Self-contained description of the task to be performed by the subagent */
  description: string;
  /** Optional critical background context that the subagent cannot retrieve on its own */
  context?: string;
  /** Optional list of allowed tools to limit the subagent's capabilities. If omitted, a safe default set is used. */
  allowedTools?: string[];
  /** Optional model selection. Can be 'inherit' or a specific provider/model ID. */
  model?: string;
  /** Optional maximum number of tool execution rounds allowed for this subagent task */
  maxToolRounds?: number;
  /** Claude Code style subagent type name */
  subagentType?: string;
  /** Spawn mode: isolated (default) or fork */
  spawnMode?: 'isolated' | 'fork';
  /** Display color from agent definition */
  color?: string;
  /** Parent subagent task ID for nested runs */
  parentTaskId?: string;
}

/**
 * An artifact produced by the subagent during task execution
 */
export interface SubagentArtifact {
  /** The type of artifact: 'file' (created/modified file), 'finding' (key insight/discovery), or 'command' (executed terminal command) */
  type: 'file' | 'finding' | 'command';
  /** Reference to the artifact (e.g., file path, command string, or finding key/description) */
  ref: string;
  /** Optional description or note explaining the significance of the artifact */
  note?: string;
}

/**
 * Observable metrics collected during a subagent run
 */
export interface SubagentMetrics {
  /** Total wall-clock duration in milliseconds */
  durationMs: number;
  /** Number of tool call steps executed */
  steps: number;
  /** Estimated or reported prompt tokens */
  promptTokens: number;
  /** Estimated or reported completion tokens */
  completionTokens: number;
  /** Total tokens (prompt + completion) */
  totalTokens: number;
}

/**
 * The output contract from subagent back to the parent agent.
 * Only returns the summary and structured outcomes, keeping the main context clean.
 */
export interface SubagentResult {
  /** The associated task ID */
  taskId: string;
  /** The final status of the subagent task execution */
  status: 'succeeded' | 'failed' | 'cancelled';
  /** The summary of the execution results returned to the parent agent. This is the main body of the response. */
  summary: string;
  /** Optional list of artifacts generated during the task execution */
  artifacts?: SubagentArtifact[];
  /** Optional list of assumptions or hypotheses made by the subagent during execution */
  assumptions?: string[];
  /** Error message if the subagent task failed */
  error?: string;
  /** Optional flag indicating whether the execution was truncated (e.g. by max rounds limit) */
  truncated?: boolean;
  /** Optional observable metrics (duration, steps, tokens) */
  metrics?: SubagentMetrics;
}

/**
 * Chronological timeline entry for subagent expanded view
 */
export type SubagentTimelineEntry =
  | {
      kind: 'thinking';
      id: string;
      text: string;
    }
  | {
      kind: 'tool';
      id: string;
      toolName: string;
      status: 'running' | 'done' | 'error';
      resultPreview?: string;
    };

/**
 * The runtime state of a subagent run, used in store and UI
 */
export interface SubagentRun {
  /** The subagent task definition */
  task: SubagentTask;
  /** The current execution status of the run */
  status: SubagentRunStatus;
  /** Timestamp (epoch ms) when the task started running */
  startedAt?: number;
  /** Timestamp (epoch ms) when the task completed or aborted */
  finishedAt?: number;
  /** Number of tool call steps executed by the subagent */
  steps?: number;
  /** The final execution result once completed */
  result?: SubagentResult;
  /** Real-time streaming output text of the subagent */
  streamingText?: string;
  /** Real-time thinking blocks text of the subagent */
  thinkingText?: string;
  /** Interleaved thinking + tool steps (preferred for expanded UI) */
  timeline?: SubagentTimelineEntry[];
  /** Executed tool call events checklist */
  toolEvents?: Array<{
    id: string;
    toolName: string;
    status: 'running' | 'done' | 'error';
    resultPreview?: string;
    at: number;
  }>;
  /** Optional pending tool call approval request */
  pendingApproval?: {
    toolName: string;
    detailPreview: string;
    resolve: (choice: 'approve' | 'reject') => void;
  };
}

/** Serializable subagent run snapshot for message persistence (no approval callbacks). */
export type PersistedSubagentRun = Omit<SubagentRun, 'pendingApproval'>;

export function toPersistedSubagentRun(run: SubagentRun): PersistedSubagentRun {
  const { pendingApproval: _pendingApproval, ...persisted } = run;
  return persisted;
}

export function persistedSubagentRunToSubagentRun(record: PersistedSubagentRun): SubagentRun {
  return { ...record, pendingApproval: undefined };
}
