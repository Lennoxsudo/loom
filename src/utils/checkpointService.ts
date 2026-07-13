import { invoke } from '@tauri-apps/api/core';
import type {
  AgentCheckpoint,
  CheckpointCreateInput,
  CheckpointRestoreResult,
} from './checkpointTimeline';

/** Backend uses camelCase serde; keep TS shapes aligned. */
type BackendCheckpoint = AgentCheckpoint;
type BackendRestoreResult = {
  restoredFiles: string[];
  deletedFiles: string[];
  skippedFiles: string[];
  truncatedCheckpointIds: string[];
  success: boolean;
  message: string;
};

export async function createCheckpoint(
  input: CheckpointCreateInput
): Promise<AgentCheckpoint> {
  return invoke<BackendCheckpoint>('checkpoint_create', {
    request: {
      sessionKey: input.sessionKey,
      projectPath: input.projectPath,
      toolCallId: input.toolCallId ?? null,
      userMessageId: input.userMessageId ?? null,
      toolName: input.toolName,
      label: input.label ?? null,
      files: input.files.map((f) => ({
        path: f.path,
        existed: f.existed,
        content: f.content,
        isBinary: f.isBinary ?? false,
      })),
    },
  });
}

export async function listCheckpoints(sessionKey: string): Promise<AgentCheckpoint[]> {
  if (!sessionKey.trim()) return [];
  return invoke<BackendCheckpoint[]>('checkpoint_list', { sessionKey });
}

export async function restoreCheckpoint(options: {
  sessionKey: string;
  checkpointId: string;
  projectPath: string;
}): Promise<CheckpointRestoreResult> {
  const result = await invoke<BackendRestoreResult>('checkpoint_restore', {
    request: {
      sessionKey: options.sessionKey,
      checkpointId: options.checkpointId,
      projectPath: options.projectPath,
    },
  });
  return {
    restoredFiles: result.restoredFiles ?? [],
    deletedFiles: result.deletedFiles ?? [],
    skippedFiles: result.skippedFiles ?? [],
    truncatedCheckpointIds: result.truncatedCheckpointIds ?? [],
    success: result.success,
    message: result.message,
  };
}

export async function clearCheckpointSession(sessionKey: string): Promise<void> {
  if (!sessionKey.trim()) return;
  await invoke('checkpoint_clear_session', { sessionKey });
}
