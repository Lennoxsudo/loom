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

    test('strips inline think tags from body without promoting to thinking bubble', () => {
      const result = applyTrustedStreamSeparation({
        rawContent: '<think>Inline thought</think>Body text',
        rawThinking: '',
        chunk_type: 'content',
        chunk: 'Body text',
        chunkTime: 40,
      });

      expect(result.thinking).toBe('');
      expect(result.content).toBe('Body text');
      expect(result.isThinking).toBe(false);
    });

    test('promotes Gemini <thought> tags into the thinking bubble', () => {
      const result = applyTrustedStreamSeparation({
        rawContent:
          '<thought>\n**Acknowledge User\'s Greeting**\nI registered the greeting.\n</thought>\n你好！有什么可以帮你？',
        rawThinking: '',
        chunk_type: 'content',
        chunk: '你好！有什么可以帮你？',
        chunkTime: 40,
      });

      expect(result.thinking).toContain("Acknowledge User's Greeting");
      expect(result.thinking).toContain('I registered the greeting.');
      expect(result.thinking).not.toContain('<thought>');
      expect(result.content).toBe('你好！有什么可以帮你？');
      expect(result.content).not.toContain('<thought>');
      expect(result.isThinking).toBe(false);
      expect(result.thinkingEndedAt).toBe(40);
    });

    test('does not discard <thought> when native flag is set but rawThinking is empty', () => {
      // Regression: strip-from-body + thinking:'' discarded Gemini thoughts after tag parsing was fixed.
      const result = applyTrustedStreamSeparation({
        rawContent:
          '<thought>\nPlan the greeting.\n</thought>\n\n你好！请问有什么可以帮你？',
        rawThinking: '',
        chunk_type: 'content',
        chunk: '你好！请问有什么可以帮你？',
        chunkTime: 40,
        receivedThinkingChunks: true,
      });

      expect(result.thinking).toBe('Plan the greeting.');
      expect(result.content).toBe('你好！请问有什么可以帮你？');
      expect(result.content).not.toContain('<thought>');
    });

    test('streams unclosed Gemini <thought> into the thinking bubble', () => {
      const result = applyTrustedStreamSeparation({
        rawContent: '<thought>\nStill reasoning…',
        rawThinking: '',
        chunk_type: 'content',
        chunk: 'Still reasoning…',
        chunkTime: 15,
      });

      expect(result.thinking).toContain('Still reasoning…');
      expect(result.content).toBe('');
      expect(result.isThinking).toBe(true);
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

    test('keeps only native reasoning when content also has bilingual <thinking> tags', () => {
      const nativeEnglish =
        "The user is asking 'What kind of person do you think I am?' in Chinese.";
      const contentChinese =
        '<thinking>\n用户在问「你觉得我是什么人」。\n</thinking>\n\n坦白说，我对你几乎一无所知。';
      const result = applyTrustedStreamSeparation({
        rawContent: contentChinese,
        rawThinking: nativeEnglish,
        chunk_type: 'content',
        chunk: '坦白说，我对你几乎一无所知。',
        chunkTime: 50,
        receivedThinkingChunks: true,
        thinkingStartedAt: 10,
      });

      expect(result.thinking).toBe(nativeEnglish);
      expect(result.thinking).not.toContain('用户在问');
      expect(result.content).toBe('坦白说，我对你几乎一无所知。');
      expect(result.content).not.toContain('<thinking>');
    });

    test('keeps a single native segment when </thinking> separates alternate paraphrases', () => {
      const first =
        '用户问我是什么人。这是一个比较开放的问题，我需要基于我观察到的信息来回答。';
      const second =
        '用户问我“你觉得我是什么人”。这是一个比较主观的问题。让我看看我能从当前环境中获取什么信息。';
      const rawThinking = `${first}\n</thinking>\n\n${second}`;
      const result = applyTrustedStreamSeparation({
        rawContent: '',
        rawThinking,
        chunk_type: 'thinking',
        chunk: second,
        chunkTime: 25,
        receivedThinkingChunks: true,
        thinkingStartedAt: 10,
      });

      expect(result.content).toBe('');
      expect(result.thinking).not.toContain('</thinking>');
      expect(result.thinking).toBe(second);
      expect(result.thinking).not.toContain(first);
      expect(result.isThinking).toBe(true);
    });

    test('keeps continuation after </thinking> when it is the longer native segment', () => {
      const rawThinking = '短前言。\n</thinking>\n\n这里是更完整的原生思考续写，应当保留。';
      const result = applyTrustedStreamSeparation({
        rawContent: '',
        rawThinking,
        chunk_type: 'thinking',
        chunk: '这里是更完整的原生思考续写，应当保留。',
        chunkTime: 25,
        receivedThinkingChunks: true,
        thinkingStartedAt: 10,
      });

      expect(result.content).toBe('');
      expect(result.thinking).toBe('这里是更完整的原生思考续写，应当保留。');
      expect(result.thinking).not.toContain('短前言');
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

    test('finalize with native reasoning ignores bilingual content <thinking> tags', () => {
      const nativeEnglish = 'The user asked who I think they are.';
      const result = finalizeStreamMessage({
        rawContent:
          '<thinking>\n用户在问我是什么人。\n</thinking>\n\n坦白说，我对你几乎一无所知。',
        rawThinking: nativeEnglish,
        streamContent: '坦白说，我对你几乎一无所知。',
        streamThinking: nativeEnglish,
        receivedThinkingChunks: true,
      });

      expect(result.thinking).toBe(nativeEnglish);
      expect(result.thinking).not.toContain('用户在问');
      expect(result.content).toBe('坦白说，我对你几乎一无所知。');
    });

    test('finalize promotes Gemini <thought> tags without native reasoning stream', () => {
      const result = finalizeStreamMessage({
        rawContent:
          '<thought>\nPlan the greeting.\n</thought>\n\n你好！请问有什么可以帮你？',
        rawThinking: '',
        streamContent:
          '<thought>\nPlan the greeting.\n</thought>\n\n你好！请问有什么可以帮你？',
        streamThinking: '',
        receivedThinkingChunks: false,
      });

      expect(result.thinking).toBe('Plan the greeting.');
      expect(result.content).toBe('你好！请问有什么可以帮你？');
    });

    test('finalize does not discard <thought> when receivedThinkingChunks is true but thinking empty', () => {
      const result = finalizeStreamMessage({
        rawContent:
          '<thought>\nPlan the greeting.\n</thought>\n\n你好！请问有什么可以帮你？',
        rawThinking: '',
        streamContent:
          '<thought>\nPlan the greeting.\n</thought>\n\n你好！请问有什么可以帮你？',
        streamThinking: '',
        receivedThinkingChunks: true,
      });

      expect(result.thinking).toBe('Plan the greeting.');
      expect(result.content).toBe('你好！请问有什么可以帮你？');
    });

    test('finalize does not concatenate divergent native thinking paraphrases', () => {
      const streamed = '用户问我是什么人。这是一个比较开放的问题。';
      const raw =
        '用户问我“你觉得我是什么人”。这是一个比较主观的问题。让我看看环境信息。';
      const result = finalizeStreamMessage({
        rawContent: '坦白说，我对你几乎一无所知。',
        rawThinking: raw,
        streamContent: '坦白说，我对你几乎一无所知。',
        streamThinking: streamed,
        receivedThinkingChunks: true,
      });

      expect(result.thinking).toBe(raw);
      expect(result.thinking).not.toContain(streamed);
    });
  });
});
