/**
 * 工具结果持久化老化模块
 *
 * 将较早的 tool 结果截断为短摘要并写回会话存储，使出站 payload 与磁盘一致，
 * 避免每轮在 applyContextBudget 中临时改写历史导致 Prompt Cache 前缀碎裂。
 *
 * 老化受上下文压力门控：仅当估算用量超过上下文窗口的
 * {@link TOOL_RESULT_AGING_PRESSURE_RATIO} 时才触发，且从最旧的工具结果开始
 * 逐条老化，降到阈值以下即停止，不做无条件截断。
 */

import { estimateTokens } from './contextBudget';

/** 保留最近几条工具结果的原文（无论压力多大都不老化） */
export const TOOL_RESULT_AGING_KEEP_COUNT = 3;

/** 工具结果摘要化后保留的最大字符数 */
export const TOOL_RESULT_SUMMARY_MAX_CHARS = 500;

/** 老化触发阈值：估算用量超过上下文窗口的该比例才开始老化 */
export const TOOL_RESULT_AGING_PRESSURE_RATIO = 0.6;

/** 未提供上下文窗口时的门控默认值（与 contextBudget.DEFAULT_CONTEXT_WINDOW 一致） */
const DEFAULT_AGING_CONTEXT_WINDOW = 200_000;

/** 摘要化后缀标记 */
export const TOOL_RESULT_AGED_SUFFIX =
  '\n... [older tool result truncated to save context; re-run the tool if the full output is needed]';

/** 旧版后缀标记（兼容已持久化的历史会话，保持幂等识别） */
const LEGACY_TOOL_RESULT_AGED_SUFFIX = '... [tool result aged to save context]';

export function isAgedToolResultText(text: string): boolean {
  return (
    text.includes(TOOL_RESULT_AGED_SUFFIX) || text.includes(LEGACY_TOOL_RESULT_AGED_SUFFIX)
  );
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

/** 粗略估算单条消息的文本 token（用于老化门控，无需精确） */
function estimateMessageTextTokens(msg: PersistedToolMessage): number {
  if (typeof msg.text === 'string') return estimateTokens(msg.text) + 4;
  if (typeof msg.content === 'string') return estimateTokens(msg.content) + 4;
  if (msg.content != null) {
    try {
      return estimateTokens(JSON.stringify(msg.content)) + 4;
    } catch {
      return 4;
    }
  }
  return 4;
}

/** 估算消息数组的文本 token 总量 */
function estimateMessagesTextTokens(messages: PersistedToolMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTextTokens(m), 0);
}

/**
 * 对会话中较早的 tool 消息进行压力门控老化。
 *
 * - 估算用量未超过 `maxContextTokens * TOOL_RESULT_AGING_PRESSURE_RATIO` 时不做任何修改
 * - 超过阈值时从最旧的工具结果开始逐条老化，降到阈值以下即停止
 * - 最近 keepCount 条工具结果始终保留原文
 *
 * @param messages 会话消息
 * @param keepCount 保留最近几条工具结果原文（默认 3）
 * @param maxContextTokens 上下文窗口大小（token），缺省按 200K 门控
 */
export function agePersistedChatToolMessages<T extends PersistedToolMessage>(
  messages: T[],
  keepCount = TOOL_RESULT_AGING_KEEP_COUNT,
  maxContextTokens?: number
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

  const contextWindow = maxContextTokens ?? DEFAULT_AGING_CONTEXT_WINDOW;
  const threshold = Math.floor(contextWindow * TOOL_RESULT_AGING_PRESSURE_RATIO);
  let totalTokens = estimateMessagesTextTokens(messages);

  if (totalTokens <= threshold) {
    return { messages, changed: false };
  }

  // 候选：除最近 keepCount 条外的工具结果，从最旧开始
  const candidateIndices = toolResultIndices.slice(0, toolResultIndices.length - keepCount);

  let changed = false;
  const result = [...messages];

  for (const idx of candidateIndices) {
    if (totalTokens <= threshold) break;

    const originalText = readPersistedToolResultText(result[idx]);
    const agedText = agePersistedToolText(originalText);
    if (agedText === originalText) continue;

    totalTokens -= estimateTokens(originalText) - estimateTokens(agedText);
    result[idx] = writePersistedToolResultText(result[idx], agedText);
    changed = true;
  }

  return { messages: changed ? result : messages, changed };
}

function isProviderToolResultMessage(msg: { role: string; content: unknown }): boolean {
  if (msg.role === 'tool') return true;
  if (Array.isArray(msg.content)) {
    return msg.content.some(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>).type === 'tool_result'
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

function summarizeProviderToolResultMessage<T extends { role: string; content: unknown }>(
  msg: T
): T {
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
 * 对 provider 格式消息中的较早 tool 结果进行压力门控老化（runAgentLoop 等内存路径）。
 * 门控与逐条老化策略同 {@link agePersistedChatToolMessages}。
 */
export function agePersistedProviderToolMessages<T extends { role: string; content: unknown }>(
  messages: T[],
  keepCount = TOOL_RESULT_AGING_KEEP_COUNT,
  maxContextTokens?: number
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

  const contextWindow = maxContextTokens ?? DEFAULT_AGING_CONTEXT_WINDOW;
  const threshold = Math.floor(contextWindow * TOOL_RESULT_AGING_PRESSURE_RATIO);
  let totalTokens = estimateMessagesTextTokens(messages);

  if (totalTokens <= threshold) {
    return messages;
  }

  const candidateIndices = toolResultIndices.slice(0, toolResultIndices.length - keepCount);

  let changed = false;
  const result = [...messages];

  for (const idx of candidateIndices) {
    if (totalTokens <= threshold) break;

    const originalText = extractProviderToolResultText(result[idx]);
    const summarized = summarizeProviderToolResultMessage(result[idx]);
    if (summarized === result[idx]) continue;

    const agedText = extractProviderToolResultText(summarized);
    totalTokens -= estimateTokens(originalText) - estimateTokens(agedText);
    result[idx] = summarized;
    changed = true;
  }

  return changed ? result : messages;
}
