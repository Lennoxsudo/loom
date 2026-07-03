import { describe, test, expect } from 'vitest';
import { applyTrustedStreamSeparation, finalizeStreamMessage } from '../streamChunkSeparation';

describe('streamChunkSeparation', () => {
  describe('applyTrustedStreamSeparation', () => {
    test('keeps separate thinking stream in thinking bubble during streaming', () => {
      const result = applyTrustedStreamSeparation({
        rawContent: '',
        rawThinking: 'Let me analyze.\n\n## Summary\n\nDetails here.',
        chunk_type: 'thinking',
        chunk: 'Details here.',
        chunkTime: 20,
        receivedThinkingChunks: true,
        thinkingStartedAt: 10,
      });

      expect(result.content).toBe('');
      expect(result.thinking).toContain('## Summary');
      expect(result.thinking).toContain('Details here.');
      expect(result.isThinking).toBe(true);
      expect(result.receivedThinkingChunks).toBe(true);
    });

    test('sets thinkingEndedAt on first non-empty content chunk', () => {
      const result = applyTrustedStreamSeparation({
        rawContent: 'Final answer.',
        rawThinking: 'Reasoning first.',
        chunk_type: 'content',
        chunk: 'Final answer.',
        chunkTime: 30,
        receivedThinkingChunks: true,
        thinkingStartedAt: 10,
      });

      expect(result.content).toBe('Final answer.');
      expect(result.thinking).toBe('Reasoning first.');
      expect(result.isThinking).toBe(false);
      expect(result.thinkingEndedAt).toBe(30);
      expect(result.firstContentTime).toBe(30);
    });

    test('parses inline think tags when no thinking chunks were received', () => {
      const result = applyTrustedStreamSeparation({
        rawContent: '<think>Inline thought</think>Body text',
        rawThinking: '',
        chunk_type: 'content',
        chunk: 'Body text',
        chunkTime: 40,
      });

      expect(result.thinking).toBe('Inline thought');
      expect(result.content).toBe('Body text');
      expect(result.isThinking).toBe(false);
      expect(result.thinkingEndedAt).toBe(40);
    });

    test('does not leak Chinese reasoning keywords from thinking stream to body', () => {
      const rawThinking = '好的。让我先分析项目结构。还需要检查配置文件。';
      const result = applyTrustedStreamSeparation({
        rawContent: '',
        rawThinking,
        chunk_type: 'thinking',
        chunk: '还需要检查配置文件。',
        chunkTime: 15,
        receivedThinkingChunks: true,
        thinkingStartedAt: 10,
      });

      expect(result.content).toBe('');
      expect(result.thinking).toBe(rawThinking);
      expect(result.isThinking).toBe(true);
    });
  });

  describe('finalizeStreamMessage', () => {
    test('preserves streamed body when finalize would pull it into thinking', () => {
      const result = finalizeStreamMessage({
        rawContent: '以下是说明：\n\n- item',
        rawThinking: '分析过程',
        streamContent: '以下是说明：\n\n- item',
        streamThinking: '分析过程',
        receivedThinkingChunks: true,
      });

      expect(result.content).toContain('以下是说明');
      expect(result.thinking).toBe('分析过程');
    });
  });
});
