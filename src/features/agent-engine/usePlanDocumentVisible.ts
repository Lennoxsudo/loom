import { useEffect, useState } from 'react';
import { peekPlan, PLAN_UPDATED_EVENT, type PlanDocument } from './planStore';

function planIsVisible(plan: PlanDocument): boolean {
  return Boolean(plan.content.trim()) || plan.status === 'pending_review';
}

/**
 * True when the conversation has a plan panel to show (content or pending review).
 * Used so the plan row is only inserted into the message list when needed —
 * after the plan-tool turn, not as a permanent empty footer.
 */
export function usePlanDocumentVisible(conversationId: string | null | undefined): boolean {
  const [visible, setVisible] = useState(() =>
    conversationId ? planIsVisible(peekPlan(conversationId)) : false,
  );

  useEffect(() => {
    if (!conversationId) {
      setVisible(false);
      return;
    }
    setVisible(planIsVisible(peekPlan(conversationId)));

    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId: string; plan: PlanDocument }>).detail;
      if (!detail || detail.conversationId !== conversationId) return;
      setVisible(planIsVisible(detail.plan));
    };
    window.addEventListener(PLAN_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(PLAN_UPDATED_EVENT, onUpdated);
  }, [conversationId]);

  return visible;
}
