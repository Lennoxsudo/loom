/**
 * Plan 模式上下文注入模块
 *
 * 将计划模式说明附加到 user 消息前缀，而非插入第二条 system 消息，
 * 以保持 system prompt / tool schema 前缀稳定，利于 Prompt Caching。
 *
 * 批准后的计划以结构化 [PLAN] 区块提交，供执行阶段遵循。
 */

import {
  formatPlanDocumentBlock,
  peekPlan,
  type PlanDocument,
} from '../features/agent-engine/planStore';

export const PLAN_MODE_START_TAG = '[Plan Mode]';
export const PLAN_MODE_END_TAG = '[End Plan Mode]';

export const PLAN_DOC_START_TAG = '[PLAN]';
export const PLAN_DOC_END_TAG = '[End PLAN]';

export const PLAN_MODE_TEXT =
  '【计划模式】你当前处于只读计划模式。你只能阅读文件、搜索和分析代码，不能写入、修改、创建、删除文件或执行命令。' +
  '请用 `update_plan` 维护可编辑计划文档，研究完成后调用 `exit_plan_mode` 提交计划供用户审查。' +
  '用户接受后你才会进入执行阶段。制定计划并说明你会做什么，但不要实际执行任何修改操作。';

/**
 * 将 Plan 模式说明格式化为带标记的文本块。
 */
export function formatPlanModeContext(): string {
  return `${PLAN_MODE_START_TAG}\n${PLAN_MODE_TEXT}\n${PLAN_MODE_END_TAG}`;
}

/**
 * 将计划文档格式化为结构化 PLAN 区块。
 */
export function formatPlanDocumentContext(
  plan: PlanDocument | { content: string; title?: string }
): string {
  return formatPlanDocumentBlock(plan);
}

function hasLeadingPlanModeBlock(content: string): boolean {
  const trimmed = content.trimStart();
  return trimmed.startsWith(PLAN_MODE_START_TAG) && trimmed.includes(PLAN_MODE_END_TAG);
}

function hasPlanDocumentBlock(content: string): boolean {
  return content.includes(PLAN_DOC_START_TAG) && content.includes(PLAN_DOC_END_TAG);
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
 * 为单条 user 消息附加结构化 PLAN 文档块（幂等）。
 * 用于用户接受计划后进入执行阶段时，把批准后的计划提交给模型。
 */
export function prependPlanDocumentToUserMessage(
  content: string,
  plan: PlanDocument | { content: string; title?: string }
): string {
  const body = plan.content?.trim() ?? '';
  if (!body) return content;
  if (hasPlanDocumentBlock(content)) return content;

  const block = formatPlanDocumentContext(plan);
  const intro =
    '【已批准计划】用户已审查并接受以下计划。请严格按此计划执行；若需偏离，先说明原因。';
  const prefix = `${intro}\n\n${block}`;
  if (!content.trim()) {
    return prefix;
  }
  return `${prefix}\n\n${content}`;
}

/**
 * 为消息列表中最后一条 user 消息附加 Plan 模式块。
 */
export function prependPlanModeToLastUserMessage<T extends { role: string; content: unknown }>(
  requestMessages: T[]
): boolean {
  for (let i = requestMessages.length - 1; i >= 0; i--) {
    const message = requestMessages[i];
    if (message.role !== 'user') continue;

    const originalContent = typeof message.content === 'string' ? message.content : '';
    requestMessages[i] = {
      ...message,
      content: prependPlanModeToUserMessage(originalContent),
    };
    return true;
  }
  return false;
}

/**
 * 为消息列表中最后一条 user 消息附加已批准的 PLAN 文档块。
 */
export function prependPlanDocumentToLastUserMessage<T extends { role: string; content: unknown }>(
  requestMessages: T[],
  plan: PlanDocument | { content: string; title?: string }
): boolean {
  for (let i = requestMessages.length - 1; i >= 0; i--) {
    const message = requestMessages[i];
    if (message.role !== 'user') continue;

    const originalContent = typeof message.content === 'string' ? message.content : '';
    requestMessages[i] = {
      ...message,
      content: prependPlanDocumentToUserMessage(originalContent, plan),
    };
    return true;
  }
  return false;
}

/**
 * 根据会话中的计划状态，为请求消息注入：
 * - plan 模式：Plan Mode 只读说明 + 当前草稿计划（若有）
 * - always-allow 且计划已 accepted：结构化 PLAN 区块
 */
export function injectPlanContextForRequest<T extends { role: string; content: unknown }>(
  requestMessages: T[],
  options: {
    interactionMode: 'plan' | 'always-allow';
    conversationId?: string;
  }
): void {
  const { interactionMode, conversationId } = options;

  if (interactionMode === 'plan') {
    prependPlanModeToLastUserMessage(requestMessages);
    if (conversationId) {
      const plan = peekPlan(conversationId);
      if (plan.content.trim()) {
        // During planning, attach draft so the model sees the live document.
        for (let i = requestMessages.length - 1; i >= 0; i--) {
          const message = requestMessages[i];
          if (message.role !== 'user') continue;
          const original = typeof message.content === 'string' ? message.content : '';
          if (hasPlanDocumentBlock(original)) break;
          const draftNote =
            '【当前计划草稿】以下为可编辑计划面板中的内容，可继续用 update_plan 修订：';
          const block = formatPlanDocumentContext(plan);
          requestMessages[i] = {
            ...message,
            content: original.trim()
              ? `${original}\n\n${draftNote}\n\n${block}`
              : `${draftNote}\n\n${block}`,
          };
          break;
        }
      }
    }
    return;
  }

  // Execution: inject accepted plan as structured PLAN block.
  if (conversationId) {
    const plan = peekPlan(conversationId);
    if (plan.status === 'accepted' && plan.content.trim()) {
      prependPlanDocumentToLastUserMessage(requestMessages, plan);
    }
  }
}

/**
 * 从 user 消息中剥离 Plan 模式块，供 UI 预览/标题使用。
 */
export function stripPlanModeFromUserText(content: string): string {
  let result = content;
  const trimmed = result.trimStart();
  if (trimmed.startsWith(PLAN_MODE_START_TAG)) {
    const endIdx = trimmed.indexOf(PLAN_MODE_END_TAG);
    if (endIdx >= 0) {
      result = trimmed.slice(endIdx + PLAN_MODE_END_TAG.length).replace(/^\s+/, '');
    }
  }

  // Also strip PLAN document blocks for cleaner titles.
  const planStart = result.indexOf(PLAN_DOC_START_TAG);
  const planEnd = result.indexOf(PLAN_DOC_END_TAG);
  if (planStart >= 0 && planEnd > planStart) {
    const before = result.slice(0, planStart).replace(/\s+$/, '');
    const after = result.slice(planEnd + PLAN_DOC_END_TAG.length).replace(/^\s+/, '');
    // Strip the intro line about approved plan if present.
    const cleanedBefore = before
      .replace(/【已批准计划】[^\n]*\n?/g, '')
      .replace(/【当前计划草稿】[^\n]*\n?/g, '')
      .trim();
    result = [cleanedBefore, after].filter(Boolean).join('\n\n');
  }

  return result;
}
