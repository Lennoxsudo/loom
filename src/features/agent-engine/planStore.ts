/**
 * Plan document store (conversation-scoped).
 *
 * Runtime cache lives in memory. Persistence follows the conversation:
 * - Chat: embedded in conversation JSON via `planDocument`
 * - Agent: embedded on each AgentConversation as `planDocument`
 * Delete conversation / thread → clearPlan(conversationId).
 */

export type PlanDocumentStatus = 'draft' | 'pending_review' | 'accepted' | 'rejected';

export type PlanDocument = {
  content: string;
  title: string;
  status: PlanDocumentStatus;
  updatedAt: number;
};

export type ExitPlanModeResult = {
  accepted: boolean;
  plan: string;
  title?: string;
};

/** Legacy localStorage prefix — purged once so old orphan keys go away. */
const LEGACY_PLAN_STORAGE_KEY_PREFIX = 'loom.plan_document';
export const PLAN_UPDATED_EVENT = 'loom:plan-updated';

const memoryPlansByConversation: Map<string, PlanDocument> = new Map();

function emptyPlan(): PlanDocument {
  return {
    content: '',
    title: '',
    status: 'draft',
    updatedAt: Date.now(),
  };
}

function emitPlanUpdated(conversationId: string, plan: PlanDocument): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PLAN_UPDATED_EVENT, {
      detail: { conversationId, plan },
    })
  );
}

function purgeLegacyLocalStoragePlans(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(LEGACY_PLAN_STORAGE_KEY_PREFIX)) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

let legacyPurged = false;
function ensureLegacyPurged(): void {
  if (legacyPurged) return;
  legacyPurged = true;
  purgeLegacyLocalStoragePlans();
}

function normalizePlanDocument(raw: unknown): PlanDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const content = typeof obj.content === 'string' ? obj.content : '';
  const title = typeof obj.title === 'string' ? obj.title : '';
  const status =
    obj.status === 'pending_review' ||
    obj.status === 'accepted' ||
    obj.status === 'rejected' ||
    obj.status === 'draft'
      ? obj.status
      : 'draft';
  const updatedAt = typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now();
  if (!content.trim() && status === 'draft' && !title.trim()) {
    return null;
  }
  return { content, title, status, updatedAt };
}

export function peekPlan(conversationId: string): PlanDocument {
  ensureLegacyPurged();
  if (!conversationId) return emptyPlan();
  return memoryPlansByConversation.get(conversationId) ?? emptyPlan();
}

export function loadPlan(conversationId: string): PlanDocument {
  return peekPlan(conversationId);
}

/**
 * Load plan from conversation payload into the runtime cache (e.g. after disk load).
 */
export function hydratePlan(conversationId: string, raw: unknown): PlanDocument {
  ensureLegacyPurged();
  if (!conversationId) return emptyPlan();
  const normalized = normalizePlanDocument(raw);
  if (!normalized) {
    memoryPlansByConversation.delete(conversationId);
    emitPlanUpdated(conversationId, emptyPlan());
    return emptyPlan();
  }
  memoryPlansByConversation.set(conversationId, normalized);
  emitPlanUpdated(conversationId, normalized);
  return normalized;
}

/**
 * Snapshot for embedding into conversation save payload.
 * Returns undefined when there is nothing meaningful to persist.
 */
export function exportPlanForSave(conversationId: string): PlanDocument | undefined {
  ensureLegacyPurged();
  if (!conversationId) return undefined;
  const plan = memoryPlansByConversation.get(conversationId);
  if (!plan) return undefined;
  if (!plan.content.trim() && plan.status === 'draft' && !plan.title.trim()) {
    return undefined;
  }
  return { ...plan };
}

export function setPlan(
  conversationId: string,
  patch: Partial<Pick<PlanDocument, 'content' | 'title' | 'status'>>
): PlanDocument {
  ensureLegacyPurged();
  if (!conversationId) return emptyPlan();
  const prev = peekPlan(conversationId);
  const next: PlanDocument = {
    content: typeof patch.content === 'string' ? patch.content : prev.content,
    title: typeof patch.title === 'string' ? patch.title : prev.title,
    status: patch.status ?? prev.status,
    updatedAt: Date.now(),
  };
  memoryPlansByConversation.set(conversationId, next);
  emitPlanUpdated(conversationId, next);
  return next;
}

export function clearPlan(conversationId: string): void {
  ensureLegacyPurged();
  if (!conversationId) return;
  memoryPlansByConversation.delete(conversationId);
  emitPlanUpdated(conversationId, emptyPlan());
}

/**
 * Infer a short plan title when the model omits `title`.
 * Prefers the first ATX markdown heading, else the first non-empty line.
 */
export function inferPlanTitle(content: string, explicit?: string | null): string {
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim();
  }
  if (!content?.trim()) return '';

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('```')) continue;

    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      let title = heading[1].trim();
      title =
        title.replace(/\s*[-–—|]\s*(实现计划|Implementation\s*plan)\s*$/i, '').trim() || title;
      return title.length > 80 ? `${title.slice(0, 77)}…` : title;
    }

    const prose = line.replace(/^[-*+]\s+/, '').trim();
    if (prose) {
      return prose.length > 80 ? `${prose.slice(0, 77)}…` : prose;
    }
  }
  return '';
}

/** Format plan for tool output / structured injection. */
export function formatPlanDocumentBlock(
  plan: PlanDocument | { content: string; title?: string }
): string {
  const content = plan.content?.trim() ?? '';
  const title = ('title' in plan && plan.title?.trim()) || inferPlanTitle(content) || '';
  const lines = ['[PLAN]'];
  if (title) {
    lines.push(`# ${title}`, '');
  }
  if (content) {
    lines.push(content);
  } else {
    lines.push('(empty plan)');
  }
  lines.push('[End PLAN]');
  return lines.join('\n');
}
