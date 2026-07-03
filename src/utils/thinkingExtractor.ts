/**
 * 智能思考气泡内容提取器
 * 
 * 解决AI模型错误地将正文内容放入思考气泡的问题
 */

/**
 * 提取思考标签内的内容
 */
export function extractThinkingContent(text: string, isStreaming?: boolean): {
  thinking: string;
  content: string;
  hasThinkingTag: boolean;
} {
  // Normalize Windows CRLF line endings
  text = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 如果没有思考标签，直接返回
  if (!text.includes('<thinking') && !text.includes('<think') && !text.includes('<think>') && !text.includes('</think>')) {
    return {
      thinking: '',
      content: isStreaming ? text : text.trim(),
      hasThinkingTag: false
    };
  }

  // 尝试匹配标准 <thinking> 标签
  const thinkingRegex = /<thinking[\s\S]*?>([\s\S]*?)<\/thinking>/i;
  const thinkRegex = /<think[\s\S]*?>([\s\S]*?)<\/think>/i;
  
  let thinkingMatch = thinkingRegex.exec(text) || thinkRegex.exec(text);
  
  // 如果没有匹配到标准标签，尝试中文标签
  if (!thinkingMatch) {
    const cnThinkingRegex = /思考开始([\s\S]*?)思考结束/;
    thinkingMatch = cnThinkingRegex.exec(text);
  }
  
  if (thinkingMatch) {
    const thinkingContent = thinkingMatch[1].trim();
    // 移除标签（包括内容）获取剩余的正文，并清理多余的换行符
    let remainingContent = isStreaming ? text.replace(thinkingMatch[0], '') : text.replace(thinkingMatch[0], '').trim();
    remainingContent = remainingContent.replace(/\r\n/g, '\n').replace(/\n\s*\n/g, '\n');
    
    // 首先尝试检测思考内容中是否包含最终答案
    const finalAnswerInThinking = detectFinalAnswerInThinking(thinkingContent);
    
    if (finalAnswerInThinking) {
      // 如果思考内容中包含最终答案，将答案提取到正文，思考内容保留剩余部分
      const thinkingWithoutAnswer = extractThinkingWithoutFinalAnswer(thinkingContent, finalAnswerInThinking);
      return {
        thinking: thinkingWithoutAnswer,
        content: remainingContent ? `${finalAnswerInThinking}\n\n${remainingContent}`.trim() : finalAnswerInThinking,
        hasThinkingTag: true
      };
    }
    
    // 如果思考内容很长（>80字符）且正文为空，尝试识别内部结构
    if (thinkingContent.length > 80 && remainingContent.length === 0) {
      return handleAllContentInThinking(thinkingContent);
    }
    
    return {
      thinking: thinkingContent,
      content: remainingContent,
      hasThinkingTag: true
    };
  }
  
  // 尝试匹配未闭合的思考标签（流式传输中可能未闭合）
  const unclosedThinkingRegex = /<thinking[\s\S]*?>([\s\S]*)/i;
  const unclosedThinkRegex = /<think[\s\S]*?>([\s\S]*)/i;
  const unclosedCnThinkingRegex = /思考开始([\s\S]*)/;
  
  const unclosedMatch = unclosedThinkingRegex.exec(text) || 
                        unclosedThinkRegex.exec(text) ||
                        unclosedCnThinkingRegex.exec(text);
  
  if (unclosedMatch) {
    // 对于未闭合的标签，将所有后续内容都视为思考过程
    return {
      thinking: isStreaming ? unclosedMatch[1] : unclosedMatch[1].trim(),
      content: '',
      hasThinkingTag: true
    };
  }
  
  // 如果无法解析，尝试简单的分隔（某些模型可能使用自定义格式）
  return extractUsingHeuristics(text);
}

/**
 * 检测思考内容中是否包含最终答案
 */
function detectFinalAnswerInThinking(thinking: string): string | null {
  const thinkingLines = thinking.split('\n');
  
  // 查找常见的答案指示符 - 扩展了更多模式
  const answerPatterns = [
    // 明确标识答案的部分
    /(?:^|(?<=[。！？.!?])\s*)(?:所以|因此|综上所述|总结一下|总之|答案是|答案:|结论:|结果:|最终:|最终答案:|最终结果:|回答:|解决方案:|建议:|具体来说:|实际上:|实际上)(?:[\s,，:：]+|$)/i,
    // 以"所以"开头且长度较长的段落
    /(?:^|(?<=[。！？.!?])\s*)所以[^\n]{10,}/i,
    // 包含"答案"或"结果"且不在开头
    /[。！？]\s*(?:答案是|结果是|结论是|所以)[^\n。！？]{5,}/i,
    // 英语答案标记
    /(?:^|(?<=[。！？.!?])\s*)(?:Thus|Therefore|In summary|In conclusion|To sum up|So|The answer is|The solution is|The recommendation is)(?:[\s,，:：]+|$)/i,
  ];
  
  // 从最后一行开始向前查找，因为答案通常在最后
  for (let i = thinkingLines.length - 1; i >= 0; i--) {
    const line = thinkingLines[i].trim();
    if (line.length < 5) continue; // 太短可能不是完整答案
    
    // 检查是否是答案段落
    for (const pattern of answerPatterns) {
      const match = pattern.exec(line);
      if (match) {
        // 从匹配的位置开始提取该行
        let answerPart = line;
        if (typeof match.index === 'number' && match.index > 0) {
          answerPart = line.substring(match.index).replace(/^[。！？；：,.\s]+/, '').trim();
        }
        
        const answerLines = [answerPart];
        const thinkingStartKeywords = /^(?:接下来|现在|思考|让我|我需要|分析|推理|首先|其次|再次)/;
        for (let j = i + 1; j < thinkingLines.length; j++) {
          const nextLine = thinkingLines[j].trim();
          if (thinkingStartKeywords.test(nextLine)) {
            break;
          }
          answerLines.push(thinkingLines[j]);
        }
        return answerLines.join('\n').trim();
      }
    }
    
    // 如果该行包含常见答案结束标记且长度合理
    if (line.includes('答案是') || line.includes('所以') || line.includes('因此') || 
        line.includes('答案：') || line.includes('回答') || line.includes('建议')) {
      const words = line.split(/[，。！？\s]/);
      if (words.length >= 3 && line.length > 10) {
        // 查找这些关键字在行中的位置，从那里开始提取
        let answerPart = line;
        const index = line.search(/(?:答案是|所以|因此|答案：|回答|建议)/);
        if (index > 0) {
          answerPart = line.substring(index).replace(/^[。！？；：,.\s]+/, '').trim();
        }
        
        const answerLines = [answerPart];
        const thinkingStartKeywords = /^(?:接下来|现在|思考|让我|我需要|分析|推理|首先|浅次|再次)/;
        for (let j = i + 1; j < thinkingLines.length; j++) {
          const nextLine = thinkingLines[j].trim();
          if (thinkingStartKeywords.test(nextLine)) {
            break;
          }
          answerLines.push(thinkingLines[j]);
        }
        return answerLines.join('\n').trim();
      }
    }
  }
  
  return null;
}

