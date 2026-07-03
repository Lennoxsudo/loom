/**
 * Automation task types for scheduled / background tasks
 * that can resume an existing thread's context.
 */

import type { AgentAccessMode } from './settings';

/** Status of a single automation run */
export type AutomationRunStatus = 'succeeded' | 'failed' | 'blocked_by_approval';

/** A single entry in the run history of an automation task */
export interface AutomationRunRecord {
  /** ISO timestamp when the run was triggered */
  runAt: string;
  /** Status of the run */
  status: AutomationRunStatus;
  /** Optional short summary of what happened */
  summary?: string;
}

/** Trigger type for an automation task */
export type AutomationTriggerType = 'interval' | 'cron' | 'file_change';

/** Interval trigger: runs every N minutes */
export interface IntervalTrigger {
  type: 'interval';
  /** Interval in minutes (minimum 1) */
  minutes: number;
}

/** Cron trigger: runs on a cron schedule */
export interface CronTrigger {
  type: 'cron';
  /** Cron expression (standard 5-field) */
  expression: string;
}

/** File change trigger: runs when matching files change in the target project */
export interface FileChangeTrigger {
  type: 'file_change';
  /** Glob patterns to watch within the target project path */
  patterns: string[];
}

/** Union of all trigger types */
export type AutomationTrigger = IntervalTrigger | CronTrigger | FileChangeTrigger;

/** An automation task definition */
export interface AutomationTask {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Whether the task is currently enabled */
  enabled: boolean;
  /** Trigger condition */
  trigger: AutomationTrigger;
  /** Target project path (required) */
  targetProjectPath: string;
  /** Target thread ID to resume (null = new thread each time) */
  targetThreadId: string | null;
  /** The prompt to send when the task triggers */
  prompt: string;
  /** Access mode for background runs (defaults to more conservative than user setting) */
  accessMode: AgentAccessMode;
  /** ISO timestamp of last run, if any */
  lastRunAt?: string;
  /** ISO timestamp of next scheduled run, if computable */
  nextRunAt?: string;
  /** History of past runs (most recent first, capped at 50) */
  runHistory: AutomationRunRecord[];
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

/** Payload for creating a new automation task */
export interface CreateAutomationTaskPayload {
  name: string;
  trigger: AutomationTrigger;
  targetProjectPath: string;
  targetThreadId?: string | null;
  prompt: string;
  accessMode?: AgentAccessMode;
  enabled?: boolean;
}

/** Payload for updating an existing automation task */
export interface UpdateAutomationTaskPayload {
  name?: string;
  enabled?: boolean;
  trigger?: AutomationTrigger;
  targetProjectPath?: string;
  targetThreadId?: string | null;
  prompt?: string;
  accessMode?: AgentAccessMode;
}

/** Event payload emitted when an automation task is triggered */
export interface AutomationTriggeredEvent {
  taskId: string;
  targetThreadId: string | null;
  prompt: string;
  targetProjectPath: string;
  accessMode: AgentAccessMode;
}
