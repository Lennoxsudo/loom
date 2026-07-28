import {
  hasInlineThinkTags,
  mergeDistinctTextSegments,
  mergeStreamingAndFinalSplit,
  parseInlineThinkingFromContent,
  sanitizeSeparateReasoningStream,
  stripStrayThinkTags,
} from './thinkingExtractor';

export type StreamChunkType = 'thinking' | 'content';

export interface TrustedStreamSeparationInput {
  rawContent: string;
  rawThinking: string;
  chunk_type: StreamChunkType;
  chunk: string;
  chunkTime: number;
  receivedThinkingChunks?: boolean;
  thinkingStartedAt?: number;
  thinkingEndedAt?: number;
  firstContentTime?: number;
}

export interface TrustedStreamSeparationResult {
  content: string;
  thinking: string;
  isThinking: boolean;
  receivedThinkingChunks: boolean;
  thinkingStartedAt?: number;
  thinkingEndedAt?: number;
  firstContentTime?: number;
}

/**
 * Native reasoning sometimes embeds a prompt-style </thinking> followed by an
 * alternate paraphrase. Keep a single segment (longer wins); never leak the
 * other side into the reply body (that caused bilingual / duplicate bubbles).
 */
function resolveNativeReasoningThinking(rawThinking: string): string {
  const sanitized = sanitizeSeparateReasoningStream(rawThinking);
  const before = sanitized.thinking.trim();
  const after = sanitized.leakedText.trim();
  if (!after) {
    return stripStrayThinkTags(sanitized.thinking, { trim: false });
  }
  return before.length >= after.length ? before : after;
}

/** Pick one native thinking source — never concatenate divergent paraphrases. */
function pickMonotonicNativeThinking(streamThinking: string, rawThinking: string): string {
  const fromRaw = resolveNativeReasoningThinking(rawThinking);
  const fromStream = resolveNativeReasoningThinking(streamThinking);
  if (!fromStream) return fromRaw;
  if (!fromRaw) return fromStream;
  if (fromStream === fromRaw) return fromStream;
  if (fromStream.includes(fromRaw)) return fromStream;
  if (fromRaw.includes(fromStream)) return fromRaw;
  return fromRaw.length >= fromStream.length ? fromRaw : fromStream;
}

/** Gemini (and some OpenAI-compatible proxies) emit thinking as `<thought>...</thought>` in content. */
function hasGeminiThoughtTags(content: string): boolean {
  return /<\/?thought\b/i.test(content || '');
}

/**
 * Split content-channel tags:
 * - `<thought>` → promote into thinking bubble (Gemini / gateway)
 * - `<thinking>` / `<think>` → strip from body only (legacy prompt injection)
 *
 * Never discard extracted `<thought>` text.
 */
function separateContentChannelThinking(content: string): { text: string; thinking: string } {
  if (!hasInlineThinkTags(content)) {
    return { text: content, thinking: '' };
  }
  const inline = parseInlineThinkingFromContent(content);
  if (hasGeminiThoughtTags(content)) {
    return { text: inline.text, thinking: inline.thinking };
  }
  // Legacy pseudo-thinking tags: keep body clean, do not promote.
  return { text: inline.text, thinking: '' };
}

/**
 * Trust backend chunk_type during streaming.
 * Thinking bubble prefers native reasoning (chunk_type === 'thinking').
 * Gemini `<thought>` tags in the content channel are also promoted into the bubble.
 * Legacy `<thinking>` / `<think>` prompt tags are stripped from the body only.
 */
