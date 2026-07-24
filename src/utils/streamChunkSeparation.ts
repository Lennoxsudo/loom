import {
  hasInlineThinkTags,
  mergeDistinctTextSegments,
  mergeStreamingAndFinalSplit,
  parseInlineThinkingFromContent,
  sanitizeSeparateReasoningStream,
  separateMessageState,
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

function needsInlineTagFallback(
  rawContent: string,
  rawThinking: string,
  receivedThinkingChunks: boolean
): boolean {
  if (receivedThinkingChunks) return false;
  if ((rawThinking || '').trim().length > 0) return false;
  return hasInlineThinkTags(rawContent);
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


/**
 * Trust backend chunk_type during streaming; only apply tag-only fallback when
 * the provider never emitted a separate thinking stream but left tags in content.
 *
 * When a native reasoning stream was received, thinking comes ONLY from that
 * stream — never merge content-channel <thinking> tags (avoids bilingual dupes).
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

  if (needsInlineTagFallback(rawContent, rawThinking, nextReceivedThinkingChunks)) {
    const inline = parseInlineThinkingFromContent(rawContent);
    const hasClosingTag = /<\/think(?:ing)?>/i.test(rawContent) || rawContent.includes('思考结束');
    const isThinking =
      !(inline.text || '').trim() && (!hasClosingTag || Boolean((inline.thinking || '').trim()));

    if (inline.thinking && !thinkingStartedAt) {
      thinkingStartedAt = chunkTime;
    }
    if (
      inline.text.trim() &&
      hadThinkingBeforeChunk === false &&
      inline.thinking &&
      !thinkingEndedAt
    ) {
      thinkingEndedAt = chunkTime;
    }
    if (inline.text.trim() && !firstContentTime) {
      firstContentTime = chunkTime;
    }

    return {
      content: inline.text,
      thinking: inline.thinking,
      isThinking: isThinking && !(inline.text || '').trim(),
      receivedThinkingChunks: nextReceivedThinkingChunks,
      thinkingStartedAt,
      thinkingEndedAt,
      firstContentTime,
    };
  }

  let content = rawContent;
  let thinking = rawThinking;

  if (nextReceivedThinkingChunks) {
    // Native reasoning only — never prepend content-channel <thinking> tags.
    thinking = resolveNativeReasoningThinking(thinking);
    if (hasInlineThinkTags(content)) {
      content = parseInlineThinkingFromContent(content).text;
    }
  } else {
    if ((rawThinking || '').trim() && hasInlineThinkTags(rawContent)) {
      const inline = parseInlineThinkingFromContent(rawContent);
      content = inline.text;
      thinking = inline.thinking
        ? mergeDistinctTextSegments(inline.thinking, rawThinking)
        : rawThinking;
    }

    const sanitized = sanitizeSeparateReasoningStream(thinking);
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
 * Monotonic finalize: preserve streamed bubble assignment, only tag-parse or
 * light cleanup when the provider never split thinking/content.
 *
 * With a native reasoning stream, never merge content <thinking> into thinking.
 */
export function finalizeStreamMessage(
  input: FinalizeStreamMessageInput
): FinalizeStreamMessageResult {
  const rawContent = (input.rawContent || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawThinking = (input.rawThinking || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const streamText = (input.streamContent ?? rawContent).trim();
  const streamThinking = (input.streamThinking ?? rawThinking).trim();

  const streamState = { text: streamText, thinking: streamThinking };

  const hasNativeReasoning = Boolean(input.receivedThinkingChunks) || Boolean(rawThinking.trim());
  const backendSplit = hasNativeReasoning || !hasInlineThinkTags(rawContent);

  if (backendSplit) {
    if (input.receivedThinkingChunks || rawThinking.trim()) {
      const thinking = pickMonotonicNativeThinking(streamThinking, rawThinking);
      let text = rawContent.trim();
      if (hasInlineThinkTags(text)) {
        text = parseInlineThinkingFromContent(text).text;
      }
      // Merge body text only — pass identical thinking so finalize cannot concat paraphrases.
      const merged = mergeStreamingAndFinalSplit(
        { text: streamText, thinking },
        { text, thinking }
      );
      return {
        content: hasInlineThinkTags(merged.text)
          ? parseInlineThinkingFromContent(merged.text).text
          : merged.text,
        thinking,
      };
    }

    const sanitizedThinking = sanitizeSeparateReasoningStream(rawThinking);
    const finalState = {
      text: mergeDistinctTextSegments(sanitizedThinking.leakedText, rawContent.trim()),
      thinking: sanitizedThinking.thinking.trim(),
    };
    const merged = mergeStreamingAndFinalSplit(streamState, finalState);
    if (hasInlineThinkTags(merged.text)) {
      const parsed = parseInlineThinkingFromContent(merged.text);
      return {
        content: parsed.text,
        thinking: mergeDistinctTextSegments(merged.thinking, parsed.thinking),
      };
    }
    return { content: merged.text, thinking: merged.thinking };
  }

  const finalSplit = separateMessageState({
    rawContent,
    rawThinking,
    isStreaming: false,
  });

  const merged = mergeStreamingAndFinalSplit(streamState, {
    text: finalSplit.text.trim(),
    thinking: finalSplit.thinking.trim(),
  });
  return { content: merged.text, thinking: merged.thinking };
}

export { mergeDistinctTextSegments };
