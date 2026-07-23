/**
 * Place the plan panel after the plan-related tool turn, not at the absolute
 * end of the whole conversation forever.
 */

export const PLAN_RELATED_TOOL_NAMES = new Set([
  'update_plan',
  'exit_plan_mode',
  'Update_plan',
  'Exit_plan_mode',
]);

export type PlanAnchorMessage = {
  id: string;
  role: string;
  tool_name?: string | null;
};

/**
 * Returns the id of the last plan-related tool message, or the last message id,
 * or null if the list is empty.
 */
export function findPlanAnchorMessageId(messages: PlanAnchorMessage[]): string | null {
  if (!messages.length) return null;
  let lastPlanToolId: string | null = null;
  for (const m of messages) {
    if (m.role === 'tool' && m.tool_name && PLAN_RELATED_TOOL_NAMES.has(m.tool_name)) {
      lastPlanToolId = m.id;
    }
  }
  if (lastPlanToolId) return lastPlanToolId;
  return messages[messages.length - 1]?.id ?? null;
}

type ListItemShape = {
  id?: string;
  type?: string;
  kind?: string;
  messages?: { id: string }[];
  message?: { id: string };
};

/**
 * Insert `planItem` into `items` after the group that contains `anchorMessageId`.
 * If the anchor is not found, append before a trailing pending_changes item (if any),
 * otherwise append at the end.
 */
export function insertAfterMessageAnchor<TItem, TPlan>(
  items: TItem[],
  planItem: TPlan,
  anchorMessageId: string | null,
  options?: { pendingChangesType?: string }
): Array<TItem | TPlan> {
  if (!items.length) return [planItem];
  const pendingType = options?.pendingChangesType ?? 'pending_changes';

  if (anchorMessageId) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as TItem & ListItemShape;
      // Chat message row
      if (!('type' in item) && !('kind' in item) && item.id === anchorMessageId) {
        return [...items.slice(0, i + 1), planItem, ...items.slice(i + 1)];
      }
      // Chat tool_group
      if (item.type === 'tool_group' && item.messages?.some((m) => m.id === anchorMessageId)) {
        return [...items.slice(0, i + 1), planItem, ...items.slice(i + 1)];
      }
      // Agent msg
      if (item.kind === 'msg' && item.message?.id === anchorMessageId) {
        return [...items.slice(0, i + 1), planItem, ...items.slice(i + 1)];
      }
      // Agent groups
      if (
        (item.kind === 'readGroup' || item.kind === 'deleteGroup') &&
        item.messages?.some((m) => m.id === anchorMessageId)
      ) {
        return [...items.slice(0, i + 1), planItem, ...items.slice(i + 1)];
      }
    }
  }

  // Fallback: before pending_changes footer, else end
  const pendingIdx = items.findIndex((it) => (it as ListItemShape).type === pendingType);
  if (pendingIdx >= 0) {
    return [...items.slice(0, pendingIdx), planItem, ...items.slice(pendingIdx)];
  }
  return [...items, planItem];
}
