type TextUnit = string;

let graphemeSegmenter: Intl.Segmenter | null | undefined;

function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (graphemeSegmenter !== undefined) {
    return graphemeSegmenter;
  }

  try {
    graphemeSegmenter =
      typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;
  } catch {
    graphemeSegmenter = null;
  }

  return graphemeSegmenter;
}

function splitTextUnits(text: string): TextUnit[] {
  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    return [...segmenter.segment(text)].map((part) => part.segment);
  }
  return Array.from(text);
}

/** 统计流式输出用的可见字素/码点数量（非 UTF-16 code unit） */
export function countStreamTextUnits(text: string): number {
  if (!text) return 0;
  return splitTextUnits(text).length;
}

/** 从文本头部取出指定数量的字素/码点，避免拆开 surrogate pair */
export function takeStreamTextUnits(text: string, count: number): { head: string; tail: string } {
  if (!text || count <= 0) {
    return { head: '', tail: text };
  }

  const units = splitTextUnits(text);
  if (count >= units.length) {
    return { head: text, tail: '' };
  }

  const head = units.slice(0, count).join('');
  const tail = units.slice(count).join('');
  return { head, tail };
}

export function appendThinkingStreamChunk(
  existing: string,
  chunk: string,
  lastChunk?: string
): { rawThinking: string; lastThinkingChunk: string } {
  if (!chunk) {
    return {
      rawThinking: existing,
      lastThinkingChunk: lastChunk ?? '',
    };
  }
  if (chunk === lastChunk) {
    return {
      rawThinking: existing,
      lastThinkingChunk: lastChunk,
    };
  }
  return {
    rawThinking: `${existing || ''}${chunk}`,
    lastThinkingChunk: chunk,
  };
}
