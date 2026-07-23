/**
 * Recover plan documents from conversation tool history when planDocument
 * was not persisted (e.g. older Agent saves that stripped the field).
 */

import { inferPlanTitle, type PlanDocument, type PlanDocumentStatus } from './planStore';
import { PLAN_DOC_END_TAG, PLAN_DOC_START_TAG } from '../../utils/planModeInjector';

export type PlanRecoverMessage = {
  role?: string;
  tool_name?: string | null;
  tool_args?: Record<string, unknown> | null;
  text?: string;
  content?: string;
};

function extractPlanFromText(body: string): { content: string; title: string } | null {
  if (!body) return null;
  const start = body.indexOf(PLAN_DOC_START_TAG);
  const end = body.indexOf(PLAN_DOC_END_TAG);
  if (start < 0 || end <= start) return null;
  let block = body.slice(start + PLAN_DOC_START_TAG.length, end).trim();
  if (!block || block === '(empty plan)') return null;

  let title = '';
  const titleMatch = /^#\s+(.+)\s*$/m.exec(block);
  if (titleMatch) {
    title = titleMatch[1].trim();
    block = block.replace(/^#\s+.+\s*\n?/, '').trim();
  }
  if (!block.trim()) return null;
  return { content: block, title };
}

function resolveStatus(
  toolName: string,
  messages: PlanRecoverMessage[],
  planMessageIndex: number
): PlanDocumentStatus {
  if (toolName !== 'exit_plan_mode') return 'draft';
  // If the user continued after submitting the plan, treat it as accepted.
  for (let i = planMessageIndex + 1; i < messages.length; i++) {
    const role = messages[i]?.role;
    if (role === 'user' || role === 'assistant') return 'accepted';
  }
  return 'pending_review';
}

/**
 * Walk tool messages and rebuild the latest plan document from
 * `update_plan` / `exit_plan_mode` args or `[PLAN]` blocks in the tool output.
 */
export function recoverPlanFromMessages(
  messages: PlanRecoverMessage[] | undefined | null
): PlanDocument | null {
  if (!messages?.length) return null;

  let best: PlanDocument | null = null;
  let bestIndex = -1;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'tool') continue;
    const toolName = (m.tool_name || '').trim();
    if (toolName !== 'update_plan' && toolName !== 'exit_plan_mode') continue;

    const args = m.tool_args || {};
    let content = typeof args.plan === 'string' ? args.plan : '';
    let title = typeof args.title === 'string' ? args.title.trim() : '';
    const body =
      typeof m.text === 'string' ? m.text : typeof m.content === 'string' ? m.content : '';

    if (!content.trim()) {
      const fromText = extractPlanFromText(body);
      if (fromText) {
        content = fromText.content;
        if (!title) title = fromText.title;
      }
    }

    if (!content.trim()) continue;

    const resolvedTitle = title || inferPlanTitle(content) || '';
    best = {
      content,
      title: resolvedTitle,
      status: resolveStatus(toolName, messages, i),
      updatedAt: Date.now(),
    };
    bestIndex = i;
  }

  if (!best || bestIndex < 0) return null;
  // Re-resolve status with final index (already set in loop; keep for clarity)
  best = {
    ...best,
    status: resolveStatus(
      messages[bestIndex].tool_name === 'exit_plan_mode' ? 'exit_plan_mode' : 'update_plan',
      messages,
      bestIndex
    ),
  };
  return best;
}
