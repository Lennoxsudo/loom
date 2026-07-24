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

/** Strip prompt-style think tags from body text; never promote them into the thinking bubble. */
function stripPseudoThinkTagsFromContent(content: string): string {
  if (!hasInlineThinkTags(content)) return content;
  return parseInlineThinkingFromContent(content).text;
}

/**
 * Trust backend chunk_type during streaming.
 * Thinking bubble is fed ONLY by the native reasoning stream (chunk_type === 'thinking').
 * Content-channel <thinking> tags are stripped from the body, never shown as thinking.
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

  let content = stripPseudoThinkTagsFromContent(rawContent);
  let thinking = '';

  if (nextReceivedThinkingChunks) {
    thinking = resolveNativeReasoningThinking(rawThinking);
  } else if ((rawThinking || '').trim()) {
    // Legacy persisted rawThinking without chunk_type — treat as native-ish and sanitize only.
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
    thinking = sanitized.thinking;
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
 * Monotonic finalize: thinking comes only from the native reasoning stream.
 * Content-channel <thinking> tags are stripped from the body, never promoted.
 */
export function finalizeStreamMessage(
  input: FinalizeStreamMessageInput
): FinalizeStreamMessageResult {
  const rawContent = (input.rawContent || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawThinking = (input.rawThinking || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const streamText = stripPseudoThinkTagsFromContent(
    (input.streamContent ?? rawContent).trim()
  ).trim();
  const streamThinking = (input.streamThinking ?? rawThinking).trim();

  const hasNativeReasoning = Boolean(input.receivedThinkingChunks) || Boolean(rawThinking.trim());

  if (hasNativeReasoning) {
    const thinking = pickMonotonicNativeThinking(streamThinking, rawThinking);
    const text = stripPseudoThinkTagsFromContent(rawContent.trim());
    const merged = mergeStreamingAndFinalSplit(
      { text: streamText, thinking },
      { text, thinking }
    );
    return {
      content: stripPseudoThinkTagsFromContent(merged.text),
      thinking,
    };
  }

  // No native reasoning — keep body only; discard prompt-style think tags.
  const text = stripPseudoThinkTagsFromContent(rawContent.trim());
  const merged = mergeStreamingAndFinalSplit(
    { text: streamText, thinking: '' },
    { text, thinking: '' }
  );
  return { content: stripPseudoThinkTagsFromContent(merged.text), thinking: '' };
}

export { mergeDistinctTextSegments };
