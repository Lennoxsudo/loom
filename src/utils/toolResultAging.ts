/**
 * 工具结果持久化老化模块
 *
 * 将较早的 tool 结果截断为短摘要并写回会话存储，使出站 payload 与磁盘一致，
 * 避免每轮在 applyContextBudget 中临时改写历史导致 Prompt Cache 前缀碎裂。
 */

/** 保留最近几条工具结果的原文 */
export const TOOL_RESULT_AGING_KEEP_COUNT = 3;

/** 工具结果摘要化后保留的最大字符数 */
export const TOOL_RESULT_SUMMARY_MAX_CHARS = 200;

/** 摘要化后缀标记 */
export const TOOL_RESULT_AGED_SUFFIX = '... [tool result aged to save context]';

export function isAgedToolResultText(text: string): boolean {
  return text.includes(TOOL_RESULT_AGED_SUFFIX);
}

/**
 * 将超长 tool 结果文本截断为摘要（幂等：已 aging 则原样返回）。
 */
export function agePersistedToolText(text: string): string {
  if (!text || text.length <= TOOL_RESULT_SUMMARY_MAX_CHARS || isAgedToolResultText(text)) {
    return text;
  }
  return text.slice(0, TOOL_RESULT_SUMMARY_MAX_CHARS) + TOOL_RESULT_AGED_SUFFIX;
}

type PersistedToolMessage = {
  role: string;
  text?: string;
  content?: unknown;
};

function isPersistedToolMessage(msg: PersistedToolMessage): boolean {
  return msg.role === 'tool';
}

function readPersistedToolResultText(msg: PersistedToolMessage): string {
  if (typeof msg.text === 'string') return msg.text;
  if (typeof msg.content === 'string') return msg.content;
  return '';
}

function writePersistedToolResultText<T extends PersistedToolMessage>(msg: T, text: string): T {
  if ('text' in msg) {
    return { ...msg, text };
  }
  if ('content' in msg) {
    return { ...msg, content: text };
  }
  return { ...msg, text };
}

/**
 * 对会话中较早的 tool 消息进行老化，保留最近 keepCount 条原文。
 */
export function agePersistedChatToolMessages<T extends PersistedToolMessage>(
  messages: T[],
  keepCount = TOOL_RESULT_AGING_KEEP_COUNT,
): { messages: T[]; changed: boolean } {
  if (messages.length === 0) {
    return { messages, changed: false };
  }

  const toolResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (isPersistedToolMessage(messages[i])) {
      toolResultIndices.push(i);
    }
  }

  if (toolResultIndices.length <= keepCount) {
    return { messages, changed: false };
  }

  const agedIndices = new Set(toolResultIndices.slice(0, toolResultIndices.length - keepCount));
  let changed = false;

  const result = messages.map((msg, index) => {
    if (!agedIndices.has(index)) return msg;

    const originalText = readPersistedToolResultText(msg);
    const agedText = agePersistedToolText(originalText);
    if (agedText === originalText) return msg;

    changed = true;
    return writePersistedToolResultText(msg, agedText);
  });

  return { messages: result, changed };
}

function isProviderToolResultMessage(msg: { role: string; content: unknown }): boolean {
  if (msg.role === 'tool') return true;
  if (Array.isArray(msg.content)) {
    return msg.content.some(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>).type === 'tool_result',
    );
  }
  return false;
}

function extractProviderToolResultText(msg: { role: string; content: unknown }): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    const parts: string[] = [];
    for (const block of msg.content) {
      if (typeof block === 'object' && block !== null) {
        const typedBlock = block as Record<string, unknown>;
        if (typedBlock.type === 'tool_result' && typeof typedBlock.content === 'string') {
          parts.push(typedBlock.content);
        }
      }
    }
    return parts.join('\n');
  }
  if (msg.content != null) {
    try {
      return JSON.stringify(msg.content);
    } catch {
      return '';
    }
  }
  return '';
}

function summarizeProviderToolResultMessage<T extends { role: string; content: unknown }>(msg: T): T {
  const text = extractProviderToolResultText(msg);
  const summary = agePersistedToolText(text);
  if (summary === text) return msg;

  if (msg.role === 'tool' && typeof msg.content === 'string') {
    return { ...msg, content: summary };
  }

  if (Array.isArray(msg.content)) {
    const newContent = msg.content.map((block) => {
      if (typeof block === 'object' && block !== null) {
        const typedBlock = block as Record<string, unknown>;
        if (typedBlock.type === 'tool_result' && typeof typedBlock.content === 'string') {
          return { ...typedBlock, content: summary };
        }
      }
      return block;
    });
    return { ...msg, content: newContent };
  }

  return msg;
}

/**
 * 对 provider 格式消息中的较早 tool 结果进行老化（runAgentLoop 等内存路径）。
 */
export function agePersistedProviderToolMessages<T extends { role: string; content: unknown }>(
  messages: T[],
  keepCount = TOOL_RESULT_AGING_KEEP_COUNT,
): T[] {
  if (messages.length === 0) return messages;

  const toolResultIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (isProviderToolResultMessage(messages[i])) {
      toolResultIndices.push(i);
    }
  }

  if (toolResultIndices.length <= keepCount) {
    return messages;
  }

  const agedIndices = new Set(toolResultIndices.slice(0, toolResultIndices.length - keepCount));
const result = messages.map((msg, index) => {
if (!agedIndices.has(index)) return msg;
return summarizeProviderToolResultMessage(msg);
});

  return result;
}
