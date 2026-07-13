/**
 * Pure helpers for action-granularity checkpoints (time-travel restore plan).
 * I/O is handled by the Tauri `checkpoint_*` commands.
 */

export type CheckpointFileSnapshot = {
  path: string;
  existed: boolean;
  content: string | null;
  isBinary?: boolean;
};

export type AgentCheckpoint = {
  id: string;
  sessionKey: string;
  projectPath: string;
  toolCallId?: string | null;
  /** User turn that triggered this tool snapshot (for bubble edit/resend restore). */
  userMessageId?: string | null;
  toolName: string;
  label: string;
  createdAt: number;
  files: Array<{
    path: string;
    existed: boolean;
    isBinary: boolean;
    byteLen: number;
    blob: string;
  }>;
};

export type CheckpointCreateInput = {
  sessionKey: string;
  projectPath: string;
  toolCallId?: string;
  userMessageId?: string;
  toolName: string;
  label?: string;
  files: CheckpointFileSnapshot[];
};

export type CheckpointRestoreResult = {
  restoredFiles: string[];
  deletedFiles: string[];
  skippedFiles: string[];
  truncatedCheckpointIds: string[];
  success: boolean;
  message: string;
};

/** Tools that mutate the workspace and should take a pre-action checkpoint. */
export const CHECKPOINT_MUTATING_TOOLS = new Set([
  'write_file',
  'edit_file',
  'write',
  'edit',
  'delete_file',
  'create_folder',
  'move_file',
  'copy_file',
  'generate_image',
]);

export function isCheckpointMutatingTool(toolName: string): boolean {
  return CHECKPOINT_MUTATING_TOOLS.has(toolName);
}

export function normalizeCheckpointPath(path: string): string {
  return path.trim().replace(/\//g, '\\').replace(/\\+/g, '\\').toLowerCase();
}

export function shortFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

export function buildCheckpointLabel(toolName: string, paths: string[]): string {
  if (paths.length === 0) return toolName;
  const first = shortFileName(paths[0]);
  if (paths.length === 1) return `${toolName} · ${first}`;
  return `${toolName} · ${first} +${paths.length - 1}`;
}

/**
 * Build restore plan: for each path touched from target checkpoint onwards,
 * use the earliest snapshot (state at restore point).
 */
export function buildRestorePlan(
  checkpoints: AgentCheckpoint[],
  targetId: string
): Map<string, { path: string; existed: boolean; isBinary: boolean }> {
  const ordered = [...checkpoints].sort((a, b) => a.createdAt - b.createdAt);
  const start = ordered.findIndex((c) => c.id === targetId);
  if (start < 0) return new Map();

  const plan = new Map<string, { path: string; existed: boolean; isBinary: boolean }>();
  for (const cp of ordered.slice(start)) {
    for (const file of cp.files) {
      const key = normalizeCheckpointPath(file.path);
      if (!plan.has(key)) {
        plan.set(key, {
          path: file.path,
          existed: file.existed,
          isBinary: file.isBinary,
        });
      }
    }
  }
  return plan;
}

/** Drop target and all later checkpoints after a successful restore. */
export function truncateCheckpointsAfterRestore(
  checkpoints: AgentCheckpoint[],
  targetId: string
): AgentCheckpoint[] {
  const ordered = [...checkpoints].sort((a, b) => a.createdAt - b.createdAt);
  const start = ordered.findIndex((c) => c.id === targetId);
  if (start < 0) return ordered;
  return ordered.slice(0, start);
}

/**
 * Find the earliest checkpoint belonging to the given user turn(s), used when
 * editing a user bubble and rolling back all file mutations after that message.
 */
export function findEarliestCheckpointForUserTurns(
  checkpoints: AgentCheckpoint[],
  userMessageIds: string[],
  fallbackAfterCreatedAt?: number
): AgentCheckpoint | null {
  const idSet = new Set(userMessageIds.filter(Boolean));
  const ordered = [...checkpoints].sort((a, b) => a.createdAt - b.createdAt);
  const matched = ordered.filter((cp) => {
    if (cp.userMessageId && idSet.has(cp.userMessageId)) return true;
    if (
      !cp.userMessageId &&
      fallbackAfterCreatedAt != null &&
      cp.createdAt >= fallbackAfterCreatedAt
    ) {
      return true;
    }
    return false;
  });
  return matched[0] ?? null;
}

/** User messages at and after `fromIndex` in the conversation (inclusive). */
export function collectUserMessageIdsFromIndex(
  messages: Array<{ id: string; role: string }>,
  fromIndex: number
): string[] {
  const ids: string[] = [];
  for (let i = Math.max(0, fromIndex); i < messages.length; i++) {
    if (messages[i]?.role === 'user') ids.push(messages[i].id);
  }
  return ids;
}

export function collectPathsFromToolArgs(
  toolName: string,
  args: Record<string, unknown>
): string[] {
  const paths: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) paths.push(value.trim());
  };

  switch (toolName) {
    case 'move_file':
    case 'copy_file':
      push(args.source);
      push(args.destination);
      push(args.from);
      push(args.to);
      break;
    case 'delete_file':
    case 'create_folder':
    case 'write_file':
    case 'edit_file':
    case 'write':
    case 'edit':
    case 'generate_image':
      push(args.path);
      push(args.file_path);
      push(args.file);
      break;
    default:
      push(args.path);
      push(args.file_path);
      push(args.file);
      push(args.source);
      push(args.destination);
  }

  return paths;
}
