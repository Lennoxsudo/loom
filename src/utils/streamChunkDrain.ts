import { countStreamTextUnits, takeStreamTextUnits } from './streamTextUnits';

export const FAST_DRAIN_CHARS_PER_FRAME = 64;

type DrainableStreamChunk = {
  chunk: string;
};

/** Consume up to `charsBudget` text units from the head of the queue. */
export function drainQueueChunkBatch<T extends DrainableStreamChunk>(
  queue: T[],
  applyStreamChunk: (item: T) => void,
  charsBudget: number,
  shouldSkip?: (item: T) => boolean
): void {
  let remaining = charsBudget;

  while (remaining > 0 && queue.length > 0) {
    const head = queue[0];

    if (shouldSkip?.(head)) {
      queue.shift();
      continue;
    }

    const textLen = countStreamTextUnits(head.chunk);
    if (textLen <= remaining) {
      queue.shift();
      applyStreamChunk(head);
      remaining -= textLen;
    } else {
      const { head: part, tail } = takeStreamTextUnits(head.chunk, remaining);
      head.chunk = tail;
      applyStreamChunk({ ...head, chunk: part });
      remaining = 0;
    }
  }
}
