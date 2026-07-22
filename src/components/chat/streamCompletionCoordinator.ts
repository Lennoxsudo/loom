export const STREAM_COMPLETION_QUIESCENCE_MS = 50;

type MessageId = string;

/**
 * Keeps a completed stream open briefly so chunks delivered after its completion
 * event are still accepted before the owning UI releases the message.
 */
export class StreamCompletionCoordinator {
  private readonly pending = new Map<MessageId, { timer: number; finalize: () => void }>();

  constructor(private readonly flushMessage: (messageId: MessageId) => void) {}

  complete(messageId: MessageId, finalize: () => void): void {
    this.flushMessage(messageId);
    this.scheduleFinalization(messageId, finalize);
  }

  noteChunk(messageId: MessageId): boolean {
    const pending = this.pending.get(messageId);
    if (!pending) return false;

    this.scheduleFinalization(messageId, pending.finalize);
    return true;
  }

  cancel(messageId: MessageId): void {
    const pending = this.pending.get(messageId);
    if (pending) {
      window.clearTimeout(pending.timer);
      this.pending.delete(messageId);
    }
  }

  dispose(): void {
    for (const { timer } of this.pending.values()) {
      window.clearTimeout(timer);
    }
    this.pending.clear();
  }

  private scheduleFinalization(messageId: MessageId, finalize: () => void): void {
    this.cancel(messageId);
    const timer = window.setTimeout(() => {
      this.pending.delete(messageId);
      this.flushMessage(messageId);
      finalize();
    }, STREAM_COMPLETION_QUIESCENCE_MS);
    this.pending.set(messageId, { timer, finalize });
  }
}
