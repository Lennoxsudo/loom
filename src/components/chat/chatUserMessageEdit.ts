/**
 * Helpers for chat user-bubble edit/resend (checkpoint rollback + re-stream).
 */

/** Split file-context prefix from the editable body of a chat user message. */
export function splitChatUserMessageContent(
  content: string,
  fileContextMarker: string
): { prefix: string; body: string } {
  const raw = content || '';
  if (!fileContextMarker || !raw.startsWith(fileContextMarker)) {
    return { prefix: '', body: raw };
  }
  const splitIndex = raw.lastIndexOf('\n---\n\n');
  if (splitIndex === -1) {
    return { prefix: '', body: raw };
  }
  // Include the separator so resend can recombine cleanly
  return {
    prefix: raw.substring(0, splitIndex + '\n---\n\n'.length),
    body: raw.substring(splitIndex + '\n---\n\n'.length),
  };
}

export function rebuildChatUserMessageContent(prefix: string, body: string): string {
  return `${prefix}${body}`;
}

export function buildChatCheckpointSessionKey(
  projectPath: string,
  conversationId: string
): string {
  const projectKey = projectPath.trim().replace(/\\/g, '/').toLowerCase() || 'no-project';
  return `${projectKey}::${conversationId}`;
}
