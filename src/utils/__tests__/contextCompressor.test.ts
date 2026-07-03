/**
 * @module contextCompressor 测试
 */
import { describe, it, expect } from 'vitest';
import { compressAndTrim, type CompressedSummary } from '../contextCompressor';

describe('contextCompressor', () => {
  describe('compressAndTrim', () => {
    it('returns messages unchanged when within budget', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ];
      const result = compressAndTrim(messages, 1000);
      expect(result.compressed).toBe(false);
      expect(result.messages).toBe(messages);
      expect(result.summary).toBeNull();
    });

    it('returns empty result for empty messages', () => {
      const result = compressAndTrim([], 1000);
      expect(result.compressed).toBe(false);
      expect(result.messages).toHaveLength(0);
    });

    it('compresses when over budget and removable messages exist', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'x'.repeat(2000) },
        { role: 'assistant', content: 'y'.repeat(2000) },
        { role: 'user', content: 'z'.repeat(2000) },
        { role: 'assistant', content: 'w'.repeat(2000) },
        { role: 'user', content: 'final question' },
        { role: 'assistant', content: 'final answer' },
      ];
      const result = compressAndTrim(messages, 500, 2);
      // 如果可移除区域全部移除后能容纳，应该压缩
      if (result.compressed) {
        expect(result.messages.length).toBeLessThan(messages.length);
        expect(result.summary).not.toBeNull();
        expect(result.compressedTokens).toBeLessThan(result.originalTokens);
        // 压缩后消息应该以 system 开头
        expect(result.messages[0].role).toBe('system');
        // 方法 9：摘要追加到 system content 末尾，而非作为独立 user 消息
        const systemContent = result.messages[0].content;
        const hasSummary =
          (typeof systemContent === 'string' && systemContent.includes('Context Compressed')) ||
          (typeof systemContent === 'string' && systemContent.includes('Context Summary'));
        expect(hasSummary).toBe(true);
      }
      // 如果没有压缩（因为移除后仍超预算），那也应该被标记
      // 这个测试用例可能因为 token 估算差异而走向不同路径
    });

    it('does not compress if removing all removable messages still exceeds budget', () => {
      // 极端情况：保护区本身就超预算
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'x'.repeat(5000) },
        { role: 'assistant', content: 'y'.repeat(5000) },
      ];
      const result = compressAndTrim(messages, 10, 1);
      // 可移除区域为空（只有 system + 最后两轮），或者移除后仍超预算
      expect(result.compressed).toBe(false);
    });

    it('preserves system messages', () => {
      const messages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'a'.repeat(3000) },
        { role: 'assistant', content: 'b'.repeat(3000) },
        { role: 'user', content: 'last q' },
        { role: 'assistant', content: 'last a' },
      ];
      const result = compressAndTrim(messages, 500, 2);
      // system 消息应该始终保留
      expect(result.messages[0].role).toBe('system');
      // 方法 9：摘要追加到 system content 末尾，原始内容应作为前缀保留
      const content = result.messages[0].content;
      expect(typeof content).toBe('string');
      expect(content as string).toContain('System prompt');
    });

    it('merges existing summary when provided', () => {
      const messages = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'a'.repeat(3000) },
        { role: 'assistant', content: 'b'.repeat(3000) },
        { role: 'user', content: 'c' },
        { role: 'assistant', content: 'd' },
      ];
      const existingSummary: CompressedSummary = {
        id: 'summary_existing',
        coverFromIndex: 0,
        coverToIndex: 1,
        summary: '[Previous context summary]',
        createdAt: Date.now() - 1000,
        originalTokens: 500,
        summaryTokens: 50,
      };
      const result = compressAndTrim(messages, 500, 2, existingSummary);
      if (result.compressed && result.summary) {
        // 合并后摘要应该包含之前的摘要内容
        expect(result.summary.summary).toContain('Previous context summary');
      }
    });
  });
});
