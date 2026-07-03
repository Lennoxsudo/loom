import type { ToolCall } from '../../types/ai';
import {
  extractCompatToolCallsFromContent,
  normalizeToolCallsForSubagent,
} from './compatToolCalls';
import { extractPseudoToolCallsFromContent } from './pseudoToolExtractor';

export interface FinalizeStreamToolCallsResult {
  toolCalls: ToolCall[];
  cleanedText: string;
}

/**
 * Subagent stream resolution:
 * 1. Native provider tool_calls (normalized to allowed tool names)
 * 2. Compat JSON-in-content fallbacks for relays that omit tool_calls
 */
export function resolveSubagentStreamToolCalls(
  text: string,
  nativeToolCalls: ToolCall[] | undefined,
  knownToolNames: string[]
): FinalizeStreamToolCallsResult {
  if (nativeToolCalls && nativeToolCalls.length > 0) {
    return {
      toolCalls: normalizeToolCallsForSubagent(nativeToolCalls, knownToolNames),
      cleanedText: text,
    };
  }

  if (!text || !text.trim() || knownToolNames.length === 0) {
    return { toolCalls: [], cleanedText: text || '' };
  }

  const compat = extractCompatToolCallsFromContent(text, knownToolNames);
  if (compat.toolCalls.length > 0) {
    return { toolCalls: compat.toolCalls, cleanedText: compat.cleanedContent };
  }

  const pseudo = extractPseudoToolCallsFromContent(text, knownToolNames);
  return { toolCalls: pseudo.toolCalls, cleanedText: pseudo.cleanedContent };
}

/**
 * Use only native tool_calls from the stream complete event.
 */
export function resolveNativeStreamToolCalls(
  text: string,
  nativeToolCalls: ToolCall[] | undefined
): FinalizeStreamToolCallsResult {
  return {
    toolCalls: nativeToolCalls ?? [],
    cleanedText: text,
  };
}