/**
 * 从思考内容中移除最终答案部分
 */
function extractThinkingWithoutFinalAnswer(thinking: string, finalAnswer: string): string {
  const answerIndex = thinking.lastIndexOf(finalAnswer);
  if (answerIndex !== -1) {
    // 移除答案部分，但保留前后内容（比如答案在思考内容中间的情况）
    const before = thinking.substring(0, answerIndex).trim();
    const after = thinking.substring(answerIndex + finalAnswer.length).trim();
    const remaining = [before, after].filter(Boolean).join('\n').trim();
    if (remaining.replace(/\n\s*\n/g, '\n').trim().length === 0) {
      return '';
    }
    return remaining;
  }
  
  // 如果无法定位，尝试通过模式匹配移除
  const lines = thinking.split('\n');
  const cleanedLines = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) continue;
    
    // 跳过看起来像答案的行
    const isAnswerLine = /^(?:所以|因此|综上所述|总结一下|总之|答案是|答案:|结论:|结果:|最终:|最终答案:|最终结果:|回答:|解决方案:|建议:|具体来说:|实际上:|Thus|Therefore|In summary|In conclusion|To sum up|So|The answer is|The solution is)/i.test(trimmedLine);
    if (!isAnswerLine) {
      cleanedLines.push(line);
    }
  }
  
  return cleanedLines.join('\n').trim();
}

/**
 * 处理所有内容都在思考标签内的情况
 * 这种情况常见于某些AI模型不遵循格式要求
 */
function isStartOfAnswerParagraph(paragraph: string): boolean {
  const trimmed = paragraph.trim();
  if (trimmed.includes('|')) {
    const lines = trimmed.split('\n');
    const hasTableBar = lines.some(line => /^[|:\-\s]+$/.test(line.trim().replace(/[a-zA-Z0-9\u4e00-\u9fff]/g, '')));
    const hasMultipleBars = lines.filter(line => line.includes('|')).length >= 2;
    if (hasTableBar || hasMultipleBars) return true;
  }
  if (trimmed.includes('```')) {
    return true;
  }
  if (trimmed.includes('├──') || trimmed.includes('└──') || (trimmed.includes('│') && trimmed.includes('  '))) {
    return true;
  }
  if (trimmed.startsWith('#')) {
    return true;
  }
  const startKeywords = [
    '\u4ee5\u4e0b\u662f', // 以下是
    '\u5982\u4e0b\u662f', // 如下是
    '\u4fee\u6539\u65b9\u6848', // 修改方案
    '\u5177\u4f53\u5b9e\u73b0', // 具体实现
    '\u9879\u76ee\u7ed3\u6784', // 项目结构
    '\u6280\u672f\u6808', // 技术栈
    '\u6bd4\u5982\uff1a', // 比如：
    'Here are', 'Here is the', 'Below is', 'The solution', 'I will update',
    '\u6211\u5df2', // 我已
    '\u6211\u4eec\u53ef\u4ee5', // 我们可以
    '\u4f60\u53ef\u4ee5', // 你可以
    '\u5efa\u8bae\u5982\u4e0b', // 建议如下
    '\u5177\u4f53\u6b65\u9aa4', // 具体步骤
    '\u6bd4\u5982', // 比如
    '\u8bbe\u8ba1\u65b9\u6848', // 设计方案
    'Now I have', 'Let me', 'I have analyzed', 'Based on', 'Sure, I', 'Certainly,', 'Okay, ',
    '好的，', '没问题', '根据', '首先，我们'
  ];
  if (startKeywords.some(keyword => trimmed.startsWith(keyword))) {
    return true;
  }
  const answerIndicators = [
    '\u6240\u4ee5', // 所以
    '\u56e0\u6b64', // 因此
    '\u7efc\u4e0a\u6240\u8ff0', // 综上所述
    '\u603b\u7ed3', // 总结
    '\u7b54\u6848', // 答案
    '\u7ed3\u8b6a', // 结论
    '\u7ed3\u679c', // 结果
    '\u6700\u7ec8', // 最终
    'Thus',
    'Therefore',
    'In summary',
    'In conclusion',
    'To sum up',
    'So,',
    'The answer is',
    'The solution is',
    'The recommendation is'
  ];
  if (answerIndicators.some(marker => trimmed.startsWith(marker) && trimmed.length > 5)) {
    return true;
  }
  return false;
}

export function hasInlineThinkTags(content: string): boolean {
  return (
    content.includes('<think') ||
    content.includes('<think>') ||
    content.includes('</think>') ||
    content.includes('思考开始')
  );
}

export function parseInlineThinkingFromContent(cleanContent: string): {
  text: string;
  thinking: string;
  hasTags: boolean;
} {
  if (!hasInlineThinkTags(cleanContent)) {
    return { text: cleanContent, thinking: '', hasTags: false };
  }

  const closingTags = [/<\/think(?:ing)?>/i, /<\/redacted_thinking>/i, /思考结束/];
  let closingTagMatch: RegExpMatchArray | null = null;
  for (const pattern of closingTags) {
    const match = cleanContent.match(pattern);
    if (match && (match.index ?? -1) >= 0) {
      if (!closingTagMatch || (match.index ?? 0) < (closingTagMatch.index ?? 0)) {
        closingTagMatch = match;
      }
    }
  }

  if (closingTagMatch) {
    const closingTagIndex = closingTagMatch.index ?? -1;
    let thinking = cleanContent.slice(0, closingTagIndex);
    const text = cleanContent.slice(closingTagIndex + closingTagMatch[0].length).replace(/^\s+/, '');
    thinking = thinking
      .replace(/<think(?:ing)?[\s\S]*?>/gi, '')
      .replace(/思考开始/g, '')
      .trim();
    return { text, thinking, hasTags: true };
  }

  const startTags = ['<thinking>', '<think>', '思考开始'];
  let earliestStartPos = -1;
  let startTagLength = 0;
  for (const tag of startTags) {
    const pos = cleanContent.indexOf(tag);
    if (pos !== -1 && (earliestStartPos === -1 || pos < earliestStartPos)) {
      earliestStartPos = pos;
      startTagLength = tag.length;
    }
  }

  if (earliestStartPos !== -1) {
    const thinking = cleanContent.slice(earliestStartPos + startTagLength);
    const text = cleanContent.slice(0, earliestStartPos);
    return { text, thinking, hasTags: true };
  }

  return { text: cleanContent, thinking: '', hasTags: true };
}

