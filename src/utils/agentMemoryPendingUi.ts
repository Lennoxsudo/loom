/** Parse / format agent_memory pending approval markers in tool output. */

const PENDING_ID_RE = /^pending_id:\s*(\S+)\s*$/m;

export function parseAgentMemoryPendingId(output: string): string | null {
  const match = output.match(PENDING_ID_RE);
  const id = match?.[1]?.trim();
  return id || null;
}

export function formatAgentMemoryStagedOutput(options: {
  pendingId: string;
  action: string;
  target: string;
  content?: string;
  oldText?: string;
}): string {
  return [
    `Staged for approval (${options.action} → ${options.target}).`,
    'Not written to disk yet — approve or reject in the tool result below.',
    options.content ? `content: ${options.content}` : '',
    options.oldText ? `old_text: ${options.oldText}` : '',
    `pending_id: ${options.pendingId}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function getAgentMemoryPendingIdFromMessage(toolArgs: Record<string, unknown> | undefined): string | null {
  const raw = toolArgs?.agentMemoryPendingId;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}