export function applyTrustedStreamSeparation(
  input: TrustedStreamSeparationInput
): TrustedStreamSeparationResult {
  const {
    rawContent,
    rawThinking,
    chunk_type,
    chunk,
    chunkTime,
    receivedThinkingChunks = false,
  } = input;

  let thinkingStartedAt = input.thinkingStartedAt;
  let thinkingEndedAt = input.thinkingEndedAt;
  let firstContentTime = input.firstContentTime;
  const nextReceivedThinkingChunks = receivedThinkingChunks || chunk_type === 'thinking';

  if (chunk_type === 'thinking' && !thinkingStartedAt) {
    thinkingStartedAt = chunkTime;
  }

  const hadThinkingBeforeChunk = Boolean((rawThinking || '').trim());
  if (
    chunk_type === 'content' &&
    chunk.trim().length > 0 &&
    hadThinkingBeforeChunk &&
    !thinkingEndedAt
  ) {
    thinkingEndedAt = chunkTime;
  }

  if (chunk_type === 'content' && chunk.trim().length > 0 && !firstContentTime) {
    firstContentTime = chunkTime;
  }

  const fromContent = separateContentChannelThinking(rawContent);
  let content = fromContent.text;
  let thinking: string;

  if (nextReceivedThinkingChunks) {
    // Prefer native stream, but never drop Gemini <thought> left in content.
    thinking = mergeDistinctTextSegments(
      resolveNativeReasoningThinking(rawThinking),
      fromContent.thinking
    );
  } else if ((rawThinking || '').trim()) {
    const sanitized = sanitizeSeparateReasoningStream(rawThinking);
    if (sanitized.leakedText) {
      content = mergeDistinctTextSegments(sanitized.leakedText, content);
      if (!thinkingEndedAt) {
        thinkingEndedAt = chunkTime;
      }
      if (!firstContentTime) {
        firstContentTime = chunkTime;
      }
    }
    thinking = mergeDistinctTextSegments(sanitized.thinking, fromContent.thinking);
  } else {
    thinking = fromContent.thinking;
    if (thinking && !thinkingStartedAt) {
      thinkingStartedAt = chunkTime;
    }
    if (content.trim() && thinking && !thinkingEndedAt) {
      thinkingEndedAt = chunkTime;
    }
    if (content.trim() && !firstContentTime) {
      firstContentTime = chunkTime;
    }
  }

  const isThinking =
    !(content || '').trim() && (chunk_type === 'thinking' || Boolean((thinking || '').trim()));

  return {
    content,
    thinking,
    isThinking,
    receivedThinkingChunks: nextReceivedThinkingChunks,
    thinkingStartedAt,
    thinkingEndedAt,
    firstContentTime,
  };
}

export interface FinalizeStreamMessageInput {
  rawContent: string;
  rawThinking: string;
  streamContent?: string;
  streamThinking?: string;
  receivedThinkingChunks?: boolean;
  hasToolCalls?: boolean;
}

export interface FinalizeStreamMessageResult {
  content: string;
  thinking: string;
}

/**
 * Monotonic finalize: prefer native reasoning stream; also promote Gemini `<thought>` tags.
 * Never discard content-channel `<thought>` into an empty thinking field.
 * Legacy `<thinking>` / `<think>` prompt tags are stripped from the body only.
 */
export function finalizeStreamMessage(
  input: FinalizeStreamMessageInput
): FinalizeStreamMessageResult {
  const rawContent = (input.rawContent || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawThinking = (input.rawThinking || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const fromStream = separateContentChannelThinking((input.streamContent ?? rawContent).trim());
  const fromRaw = separateContentChannelThinking(rawContent.trim());
  const streamText = fromStream.text.trim();
  const streamThinking = (input.streamThinking ?? rawThinking).trim();

  const hasNativeReasoning = Boolean(input.receivedThinkingChunks) || Boolean(rawThinking.trim());

  if (hasNativeReasoning) {
    const native = pickMonotonicNativeThinking(streamThinking, rawThinking);
    const thinking = mergeDistinctTextSegments(
      native,
      mergeDistinctTextSegments(fromStream.thinking, fromRaw.thinking)
    );
    const merged = mergeStreamingAndFinalSplit(
      { text: streamText, thinking },
      { text: fromRaw.text, thinking }
    );
    return {
      content: merged.text,
      thinking: merged.thinking,
    };
  }

  const merged = mergeStreamingAndFinalSplit(
    { text: streamText, thinking: fromStream.thinking },
    { text: fromRaw.text, thinking: fromRaw.thinking }
  );
  return {
    content: merged.text,
    thinking: merged.thinking,
  };
}

export { mergeDistinctTextSegments };