function handleAllContentInThinking(thinking: string): {
  thinking: string;
  content: string;
  hasThinkingTag: boolean;
} {
  // 尝试检测段落分隔
  const paragraphs = thinking.split('\n\n').map(p => p.trim()).filter(p => p.length > 0);
  
  if (paragraphs.length <= 1) {
    // 只有一个段落，尝试在内部寻找答案分隔点
    return splitSingleParagraphThinking(thinking);
  }

  for (let i = 0; i < paragraphs.length; i++) {
    if (isStartOfAnswerParagraph(paragraphs[i])) {
      const thinkingContent = paragraphs.slice(0, i).join('\n\n').trim();
      const content = paragraphs.slice(i).join('\n\n').trim();
      return {
        thinking: thinkingContent,
        content,
        hasThinkingTag: true
      };
    }
  }
  
  // 有多个段落，通常最后一个段落是答案
  const answerIndicators = ['所以', '因此', '综上所述', '总结', '答案', '结论', '结果', '最终'];
  
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const paragraph = paragraphs[i];
    
    // 检查段落是否包含答案标记
    const hasAnswerMarker = answerIndicators.some(marker => 
      paragraph.includes(marker) && paragraph.length > 20
    );
    
    if (hasAnswerMarker && i < paragraphs.length - 1) {
      // 从包含答案标记的段落开始到最后，作为正文内容
      const content = paragraphs.slice(i).join('\n\n').trim();
      const thinkingContent = paragraphs.slice(0, i).join('\n\n').trim();
      
      return {
        thinking: thinkingContent,
        content,
        hasThinkingTag: true
      };
    }
  }
  
  // 如果没有找到明显的答案标记，尝试基于段落长度和结构判断
  // 通常最后一个段落是答案，特别是如果它比前面的段落短
  if (paragraphs.length >= 2) {
    const lastParagraph = paragraphs[paragraphs.length - 1];
    const secondLastParagraph = paragraphs[paragraphs.length - 2];
    
    // 如果最后一个段落相对较短且包含结论性词语
    if (lastParagraph.length < secondLastParagraph.length * 0.7) {
      const thinkingContent = paragraphs.slice(0, -1).join('\n\n').trim();
      const content = lastParagraph.trim();
      
      return {
        thinking: thinkingContent,
        content,
        hasThinkingTag: true
      };
    }
  }
  
  // 如果所有方法都失败，将整个内容作为思考，但标记为空正文
  return {
    thinking,
    content: '',
    hasThinkingTag: true
  };
}

/**
 * 分割单段思考内容
 */
function splitSingleParagraphThinking(thinking: string): {
  thinking: string;
  content: string;
  hasThinkingTag: boolean;
} {
  // 在思考内容中寻找可能的转折点
  const splitPoints = [
    // 中文转折点
    /(?:^|\n|(?<=[。！？.!?])\s*)(?:所以|因此|综上所述|总结一下|总之|答案是|答案:|结论:|结果:|最终:|最终答案:|最终结果:|回答:|解决方案:|建议:|具体来说:|实际上:)(?:[\s,，:：]+|$)/i,
    // 英文转折点
    /(?:^|\n|(?<=[。！？.!?])\s*)(?:Thus|Therefore|In summary|In conclusion|To sum up|So|The answer is|The solution is|The recommendation is)(?:[\s,，:：]+|$)/i,
    // 段落中的明显转折
    /\n\n(?:接下来|现在|那么|但是|然而|因此|所以)/,
  ];
  
  let bestSplitIndex = -1;
  let bestSplitLength = 0;
  
  for (const pattern of splitPoints) {
    const match = pattern.exec(thinking);
    if (match && match.index > 0) {
      // 选择最长的前缀作为思考，以获得更准确的分离
      if (match.index > bestSplitLength) {
        bestSplitIndex = match.index;
        bestSplitLength = match.index;
      }
    }
  }
  
  if (bestSplitIndex > 0) {
    const thinkingPart = thinking.substring(0, bestSplitIndex).trim();
    const contentPart = thinking.substring(bestSplitIndex).trim();
    
    // 确保思考部分不是太短
    if (thinkingPart.length > 20) {
      return {
        thinking: thinkingPart,
        content: contentPart,
        hasThinkingTag: true
      };
    }
  }
  
  // 如果没有找到合适的拆分点，使用启发式方法
  const lines = thinking.split('\n');
  if (lines.length >= 3) {
    // 尝试在最后1/3处拆分
    const splitPoint = Math.floor(lines.length * 2 / 3);
    const thinkingLines = lines.slice(0, splitPoint);
    const contentLines = lines.slice(splitPoint);
    
    return {
      thinking: thinkingLines.join('\n').trim(),
      content: contentLines.join('\n').trim(),
      hasThinkingTag: true
    };
  }
  
  // 如果是单行但很长，尝试按句号/感叹号/问号拆分
  const sentences = thinking.split(/(?<=[。！？])|(?<=[.!?])(?=\s*[\u4e00-\u9fff])|(?<=[.!?])(?=\s+[A-Z])/u);
  if (sentences.length >= 3) {
    const splitPoint = Math.floor(sentences.length * 2 / 3);
    const thinkingSentences = sentences.slice(0, splitPoint);
    const contentSentences = sentences.slice(splitPoint);
    
    return {
      thinking: thinkingSentences.join('').trim(),
      content: contentSentences.join('').trim(),
      hasThinkingTag: true
    };
  }
  
  // 最后的手段：将整个内容作为思考
  return {
    thinking,
    content: '',
    hasThinkingTag: true
  };
}

