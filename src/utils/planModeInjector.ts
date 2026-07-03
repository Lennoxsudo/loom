/**
 * Plan 模式上下文注入模块
 *
 * 将计划模式说明附加到 user 消息前缀，而非插入第二条 system 消息，
 * 以保持 system prompt / tool schema 前缀稳定，利于 Prompt Caching。
 */

export const PLAN_MODE_START_TAG = '[Plan Mode]';
export const PLAN_MODE_END_TAG = '[End Plan Mode]';

export const PLAN_MODE_TEXT =
  '【计划模式】你当前处于只读计划模式。你只能阅读文件、搜索和分析代码，不能写入、修改、创建、删除文件或执行命令。请制定计划并说明你会做什么，但不要实际执行任何修改操作。';

/**
 * 将 Plan 模式说明格式化为带标记的文本块。
 */
export function formatPlanModeContext(): string {
  return `${PLAN_MODE_START_TAG}\n${PLAN_MODE_TEXT}\n${PLAN_MODE_END_TAG}`;
}

function hasLeadingPlanModeBlock(content: string): boolean {
  const trimmed = content.trimStart();
  return trimmed.startsWith(PLAN_MODE_START_TAG) && trimmed.includes(PLAN_MODE_END_TAG);
}

/**
 * 为单条 user 消息内容附加 Plan 模式块（幂等）。
 */
export function prependPlanModeToUserMessage(content: string): string {
  const planText = formatPlanModeContext();
  if (!planText || hasLeadingPlanModeBlock(content)) {
    return content;
  }
  if (!content.trim()) {
    return planText;
  }
  return `${planText}\n\n${content}`;
}

/**
 * 为消息列表中最后一条 user 消息附加 Plan 模式块。
 */
export function prependPlanModeToLastUserMessage<T extends { role: string; content: unknown }>(
  requestMessages: T[],
): boolean {
  for (let i = requestMessages.length - 1; i >= 0; i--) {
    const message = requestMessages[i];
    if (message.role !== 'user') continue;

    const originalContent =
      typeof message.content === 'string' ? message.content : '';
    requestMessages[i] = {
      ...message,
      content: prependPlanModeToUserMessage(originalContent),
    };
    return true;
  }
  return false;
}

/**
 * 从 user 消息中剥离 Plan 模式块，供 UI 预览/标题使用。
 */
export function stripPlanModeFromUserText(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith(PLAN_MODE_START_TAG)) {
    return content;
  }

  const endIdx = trimmed.indexOf(PLAN_MODE_END_TAG);
  if (endIdx < 0) {
    return content;
  }

  return trimmed.slice(endIdx + PLAN_MODE_END_TAG.length).replace(/^\s+/, '');
}
