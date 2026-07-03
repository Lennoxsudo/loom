import type { ToolCall } from '../../types/ai';
import { extractPseudoToolCallsFromContent } from './pseudoToolExtractor';
import type { FinalizeStreamToolCallsResult } from './finalizeStreamToolCalls';

/**
 * Resolve tool calls after a main-conversation stream completes:
 * prefer native tool_calls, fall back to pseudo/XML extraction from assistant text.
 */
export function finalizeMainStreamToolCalls(
  text: string,
  nativeToolCalls: ToolCall[] | undefined,
  knownToolNames: string[]
): FinalizeStreamToolCallsResult {
  if (nativeToolCalls && nativeToolCalls.length > 0) {
    return { toolCalls: nativeToolCalls, cleanedText: text };
  }

  if (!text || !text.trim()) {
    return { toolCalls: [], cleanedText: text || '' };
  }

  const { toolCalls, cleanedContent } = extractPseudoToolCallsFromContent(text, knownToolNames);
  return { toolCalls, cleanedText: cleanedContent };
}