/**
 * 使用启发式方法提取思考内容（当正则匹配失败时）
 */
function extractUsingHeuristics(text: string): {
  thinking: string;
  content: string;
  hasThinkingTag: boolean;
} {
  // 查找思考开始标记
  const thinkingStartMarkers = [
    '首先', '让我想一想', '让我思考一下', '我需要思考', '考虑一下',
    '让我们来分析', '分析一下', '思考过程', '推理过程', '让我想想',
    '我想一下', '让我考虑', '我需要想想', '思考：', '分析：', '推理：'
  ];
  
  const contentStartMarkers = [
    '所以', '因此', '综上所述', '总结一下', '总之', '答案是',
    '结论是', '结果是', '最终答案是', '最终结果是', '回答是',
    '解决方案是', '建议是', '答案是：', '结论是：', '结果是：'
  ];
  
  // 尝试找到思考部分的开始
  let thinkingStart = -1;
  for (const marker of thinkingStartMarkers) {
    const index = text.indexOf(marker);
    if (index !== -1 && (thinkingStart === -1 || index < thinkingStart)) {
      thinkingStart = index;
    }
  }
  
  // 尝试找到正文部分的开始
  let contentStart = -1;
  for (const marker of contentStartMarkers) {
    const index = text.indexOf(marker);
    if (index !== -1 && (contentStart === -1 || index < contentStart)) {
      contentStart = index;
    }
  }
  
  if (thinkingStart !== -1 && contentStart !== -1 && contentStart > thinkingStart) {
    // 有明显的思考-正文结构
    const thinking = text.substring(thinkingStart, contentStart).trim();
    const content = text.substring(contentStart).trim();
    
    return {
      thinking,
      content,
      hasThinkingTag: false
    };
  } else if (thinkingStart !== -1 && contentStart === -1) {
    // 只有思考部分
    const thinking = text.substring(thinkingStart).trim();
    const content = thinkingStart > 0 ? text.substring(0, thinkingStart).trim() : '';
    
    return {
      thinking,
      content,
      hasThinkingTag: false
    };
  }
  
  // 无法区分，将所有内容作为正文
  return {
    thinking: '',
    content: text.trim(),
    hasThinkingTag: false
  };
}

/**
 * 处理流式消息中的思考标签
 * 返回：{ isThinking: boolean, extractedContent: string, remainingText: string }
 */
export function processStreamingThinkingChunk(
  text: string,
  isCurrentlyInThinking: boolean
): {
  isThinking: boolean;
  extractedContent: string;
  remainingText: string;
} {
  // Normalize Windows CRLF line endings
  text = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (isCurrentlyInThinking) {
    // 当前在思考标签内，查找结束标签
    const endTags = ['</thinking>', '</think>', '思考结束'];
    let earliestEndPos = -1;
    let endTagLength = 0;
    
    for (const tag of endTags) {
      const pos = text.indexOf(tag);
      if (pos !== -1 && (earliestEndPos === -1 || pos < earliestEndPos)) {
        earliestEndPos = pos;
        endTagLength = tag.length;
      }
    }
    
    if (earliestEndPos !== -1) {
      // 找到结束标签
      const thinkingContent = text.substring(0, earliestEndPos);
      const remainingText = text.substring(earliestEndPos + endTagLength);
      
      return {
        isThinking: false, // 思考结束
        extractedContent: thinkingContent,
        remainingText: remainingText.replace(/^\s+/, '')
      };
    }
    
    // 未找到结束标签，全部内容仍在思考中
    return {
      isThinking: true,
      extractedContent: text,
      remainingText: ''
    };
  } else {
    // 不在思考中，查找开始标签
    const startTags = ['<thinking>', '<think>', '思考开始'];
    let earliestStartPos = -1;
    let startTagLength = 0;
    
    for (const tag of startTags) {
      const pos = text.indexOf(tag);
      if (pos !== -1 && (earliestStartPos === -1 || pos < earliestStartPos)) {
        earliestStartPos = pos;
        startTagLength = tag.length;
      }
    }
    
    if (earliestStartPos !== -1) {
      // 找到开始标签
      const contentBeforeThinking = text.substring(0, earliestStartPos);
      const afterTag = text.substring(earliestStartPos + startTagLength);
      
      // 递归处理标签后的内容
      const result = processStreamingThinkingChunk(afterTag, true);
      
      return {
        isThinking: result.isThinking,
        extractedContent: result.extractedContent,
        remainingText: contentBeforeThinking + result.remainingText
      };
    }
    
    // 没有思考标签，所有内容都是正文
    return {
      isThinking: false,
      extractedContent: '',
      remainingText: text
    };
  }
}

/**
 * 修复消息中的思考-正文分离问题
 * 用于在消息接收后统一处理
 */
