/**
 * Compact summary prompt templates and response parsing.
 * @module compact/prompt
 */

export type CompactPromptMode = 'base' | 'partial' | 'partial_up_to';

const COMPACT_SUMMARY_INSTRUCTIONS = `Analyze the conversation history and create a concise summary that captures:

1. The task or objective we're working on
2. Key decisions made
3. Important findings or results
4. Current state/progress
5. Any open questions or next steps
6. Relevant technical details (file paths, dependencies, architecture)

Guidelines:
- Keep it factual and objective
- Preserve important technical details
- Note what's been completed and what's pending
- Include any user preferences or patterns observed
- Exclude conversational filler and false starts
- The summary should be detailed enough to resume work without loss of context`;

function buildModeScope(mode: CompactPromptMode): string {
  if (mode === 'partial') {
    return 'Scope: Summarize the RECENT portion of this conversation. Earlier messages are being kept intact.\n\n';
  }
  if (mode === 'partial_up_to') {
    return 'Scope: Summarize ONLY the earlier prefix of this conversation. The summary will be placed at the start of the session, followed by the most recent messages.\n\n';
  }
  return 'Scope: Summarize the earlier portion of this conversation that will be replaced by your summary.\n\n';
}

export function buildCompactPrompt(mode: CompactPromptMode, conversationText: string): string {
  return `${buildModeScope(mode)}${COMPACT_SUMMARY_INSTRUCTIONS}

Output format:
- First write your analysis inside <analysis>...</analysis> tags (this will be stripped).
- Then output the final summary inside <summary>...</summary> tags.
- Use markdown headings for the six sections above.

Conversation to summarize:
---
${conversationText}
---`;
}

/**
 * Strip <analysis> block and extract <summary> content.
 */
export function parseCompactResponse(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const summaryMatch = trimmed.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryMatch?.[1]) {
    return summaryMatch[1].trim();
  }

  // Fallback: strip analysis if present, use remainder
  const withoutAnalysis = trimmed.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim();
  if (withoutAnalysis.length > 50) {
    return withoutAnalysis;
  }

  return trimmed.length > 50 ? trimmed : null;
}
