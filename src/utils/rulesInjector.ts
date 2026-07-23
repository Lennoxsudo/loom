/**
 * Rules 上下文注入模块
 *
 * 负责将 Rules 内容格式化为带标记的文本块，并在对话首次消息时注入到上下文中。
 * 支持 contentHash 指纹检测：Rules 内容变更时自动重新注入。
 */

import { hashString } from '../hooks/useContextInjectionState';

const RULES_START_TAG = '[Rules Context]';
const RULES_END_TAG = '[End Rules Context]';

/**
 * 将 Rules 内容格式化为带有明确标记的文本块。
 * 空或仅含空白字符的 rules 返回空字符串。
 *
 * @param rules - 原始 Rules 内容
 * @returns 格式化后的 Rules 上下文块，或空字符串
 */
export function formatRulesContext(rules: string): string {
  if (!rules.trim()) return '';
  return `${RULES_START_TAG}\n${rules}\n${RULES_END_TAG}`;
}

/**
 * 判断是否应该注入 Rules。
 *
 * 注入条件（满足任一）：
 *  1. 尚未注入过
 *  2. Rules 内容已变更（contentHash 不匹配）
 *
 * @param rules - Rules 内容
 * @param alreadyInjected - 是否已经注入过
 * @param prevContentHash - 上次注入时的 Rules 内容 hash（可选）
 * @returns 是否应该注入
 */
export function shouldInjectRules(
  rules: string,
  alreadyInjected: boolean,
  prevContentHash?: string
): boolean {
  if (!rules.trim()) return false;
  if (!alreadyInjected) return true;
  // 已注入过，仅当上次注入时有记录 hash 且当前 hash 不匹配时才重新注入
  // （旧数据没有 contentHash，不应重新注入，保持幂等性）
  if (prevContentHash !== undefined) {
    const currentHash = hashString(rules);
    return currentHash !== prevContentHash;
  }
  return false;
}

/**
 * 计算 Rules 内容的 hash 值。
 *
 * @param rules - Rules 内容
 * @returns hash 字符串，空内容返回空字符串
 */
export function getRulesContentHash(rules: string): string {
  if (!rules.trim()) return '';
  return hashString(rules);
}

/**
 * 构建包含格式化 Rules 上下文的系统消息。
 *
 * @param rules - Rules 内容
 * @returns 系统角色消息对象
 */
export function buildRulesMessage(rules: string): { role: string; content: string } {
  return {
    role: 'system',
    content: formatRulesContext(rules),
  };
}

/**
 * 将 Rules 内容附加到首条 user 消息的文本前缀。
 *
 * 用于替代 buildRulesMessage 的独立 system 注入方式：
 * Rules 作为 system 消息只在首次/变更时注入，会导致后续请求的 system 内容不同，
 * 破坏 Prompt Caching 前缀稳定性。改为附加到首条 user 消息后，system prompt 保持完全稳定。
 *
 * @param requestMessages - 待处理的请求消息数组（会被原地修改）
 * @param rules - Rules 内容
 * @returns 是否实际执行了注入
 */
export function prependRulesToFirstUserMessage<T extends { role: string; content: unknown }>(
  requestMessages: T[],
  rules: string
): boolean {
  const rulesText = formatRulesContext(rules);
  if (!rulesText) return false;

  const firstUserIdx = requestMessages.findIndex((m) => m.role === 'user');
  if (firstUserIdx < 0) return false;

  const firstUser = requestMessages[firstUserIdx];
  const originalContent = typeof firstUser.content === 'string' ? firstUser.content : '';
  requestMessages[firstUserIdx] = {
    ...firstUser,
    content: `${rulesText}\n\n${originalContent}`,
  };
  return true;
}