export function fixThinkingContentSeparation(message: {
  text: string;
  thinking?: string;
  isStreaming?: boolean;
  hasToolCalls?: boolean;
}): {
  text: string;
  thinking: string;
} {
  const normalizedText = (message.text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const normalizedThinking = (message.thinking || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const isStreaming = message.isStreaming;
  
  // 如果已经有思考内容，则信任现有分离
  if (normalizedThinking && normalizedThinking.trim().length > 0) {
    return {
      text: isStreaming ? normalizedText : normalizedText.trim(),
      thinking: isStreaming ? normalizedThinking : normalizedThinking.trim()
    };
  }
  
  // 否则尝试从text中提取
  const extracted = extractThinkingContent(normalizedText, isStreaming);
  
  return {
    text: extracted.content,
    thinking: extracted.thinking || normalizedThinking
  };
}

/**
 * 智能合并思考内容和正文
 * 当某些模型错误地将所有内容放入思考标签时，尝试重新分配
 */
export function smartMergeThinkingAndContent(text: string, thinking?: string, hasToolCalls?: boolean): {
  finalText: string;
  finalThinking: string;
} {
  // 如果没有思考内容，直接返回
  if (!thinking || thinking.trim().length === 0) {
    return {
      finalText: text.trim(),
      finalThinking: ''
    };
  }
  
  const trimmedText = text.trim();
  const trimmedThinking = thinking.trim();
  
  // 如果正文为空且没有工具调用，尝试从思考内容中提取可能混入的答案
  if (trimmedText.length === 0 && !hasToolCalls) {
    const finalAnswerInThinking = detectFinalAnswerInThinking(trimmedThinking);
    if (finalAnswerInThinking) {
      const thinkingWithoutAnswer = extractThinkingWithoutFinalAnswer(trimmedThinking, finalAnswerInThinking);
      return {
        finalText: finalAnswerInThinking,
        finalThinking: thinkingWithoutAnswer
      };
    }
    
    if (trimmedThinking.length > 50) {
      const extracted = extractThinkingContent(`<thinking>${trimmedThinking}</thinking>`);
      if (extracted.content && extracted.content.length > 0) {
        return {
          finalText: extracted.content,
          finalThinking: extracted.thinking
        };
      }
      
      const handled = handleAllContentInThinking(trimmedThinking);
      if (handled.content && handled.content.length > 0) {
        return {
          finalText: handled.content,
          finalThinking: handled.thinking
        };
      }
    }
  }
  
  // 如果思考内容和正文有重叠，优化处理
  if (trimmedText.length > 0 && trimmedThinking.length > 0) {
    // 检查思考内容是否以正文开头（常见错误模式）
    if (trimmedThinking.startsWith(trimmedText)) {
      const remainingThinking = trimmedThinking.substring(trimmedText.length).trim();
      // 清理开头的标点和空格
      const cleanedRemaining = remainingThinking.replace(/^[，。！？、\s]+/, '').trim();
      return {
        finalText: trimmedText,
        finalThinking: cleanedRemaining
      };
    }
    
    // 检查思考内容是否包含正文
    const thinkingIndex = trimmedThinking.indexOf(trimmedText);
    if (thinkingIndex !== -1) {
      const beforeText = trimmedThinking.substring(0, thinkingIndex).trim();
      const afterText = trimmedThinking.substring(thinkingIndex + trimmedText.length).trim();
      
      // 清理前后文本，移除多余的空格和标点
      const cleanBefore = beforeText.replace(/[，。！？、\s]+$/, '').trim();
      const cleanAfter = afterText.replace(/^[，。！？、\s]+/, '').trim();
      
      // 将重复的正文从思考中移除
      if (cleanBefore && cleanAfter) {
        return {
          finalText: trimmedText,
          finalThinking: cleanBefore + '\n' + cleanAfter
        };
      } else if (cleanBefore) {
        return {
          finalText: trimmedText,
          finalThinking: cleanBefore
        };
      } else if (cleanAfter) {
        return {
          finalText: trimmedText,
          finalThinking: cleanAfter
        };
      } else {
        return {
          finalText: trimmedText,
          finalThinking: ''
        };
      }
    }
    
    // 检查正文是否以思考内容开头（另一种常见错误模式）
    if (trimmedText.startsWith(trimmedThinking)) {
      const remainingText = trimmedText.substring(trimmedThinking.length).trim();
      const cleanedRemaining = remainingText.replace(/^[，。！？、\s]+/, '').trim();
      return {
        finalText: cleanedRemaining,
        finalThinking: trimmedThinking
      };
    }
  }
  
  // 如果思考内容看起来像是答案，而不是真正的思考过程
  const looksLikeAnswer = /^(?:所以|因此|综上所述|总结一下|总之|答案是|答案:|结论:|结果:|最终:|最终答案:|最终结果:|回答:|解决方案:|建议:|Thus|Therefore|In summary|In conclusion|To sum up|So|The answer is|The solution is)/i.test(trimmedThinking);
  if (looksLikeAnswer && trimmedText.length === 0) {
    return {
      finalText: trimmedThinking,
      finalThinking: ''
    };
  }
  
  // 如果思考内容很长但正文很长，可能思考被误放
  if (trimmedThinking.length < 30 && trimmedText.length > 50) {
    // 检查思考内容是否看起来像是正文的一部分
    const isTextContainsThinking = trimmedText.includes(trimmedThinking);
    const isThinkingStartMarker = /^(?:首先|让我|我需要|考虑|分析)/i.test(trimmedThinking);
    
    if (isTextContainsThinking && !isThinkingStartMarker) {
      // 思考内容可能是误放的实际答案部分
      return {
        finalText: trimmedText,
        finalThinking: ''
      };
    }
  }
  
  return {
    finalText: trimmedText,
    finalThinking: trimmedThinking
  };
}

/**
 * 增强版的消息处理函数，专门解决正文被放入思考气泡的问题
 */
function normalizeThinkTagArtifacts(message: {
  text: string;
  thinking?: string;
  isStreaming?: boolean;
  hasToolCalls?: boolean;
}): {
  text: string;
  thinking: string;
  normalized: boolean;
} {
  const isStreaming = message.isStreaming;
  const existingThinking = isStreaming
    ? (message.thinking ?? '')
    : (message.thinking ?? '').trim();
  let nextText = message.text;
  let nextThinking = existingThinking;
  let normalized = false;

  // 1. Process closing tags (English and Chinese)
  const closingTags = [/<\/think(?:ing)?>/i, /思考结束/];
  let closingTagMatch: RegExpMatchArray | null = null;
  let matchedTagPattern: RegExp | null = null;
  
  for (const pattern of closingTags) {
    const match = nextText.match(pattern);
    if (match && (match.index ?? -1) >= 0) {
      if (!closingTagMatch || (match.index ?? 0) < (closingTagMatch.index ?? 0)) {
        closingTagMatch = match;
        matchedTagPattern = pattern;
      }
    }
  }

  if (closingTagMatch && matchedTagPattern) {
    const closingTagIndex = closingTagMatch.index ?? -1;
    if (closingTagIndex >= 0) {
      let leakedThinking = nextText.slice(0, closingTagIndex);
      leakedThinking = isStreaming ? leakedThinking : leakedThinking.trim();
      const answerText = nextText
        .slice(closingTagIndex + closingTagMatch[0].length);
      const finalAnswerText = answerText.replace(/^\s+/, '');

      // Clean start tags from leaked thinking
      leakedThinking = leakedThinking
        .replace(/<think(?:ing)?[\s\S]*?>/gi, '')
        .replace(/思考开始/g, '');
      leakedThinking = isStreaming ? leakedThinking : leakedThinking.trim();

      if (leakedThinking.length > 0) {
        nextThinking = nextThinking
          ? (isStreaming ? `${nextThinking}\n${leakedThinking}` : `${nextThinking}\n${leakedThinking}`.trim())
          : leakedThinking;
      }

      nextText = finalAnswerText;
      normalized = true;
    }
  }

  // 2. Process unclosed start tags (English and Chinese) when there is no closing tag
  if (!closingTagMatch) {
    const unclosedPatterns = [
      { regex: /<think(?:ing)?[\s\S]*?>([\s\S]*)$/i, tag: '<think' },
      { regex: /思考开始([\s\S]*)$/, tag: '思考开始' }
    ];
    
    for (const item of unclosedPatterns) {
      const match = nextText.match(item.regex);
      if (match) {
        const startTagIndex = nextText.toLowerCase().indexOf(item.tag.toLowerCase());
        if (startTagIndex >= 0) {
          const leakedThinking = isStreaming ? match[1] : match[1].trim();
          const beforeText = isStreaming ? nextText.slice(0, startTagIndex) : nextText.slice(0, startTagIndex).trim();

          if (leakedThinking.length > 0) {
            nextThinking = nextThinking
              ? (isStreaming ? `${nextThinking}\n${leakedThinking}` : `${nextThinking}\n${leakedThinking}`.trim())
              : leakedThinking;
          }
          nextText = beforeText;
          normalized = true;
          break;
        }
      }
    }
  }

  // 3. Strip any leftover/stray tags
  const strippedText = nextText
    .replace(/<\/think(?:ing)?>/gi, '')
    .replace(/<think(?:ing)?[\s\S]*?>/gi, '')
    .replace(/思考开始/g, '')
    .replace(/思考结束/g, '');

  const finalStrippedText = isStreaming ? strippedText : strippedText.trim();

  if (finalStrippedText !== nextText) {
    nextText = finalStrippedText;
    normalized = true;
  }

  return {
    text: nextText,
    thinking: nextThinking,
    normalized,
  };
}

/**
 * @deprecated Render layers must trust `message.content` / `message.thinking` from the data layer.
 * Separation belongs in `streamChunkSeparation.ts` (and `separateMessageState` for finalize).
 */
function enhanceMessageSeparation(message: {
  text: string;
  thinking?: string;
  isStreaming?: boolean;
  hasToolCalls?: boolean;
  trustBackendSplit?: boolean;
}): {
  text: string;
  thinking: string;
  separationIssueFixed: boolean;
  isThinking?: boolean;
} {
  const normalizedText = (message.text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const normalizedThinking = (message.thinking || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const cleanMessage = { ...message, text: normalizedText, thinking: normalizedThinking };

  const normalizedMessage = normalizeThinkTagArtifacts(cleanMessage);
  const originalText = cleanMessage.text;

  // Check if we are currently in thinking mode (unclosed tag exists)
  const isThinking = 
    (cleanMessage.text.toLowerCase().includes('<think') || cleanMessage.text.includes('思考开始')) &&
    !cleanMessage.text.toLowerCase().includes('</think') &&
    !cleanMessage.text.includes('思考结束');

  // 如果正处于流式生成状态，只运行标准的分离修复（基于显式的标签）
  // 绝对不要在此阶段运行任何猜测/启发式算法，避免流式生成的文字被提早切分
  if (cleanMessage.isStreaming) {
    const fixed = fixThinkingContentSeparation({
      text: normalizedMessage.text,
      thinking: normalizedMessage.thinking,
      isStreaming: true,
      hasToolCalls: cleanMessage.hasToolCalls
    });
    return {
      text: fixed.text,
      thinking: fixed.thinking,
      separationIssueFixed: normalizedMessage.normalized,
      isThinking: isThinking || (cleanMessage.thinking ? !cleanMessage.thinking.includes('</think') && !cleanMessage.thinking.includes('思考结束') : false)
    };
  }

  // 首先尝试标准的分离修复
  const fixed = fixThinkingContentSeparation(normalizedMessage);
  
  // 检查是否存在分离问题（如果是工具调用导致的正文为空，则不视为分离问题）
  const hasSeparationIssue = 
    !cleanMessage.hasToolCalls &&
    (originalText.includes('<thinking>') || originalText.includes('<think') || originalText.includes('思考开始')) &&
    fixed.text.length === 0 &&
    fixed.thinking.length > 0;
  
  // 如果存在分离问题，使用增强算法
  const separationIssueFixed = normalizedMessage.normalized;

  if (!cleanMessage.trustBackendSplit && hasSeparationIssue) {
    const enhanced = extractThinkingContent(`<thinking>${fixed.thinking}</thinking>`);
    
    if (enhanced.content && enhanced.content.length > 0) {
      return {
        text: enhanced.content,
        thinking: enhanced.thinking,
        separationIssueFixed: true,
        isThinking: false
      };
    }
  }

  // 如果思考内容不为空，尝试智能合并
  if (!cleanMessage.trustBackendSplit && fixed.thinking.length > 0) {
    const merged = smartMergeThinkingAndContent(fixed.text, fixed.thinking, cleanMessage.hasToolCalls);
    
    // 如果合并改变了内容，说明有重复
    if (merged.finalText !== fixed.text || merged.finalThinking !== fixed.thinking) {
      return {
        text: merged.finalText,
        thinking: merged.finalThinking,
        separationIssueFixed: true,
        isThinking: false
      };
    }
  }
  
  return {
    text: fixed.text,
    thinking: fixed.thinking,
    separationIssueFixed,
    isThinking: false
  };
}

function splitThinkingSuffix(thinking: string, nextTextNonEmpty: boolean): {
  thinking: string;
  leakedText: string;
} {
  const trimmedThinking = thinking.trim();
  if (!trimmedThinking) {
    return {
      thinking: '',
      leakedText: '',
    };
  }

  const explicitKeywordsPattern = /(?:已在|已将|已完成|我已|下面|以下|修改内容如下|具体如下|操作结果|测试结果|更新任务|创建任务|删除任务|Here(?:'s| is)|The updated|The change|I updated|Updated|Added)/i;

  const splitPatterns = nextTextNonEmpty
    ? [
        // Safe patterns: must match explicit conclusion keywords (allowing optional formatting)
        new RegExp("(?<=[.?!。！？])\\s*(?=[*\\`#\\s]*" + explicitKeywordsPattern.source + ")", 'i'),
        new RegExp("\\n{2,}(?=[*\\`#\\s]*" + explicitKeywordsPattern.source + ")", 'i'),
      ]
    : [
        // Aggressive patterns: used when nextText is empty to extract final answer maximally
        /(?<=[.?!。！？])\s*(?=[\u4e00-\u9fff])/u,
        /(?<=[.?!。！？])\s*(?=(?:```|`|[*#>|-]{1,3}|✅|❌|⚠️|✔|✘|\|)|(?:已在|已将|已完成|我已|下面|以下|修改内容如下|具体如下|操作结果|测试结果|更新任务|创建任务|删除任务|Here(?:'s| is)|The updated|The change|I updated|Updated|Added))/i,
        /\n{2,}(?=(?:```|`|[*#>|-]{1,3}|✅|❌|⚠️|✔|✘|\|)|(?:已在|已将|已完成|我已|下面|以下|修改内容如下|具体如下|操作结果|测试结果|更新任务|创建任务|删除任务))/i,
        /\s+(?=```(?:diff|ts|tsx|js|jsx|json|md)?)/i,
      ];

  let splitIndex = -1;
  for (const pattern of splitPatterns) {
    const match = pattern.exec(trimmedThinking);
    if (match && typeof match.index === 'number') {
      splitIndex = match.index;
      break;
    }
  }

  if (splitIndex <= 0) {
    return {
      thinking: trimmedThinking,
      leakedText: '',
    };
  }

  return {
    thinking: trimmedThinking.slice(0, splitIndex).trim(),
    leakedText: trimmedThinking.slice(splitIndex).trim(),
  };
}

export function mergeDistinctTextSegments(prefixText: string, existingText: string): string {
  const prefix = prefixText.trim();
  const existing = existingText.trim();

  if (!prefix) return existing;
  if (!existing) return prefix;
  if (existing.includes(prefix)) return existing;
  if (prefix.includes(existing)) return prefix;

  return `${prefix}\n\n${existing}`.trim();
}

const CLOSING_THINK_TAG_LITERALS = [
  '</thinking>',
  '</think>',
  '</think>',
  '思考结束',
] as const;

/**
 * Remove stray think-tag artifacts from display text (does not split at closing tags).
 */
export function stripStrayThinkTags(text: string, options?: { trim?: boolean }): string {
  const stripped = (text || '')
    .replace(/<\/think(?:ing)?>/gi, '')
    .replace(/<\/redacted_thinking>/gi, '')
    .replace(/<think(?:ing)?[\s\S]*?>/gi, '')
    .replace(/<think>/gi, '')
    .replace(/思考开始/g, '')
    .replace(/思考结束/g, '');
  return options?.trim === false ? stripped : stripped.trim();
}

/**
 * Some providers emit `</thinking>` inside the separate reasoning stream instead of
 * ending the stream. Split there and move trailing text into the body.
 */
export function sanitizeSeparateReasoningStream(rawThinking: string): {
  thinking: string;
  leakedText: string;
} {
  const normalized = (rawThinking || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.trim()) {
    return { thinking: '', leakedText: '' };
  }

  let earliestIndex = -1;
  let tagLength = 0;

  for (const tag of CLOSING_THINK_TAG_LITERALS) {
    const pos = tag.startsWith('<')
      ? normalized.toLowerCase().indexOf(tag.toLowerCase())
      : normalized.indexOf(tag);
    if (
      pos !== -1 &&
      (earliestIndex === -1 || pos < earliestIndex || (pos === earliestIndex && tag.length > tagLength))
    ) {
      earliestIndex = pos;
      tagLength = tag.length;
    }
  }

  let thinking = normalized;
  let leakedText = '';

  if (earliestIndex !== -1) {
    thinking = normalized.slice(0, earliestIndex);
    leakedText = normalized.slice(earliestIndex + tagLength).trim();
  }

  thinking = stripStrayThinkTags(thinking, { trim: false });

  return { thinking, leakedText };
}

function applySeparateReasoningSanitization(
  thinking: string,
  text: string,
): { thinking: string; text: string } {
  const sanitized = sanitizeSeparateReasoningStream(thinking);
  return {
    thinking: sanitized.thinking,
    text: sanitized.leakedText
      ? mergeDistinctTextSegments(sanitized.leakedText, text)
      : text,
  };
}

/**
 * @deprecated Do not call from UI render paths. Use data-layer fields directly for display.
 */
function separateThinkingForDisplay(message: {
  text: string;
  thinking?: string;
  isStreaming?: boolean;
  hasToolCalls?: boolean;
  trustBackendSplit?: boolean;
}): {
  text: string;
  thinking: string;
  separationIssueFixed: boolean;
} {
  // Normalize Windows CRLF line endings
  const normalizedText = (message.text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const normalizedThinking = (message.thinking || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const cleanMessage = { ...message, text: normalizedText, thinking: normalizedThinking };

  const enhanced = enhanceMessageSeparation(cleanMessage);
  let nextText = enhanced.text.trim();
  let nextThinking = enhanced.thinking.trim();
  let separationIssueFixed = enhanced.separationIssueFixed;

  if (!nextThinking) {
    return {
      text: nextText,
      thinking: '',
      separationIssueFixed,
    };
  }

  // 如果正在流式传输，则不要在此做任何启发式的后缀拆分或全文段落猜测，防止破坏流式生成的完整连贯性
  if (cleanMessage.isStreaming) {
    return {
      text: nextText,
      thinking: nextThinking,
      separationIssueFixed,
    };
  }

  // 如果 nextText 已经有内容，说明在流式输出中或者通过标签已经完美分离开来。
  // 在这种情况下，我们不需要跑任何启发式段落拆分，避免破坏思考过程本身的结构（比如里面的代码块或列表）。
  if (
    !cleanMessage.trustBackendSplit &&
    !nextText &&
    nextThinking.length > 50 &&
    !cleanMessage.hasToolCalls
  ) {
    const handled = handleAllContentInThinking(nextThinking);
    if (handled.content && handled.content.length > 0) {
      nextText = handled.content;
      nextThinking = handled.thinking;
      separationIssueFixed = true;
    }
  }

  // 尝试使用 splitThinkingSuffix 寻找最末尾的答案后缀。
  // 如果 nextText 已经非空，我们启用 Safe 模式只提取以明确结论关键字开头的 leakedText，防止误切分 valid lists/code blocks。
  if (!cleanMessage.trustBackendSplit && !cleanMessage.hasToolCalls) {
    const split = splitThinkingSuffix(nextThinking, nextText.length > 0);
    if (split.leakedText) {
      nextThinking = split.thinking;
      nextText = mergeDistinctTextSegments(split.leakedText, nextText);
      separationIssueFixed = true;
    }
  }

  if (nextText && nextThinking) {
    const merged = smartMergeThinkingAndContent(nextText, nextThinking, cleanMessage.hasToolCalls);
    if (merged.finalText !== nextText || merged.finalThinking !== nextThinking) {
      nextText = merged.finalText;
      nextThinking = merged.finalThinking;
      separationIssueFixed = true;
    }
  }

  return {
    text: nextText,
    thinking: nextThinking,
    separationIssueFixed,
  };
}

/**
 * 完成落库时合并流式末态与最终分离结果，防止已展示正文被收回思考气泡。
 */
export function mergeStreamingAndFinalSplit(
  stream: { text: string; thinking: string },
  final: { text: string; thinking: string },
): { text: string; thinking: string } {
  const streamText = (stream.text || '').trim();
  const streamThinking = (stream.thinking || '').trim();
  let nextText = (final.text || '').trim();
  let nextThinking = (final.thinking || '').trim();

  if (!streamText && !streamThinking) {
    return { text: nextText, thinking: nextThinking };
  }

  // Monotonic: streamed body text is never moved back into thinking.
  if (streamText) {
    if (!nextText) {
      nextText = streamText;
    } else if (streamText.includes(nextText)) {
      nextText = streamText;
    } else if (!nextText.includes(streamText)) {
      nextText = mergeDistinctTextSegments(streamText, nextText);
    }

    if (nextThinking.includes(streamText)) {
      const withoutBody = nextThinking.replace(streamText, '').replace(/\n{3,}/g, '\n\n').trim();
      nextThinking = streamThinking || withoutBody;
    } else if (streamThinking && !nextThinking) {
      nextThinking = streamThinking;
    }
  } else if (!nextThinking && streamThinking) {
    nextThinking = streamThinking;
  }

  if (streamThinking) {
    if (!nextThinking) {
      nextThinking = streamThinking;
    } else if (streamThinking.includes(nextThinking)) {
      nextThinking = streamThinking;
    } else if (!nextThinking.includes(streamThinking)) {
      nextThinking = mergeDistinctTextSegments(streamThinking, nextThinking);
    }
  }

  // Never let finalize shrink streamed body below what was already shown.
  if (streamText && nextText.length < streamText.length && streamText.includes(nextText)) {
    nextText = streamText;
  }

  return { text: nextText, thinking: nextThinking };
}

/**
 * 统一的气泡回复消息状态切分函数
 * 处理并分离原始的内容流（rawContent）和原始的思考流（rawThinking）
 */
export function separateMessageState(inputs: {
  rawContent: string;
  rawThinking: string;
  isStreaming: boolean;
}): {
  text: string;
  thinking: string;
  isThinking: boolean;
} {
  const { rawContent, rawThinking, isStreaming } = inputs;
  
  // 统一规格化换行符
  const cleanContent = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const cleanThinking = rawThinking.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // 情况 1: 后端使用了独立的思考流（如 DeepSeek/Claude 3.7 在特定接口下的 reasoning 独立推送）
  if (cleanThinking.length > 0) {
    let mergedText = cleanContent;
    let mergedThinking = cleanThinking;

    if (hasInlineThinkTags(cleanContent)) {
      const inline = parseInlineThinkingFromContent(cleanContent);
      mergedText = inline.text;
      mergedThinking = inline.thinking
        ? mergeDistinctTextSegments(inline.thinking, cleanThinking)
        : cleanThinking;
    }

    const sanitized = applySeparateReasoningSanitization(mergedThinking, mergedText);
    mergedThinking = sanitized.thinking;
    mergedText = sanitized.text;

    if (!isStreaming) {
      const fixed = separateThinkingForDisplay({
        text: mergedText,
        thinking: mergedThinking,
        isStreaming: false,
        trustBackendSplit: true,
      });
      return {
        text: fixed.text,
        thinking: fixed.thinking,
        isThinking: false,
      };
    }

    return {
      text: mergedText,
      thinking: mergedThinking,
      isThinking: !mergedText.trim() && !!mergedThinking.trim(),
    };
  }
  
  // 情况 2: 后端混合流，正文中携带 <think> 标签（如 Ollama 或其他中转的 R1 混合推送）
  // 查找结束标签（中英文）
  const closingTags = [/<\/think(?:ing)?>/i, /思考结束/];
  let closingTagMatch: RegExpMatchArray | null = null;
  for (const pattern of closingTags) {
    const match = cleanContent.match(pattern);
    if (match && (match.index ?? -1) >= 0) {
      if (!closingTagMatch || (match.index ?? 0) < (closingTagMatch.index ?? 0)) {
        closingTagMatch = match;
      }
    }
  }
  
  if (closingTagMatch) {
    const closingTagIndex = closingTagMatch.index ?? -1;
    let thinking = cleanContent.slice(0, closingTagIndex);
    const text = cleanContent.slice(closingTagIndex + closingTagMatch[0].length).replace(/^\s+/, '');
    
    // 清理思考区内的开始标签
    thinking = thinking
      .replace(/<think(?:ing)?[\s\S]*?>/gi, '')
      .replace(/思考开始/g, '')
      .trim();
      
    // 如果不是处于流式状态，进行最后的修剪和提取（以支持复杂的段落划分）
    if (!isStreaming) {
      const fixed = separateThinkingForDisplay({ text, thinking, isStreaming: false });
      return {
        text: fixed.text,
        thinking: fixed.thinking,
        isThinking: false,
      };
    }
    
    return {
      text,
      thinking,
      isThinking: false,
    };
  }
  
  // 查找开始标签（中英文）
  const startTags = ['<thinking>', '<think>', '思考开始'];
  let earliestStartPos = -1;
  let startTagLength = 0;
  for (const tag of startTags) {
    const pos = cleanContent.indexOf(tag);
    if (pos !== -1 && (earliestStartPos === -1 || pos < earliestStartPos)) {
      earliestStartPos = pos;
      startTagLength = tag.length;
    }
  }
  
  if (earliestStartPos !== -1) {
    const thinking = cleanContent.slice(earliestStartPos + startTagLength);
    const text = cleanContent.slice(0, earliestStartPos);
    return {
      text,
      thinking,
      isThinking: isStreaming,
    };
  }
  
  // 情况 3: 无思考内容，直接输出正文
  return {
    text: cleanContent,
    thinking: '',
    isThinking: false,
  };
}
