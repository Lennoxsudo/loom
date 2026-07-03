import { describe, test, expect } from 'vitest';
import {
  extractThinkingContent,
  smartMergeThinkingAndContent,
  processStreamingThinkingChunk,
  fixThinkingContentSeparation,
  separateMessageState,
  mergeStreamingAndFinalSplit,
  sanitizeSeparateReasoningStream,
  stripStrayThinkTags,
} from '../thinkingExtractor';

describe('thinkingExtractor', () => {
  describe('extractThinkingContent', () => {
    test('should extract thinking content from standard tags', () => {
      const text = `Before thinking.
<thinking>
这是一个思考过程。
我需要考虑这个问题。
</thinking>
这是最终的答案。`;

      const result = extractThinkingContent(text);
      
      expect(result.hasThinkingTag).toBe(true);
      expect(result.thinking).toBe('这是一个思考过程。\n我需要考虑这个问题。');
      expect(result.content).toBe('Before thinking.\n这是最终的答案。');
    });

    test('should extract thinking content with Chinese tags', () => {
      const text = `思考开始。
<think>
这是一个思考过程。
我需要考虑这个问题。
</think>
这是最终的答案。`;

      const result = extractThinkingContent(text);
      
      expect(result.hasThinkingTag).toBe(true);
      expect(result.thinking).toBe('这是一个思考过程。\n我需要考虑这个问题。');
      expect(result.content).toBe('思考开始。\n这是最终的答案。');
    });

    test('should extract final answer from thinking content', () => {
      const text = `<thinking>
让我先分析一下这个问题。
用户想要一个简单的计算器程序。
我需要考虑用户界面和功能。
所以，我将创建一个简单的计算器程序，包含基本的加减乘除功能。
</thinking>`;

      const result = extractThinkingContent(text);
      
      expect(result.hasThinkingTag).toBe(true);
      expect(result.thinking).toBe('让我先分析一下这个问题。\n用户想要一个简单的计算器程序。\n我需要考虑用户界面和功能。');
      expect(result.content).toBe('所以，我将创建一个简单的计算器程序，包含基本的加减乘除功能。');
    });

    test('should handle thinking with answer in the middle', () => {
      const text = `<thinking>
首先，我需要分析这个问题。
用户想要一个简单的计算器程序。
所以，答案是创建一个包含加减乘除功能的计算器。
接下来，我需要设计用户界面。
</thinking>
更多细节说明。`;

      const result = extractThinkingContent(text);
      
      expect(result.hasThinkingTag).toBe(true);
      expect(result.thinking).toBe('首先，我需要分析这个问题。\n用户想要一个简单的计算器程序。\n接下来，我需要设计用户界面。');
      expect(result.content).toBe('所以，答案是创建一个包含加减乘除功能的计算器。\n\n更多细节说明。');
    });

    test('should handle unclosed thinking tags (streaming)', () => {
      const text = `<thinking>
这是一个流式传输中的思考过程。
还没有结束`;

      const result = extractThinkingContent(text);
      
      expect(result.hasThinkingTag).toBe(true);
      expect(result.thinking).toBe('这是一个流式传输中的思考过程。\n还没有结束');
      expect(result.content).toBe('');
    });

    test('should handle text without thinking tags', () => {
      const text = `这是一个普通的回答，没有思考过程。
直接给出答案。`;

      const result = extractThinkingContent(text);
      
      expect(result.hasThinkingTag).toBe(false);
      expect(result.thinking).toBe('');
      expect(result.content).toBe('这是一个普通的回答，没有思考过程。\n直接给出答案。');
    });

    test('should detect answer patterns in thinking', () => {
      const thinking = `首先，让我思考这个问题。
我需要分析用户的需求。
答案是：创建一个简单的计算器程序。
然后，我需要设计界面。`;

      const result = extractThinkingContent(`<thinking>${thinking}</thinking>`);
      
      expect(result.content).toContain('答案是：创建一个简单的计算器程序。');
      expect(result.thinking).not.toContain('答案是：创建一个简单的计算器程序。');
    });

    test('should NOT extract a long English reasoning line with no explicit answer markers as a final answer', () => {
      const text = `<thinking>
Let me understand the project structure better by examining key files.
This is another long thinking line that should definitely stay in the thinking bubble.
</thinking>`;

      const result = extractThinkingContent(text);
      expect(result.thinking).toBe('Let me understand the project structure better by examining key files.\nThis is another long thinking line that should definitely stay in the thinking bubble.');
      expect(result.content).toBe('');
    });

    test('should NOT split on file names or decimals in single-paragraph heuristics', () => {
      const text = `<thinking>Let me look at the key files to understand this project: README.md, package.json, and some of the main source files. We also have 3.14 as pi.</thinking>`;
      const result = extractThinkingContent(text);
      // Since it only has 2 sentences after refined regex split, it should not trigger 2/3 split and keep everything in thinking
      expect(result.thinking).toBe('Let me look at the key files to understand this project: README.md, package.json, and some of the main source files. We also have 3.14 as pi.');
      expect(result.content).toBe('');
    });

    test('should split on inline sentence-starting transition words', () => {
      const text = `<thinking>Let me look at the files. Therefore, the answer is to use npm install.</thinking>`;
      const result = extractThinkingContent(text);
      expect(result.thinking).toBe('Let me look at the files.');
      expect(result.content).toBe('Therefore, the answer is to use npm install.');
    });

    test('should split sentences correctly while ignoring file extensions and decimal numbers', () => {
      const text = `<thinking>I will read README.md. Next, I will check package.json. Then, I will update code version to 2.0. This is the final step.</thinking>`;
      const result = extractThinkingContent(text);
      expect(result.thinking).toBe('I will read README.md. Next, I will check package.json.');
      expect(result.content).toBe('Then, I will update code version to 2.0. This is the final step.');
    });
  });

  describe('smartMergeThinkingAndContent', () => {
    test('should handle empty thinking', () => {
      const text = '这是一个正常的回答。';
      const thinking = '';

      const result = smartMergeThinkingAndContent(text, thinking);
      
      expect(result.finalText).toBe(text);
      expect(result.finalThinking).toBe('');
    });

    test('should extract answer from thinking when text is empty', () => {
      const text = '';
      const thinking = `所以，答案是创建一个计算器。
最后总结一下。`;

      const result = smartMergeThinkingAndContent(text, thinking);
      
      // 当正文为空且思考内容包含答案时，整个思考内容可能会被视为答案
      // 因为思考内容看起来像是答案（以"所以"开头）
      expect(result.finalText).toBe(thinking); // 整个思考内容都被当作答案
      expect(result.finalThinking).toBe('');
    });

    test('should remove text that appears at start of thinking', () => {
      const text = '创建一个计算器程序。';
      const thinking = '创建一个计算器程序。\n这是具体的实现细节。';

      const result = smartMergeThinkingAndContent(text, thinking);
      
      expect(result.finalText).toBe('创建一个计算器程序。');
      expect(result.finalThinking).toBe('这是具体的实现细节。');
    });

    test('should remove text that appears in middle of thinking', () => {
      const text = '计算器程序';
      const thinking = '首先，设计一个计算器程序。\n然后实现功能。';

      const result = smartMergeThinkingAndContent(text, thinking);
      
      // 实现移除了"计算器程序"，但需要处理中文标点
      expect(result.finalText).toBe('计算器程序');
      // 期望结果是"首先，设计一个\n然后实现功能。"（移除了句号）
      expect(result.finalThinking.trim()).toBe('首先，设计一个\n然后实现功能。'.trim());
    });

    test('should handle thinking that looks like answer', () => {
      const text = '';
      const thinking = '所以，答案是创建一个计算器程序。';

      const result = smartMergeThinkingAndContent(text, thinking);
      
      expect(result.finalText).toBe('所以，答案是创建一个计算器程序。');
      expect(result.finalThinking).toBe('');
    });
  });

  describe('processStreamingThinkingChunk', () => {
    test('should extract thinking from chunk with start and end tags', () => {
      const text = '一些内容<thinking>这是思考内容</thinking>更多内容';
      const result = processStreamingThinkingChunk(text, false);
      
      expect(result.isThinking).toBe(false);
      expect(result.extractedContent).toBe('这是思考内容');
      expect(result.remainingText).toBe('一些内容更多内容');
    });

    test('should handle thinking already in progress', () => {
      const text = '继续思考内容</thinking>结束后的内容';
      const result = processStreamingThinkingChunk(text, true);
      
      expect(result.isThinking).toBe(false);
      expect(result.extractedContent).toBe('继续思考内容');
      expect(result.remainingText).toBe('结束后的内容');
    });

    test('should handle thinking without end tag', () => {
      const text = '更多思考内容';
      const result = processStreamingThinkingChunk(text, true);
      
      expect(result.isThinking).toBe(true);
      expect(result.extractedContent).toBe('更多思考内容');
      expect(result.remainingText).toBe('');
    });
  });

  describe('fixThinkingContentSeparation', () => {
    test('should preserve existing thinking field', () => {
      const message = {
        text: '一些内容',
        thinking: '现有的思考内容'
      };

      const result = fixThinkingContentSeparation(message);
      
      expect(result.text).toBe('一些内容');
      expect(result.thinking).toBe('现有的思考内容');
    });

    test('should extract thinking from text when thinking is empty', () => {
      const message = {
        text: '开始。<thinking>思考过程</thinking>结束。',
        thinking: ''
      };

      const result = fixThinkingContentSeparation(message);
      
      expect(result.text).toBe('开始。结束。');
      expect(result.thinking).toBe('思考过程');
    });

    test('should handle complex thinking with answer', () => {
      const message = {
        text: '<thinking>分析问题。\n所以，答案是创建计算器。\n更多细节。</thinking>',
        thinking: ''
      };

      const result = fixThinkingContentSeparation(message);
      
      expect(result.text).toBe('所以，答案是创建计算器。\n更多细节。');
      expect(result.thinking).toBe('分析问题。');
    });
  });

  describe('separateMessageState', () => {
    test('should separate separate thinking stream correctly', () => {
      const inputs = {
        rawContent: 'This is the final answer.',
        rawThinking: 'This is raw reasoning.',
        isStreaming: true,
      };

      const result = separateMessageState(inputs);
      expect(result.text).toBe('This is the final answer.');
      expect(result.thinking).toBe('This is raw reasoning.');
      expect(result.isThinking).toBe(false); // content is not empty, so isThinking should be false
    });

    test('should keep isThinking true during streaming when content is empty in separate stream', () => {
      const inputs = {
        rawContent: '',
        rawThinking: 'Thinking...',
        isStreaming: true,
      };

      const result = separateMessageState(inputs);
      expect(result.text).toBe('');
      expect(result.thinking).toBe('Thinking...');
      expect(result.isThinking).toBe(true);
    });

    test('should parse inline think tags correctly during streaming', () => {
      const inputs = {
        rawContent: '<think>Let me think. I need to run npm install.</think>I will now run it.',
        rawThinking: '',
        isStreaming: true,
      };

      const result = separateMessageState(inputs);
      expect(result.thinking).toBe('Let me think. I need to run npm install.');
      expect(result.text).toBe('I will now run it.');
      expect(result.isThinking).toBe(false);
    });

    test('should parse unclosed inline think tags correctly during streaming', () => {
      const inputs = {
        rawContent: '<think>I am currently thinking about the file.',
        rawThinking: '',
        isStreaming: true,
      };

      const result = separateMessageState(inputs);
      expect(result.thinking).toBe('I am currently thinking about the file.');
      expect(result.text).toBe('');
      expect(result.isThinking).toBe(true);
    });

    test('should resolve split tag boundary correctly', () => {
      const inputs = {
        rawContent: '<think>Let me think.</think>\nHello',
        rawThinking: '',
        isStreaming: true,
      };

      const result = separateMessageState(inputs);
      expect(result.thinking).toBe('Let me think.');
      expect(result.text).toBe('Hello');
      expect(result.isThinking).toBe(false);
    });

    test('should keep separate thinking stream in thinking bubble during streaming', () => {
      const rawThinking = [
        'Let me analyze the codebase structure first.',
        'I need to check package.json and main entry files.',
        '',
        '## Project Summary',
        '',
        'This is a Tauri React application.',
      ].join('\n');

      const streaming = separateMessageState({
        rawContent: '',
        rawThinking,
        isStreaming: true,
      });

      expect(streaming.text).toBe('');
      expect(streaming.thinking).toContain('## Project Summary');
      expect(streaming.thinking).toContain('This is a Tauri React application.');
      expect(streaming.isThinking).toBe(true);
    });

    test('should keep finalize text close to end-of-stream text for separate thinking stream', () => {
      const rawThinking = [
        'Let me inspect the repository layout.',
        '',
        '以下是项目结构说明：',
        '',
        '- src/',
        '- src-tauri/',
      ].join('\n');

      const streaming = separateMessageState({
        rawContent: '',
        rawThinking,
        isStreaming: true,
      });
      const finalized = separateMessageState({
        rawContent: '',
        rawThinking,
        isStreaming: false,
      });
      const merged = mergeStreamingAndFinalSplit(streaming, finalized);

      expect(streaming.text).toBe('');
      expect(merged.text).toBe('');
      expect(merged.thinking).toBe(rawThinking);
    });

    test('should not leak Chinese reasoning paragraphs to body during streaming', () => {
      const rawThinking = '好的。让我先分析项目结构。还需要检查配置文件。';
      const streaming = separateMessageState({
        rawContent: '',
        rawThinking,
        isStreaming: true,
      });

      expect(streaming.text).toBe('');
      expect(streaming.thinking).toBe(rawThinking);
      expect(streaming.isThinking).toBe(true);
    });

    test('should not leak paragraphs starting with 根据 during streaming', () => {
      const rawThinking = ['首先阅读代码。', '', '根据代码结构来看需要修改配置。'].join('\n');
      const streaming = separateMessageState({
        rawContent: '',
        rawThinking,
        isStreaming: true,
      });

      expect(streaming.text).toBe('');
      expect(streaming.thinking).toBe(rawThinking);
      expect(streaming.isThinking).toBe(true);
    });

    test('should merge inline think tags with separate reasoning stream', () => {
      const streaming = separateMessageState({
        rawContent: '<think>tagged thinking',
        rawThinking: 'stream reasoning',
        isStreaming: true,
      });

      expect(streaming.text).toBe('');
      expect(streaming.thinking).toContain('tagged thinking');
      expect(streaming.thinking).toContain('stream reasoning');
      expect(streaming.isThinking).toBe(true);
    });

    test('should split closing think tag leaked into separate reasoning stream', () => {
      const rawThinking = [
        '- bullet one',
        '- bullet two',
        '</thinking>',
        '',
        '你想让我深入了解哪个部分？',
      ].join('\n');
      const rawContent = '我已经仔细阅读了这个项目。';

      const streaming = separateMessageState({
        rawContent,
        rawThinking,
        isStreaming: true,
      });

      expect(streaming.thinking.trim()).toBe('- bullet one\n- bullet two');
      expect(streaming.text).toContain('你想让我深入了解哪个部分？');
      expect(streaming.text).toContain('我已经仔细阅读了这个项目。');
      expect(streaming.isThinking).toBe(false);
    });

    test('should split closing think tag in separate reasoning stream on finalize', () => {
      const rawThinking = '分析过程\n</thinking>\n\n后续提问';
      const result = separateMessageState({
        rawContent: '最终正文',
        rawThinking,
        isStreaming: false,
      });

      expect(result.thinking).toBe('分析过程');
      expect(result.text).toContain('后续提问');
      expect(result.text).toContain('最终正文');
      expect(result.isThinking).toBe(false);
    });
  });

  describe('sanitizeSeparateReasoningStream', () => {
    test('should move trailing text after closing tag into leakedText', () => {
      const result = sanitizeSeparateReasoningStream(
        'reasoning line\n</thinking>\n\nbody leak',
      );
      expect(result.thinking.trim()).toBe('reasoning line');
      expect(result.leakedText).toBe('body leak');
    });

    test('stripStrayThinkTags removes orphan tags without splitting', () => {
      expect(stripStrayThinkTags('hello </thinking> world')).toBe('hello  world');
    });
  });

  describe('mergeStreamingAndFinalSplit', () => {
    test('should preserve streamed body text when finalize pulls it back into thinking', () => {
      const stream = {
        text: '以下是说明：\n\n- item',
        thinking: '分析过程',
      };
      const final = {
        text: '',
        thinking: '分析过程\n\n以下是说明：\n\n- item',
      };

      const merged = mergeStreamingAndFinalSplit(stream, final);
      expect(merged.text).toContain('以下是说明');
      expect(merged.thinking).toBe('分析过程');
    });

    test('should not shrink streamed body text on finalize merge', () => {
      const stream = {
        text: 'Visible answer paragraph.',
        thinking: 'Earlier reasoning.',
      };
      const final = {
        text: '',
        thinking: 'Earlier reasoning.\n\nVisible answer paragraph.',
      };

      const merged = mergeStreamingAndFinalSplit(stream, final);
      expect(merged.text).toBe('Visible answer paragraph.');
      expect(merged.thinking).toBe('Earlier reasoning.');
    });
  });
});
