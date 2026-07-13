/**
 * Bridge plan documents into the main editor as virtual Markdown tabs.
 *
 * Path convention: `__plan__/{conversationId}.md`
 * These tabs are not real files on disk; edits/saves write back to planStore.
 */

import type { OpenFile } from '../types/app';
import {
  peekPlan,
  setPlan,
  type PlanDocument,
} from '../features/agent-engine/planStore';
import { useEditorStore } from '../stores/useEditorStore';
import { toMonacoModelUri } from '../shared/lib/pathUtils';

export const PLAN_EDITOR_PATH_PREFIX = '__plan__/';

/** Maps virtual editor path → original conversationId (not sanitized). */
const pathToConversationId = new Map<string, string>();

export function getPlanEditorPath(conversationId: string): string {
  const safe = encodeURIComponent(conversationId);
  return `${PLAN_EDITOR_PATH_PREFIX}${safe}.md`;
}

export function isPlanEditorPath(path: string | null | undefined): boolean {
  if (typeof path !== 'string' || !path) return false;
  // Accept both slash styles (some path helpers normalize to `\`).
  const normalized = path.replace(/\\/g, '/');
  return normalized.startsWith(PLAN_EDITOR_PATH_PREFIX);
}

/**
 * Virtual editor tabs that are not real files on disk.
 * Disk refresh / file watch / save-to-disk must skip these.
 */
const VIRTUAL_EDITOR_PATH_PREFIXES = [
  PLAN_EDITOR_PATH_PREFIX,
  '__diff__/',
  '__agent__',
  '__settings__',
  '__browser__/',
] as const;

export function isVirtualEditorPath(path: string | null | undefined): boolean {
  if (typeof path !== 'string' || !path) return false;
  const normalized = path.replace(/\\/g, '/');
  return VIRTUAL_EDITOR_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix),
  );
}

export function conversationIdFromPlanEditorPath(path: string): string | null {
  if (!isPlanEditorPath(path)) return null;
  const normalized = path.replace(/\\/g, '/');
  const mapped =
    pathToConversationId.get(path) ?? pathToConversationId.get(normalized);
  if (mapped) return mapped;

  const rest = normalized.slice(PLAN_EDITOR_PATH_PREFIX.length);
  const withoutExt = rest.toLowerCase().endsWith('.md') ? rest.slice(0, -3) : rest;
  try {
    return decodeURIComponent(withoutExt);
  } catch {
    return withoutExt || null;
  }
}

function displayNameForPlan(plan: Pick<PlanDocument, 'title'>): string {
  const title = plan.title?.trim();
  if (title) {
    return title.toLowerCase().endsWith('.md') ? title : `${title}.md`;
  }
  return 'plan.md';
}

function ensureTab(path: string, activate: boolean): void {
  const store = useEditorStore.getState();
  const groupId = store.activeGroupId;
  store.setEditorGroups((prev) =>
    prev.map((g) => {
      if (g.id !== groupId) return g;
      const tabPaths = g.tabPaths.includes(path) ? g.tabPaths : [...g.tabPaths, path];
      return {
        ...g,
        tabPaths,
        activePath: activate ? path : g.activePath,
      };
    }),
  );
  if (activate) {
    store.setActiveGroupId(groupId);
  }
}

/** Push content into an existing Monaco model if present (source view). */
function pushContentToMonacoModel(path: string, content: string): void {
  try {
    // Lazy import so unit tests that only exercise path helpers do not load Monaco.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMonacoInstance } = require('../monaco-loader') as typeof import('../monaco-loader');
    const monaco = getMonacoInstance();
    const uri = monaco.Uri.parse(toMonacoModelUri(path));
    const model = monaco.editor.getModel(uri);
    if (model && model.getValue() !== content) {
      model.setValue(content);
    }
  } catch {
    // Monaco may not be ready yet; store content is still updated.
  }
}

/**
 * Open or update the plan document tab in the main editor.
 * Activates the tab so the user can preview Markdown (rendered / source).
 */
export function openPlanInEditor(
  conversationId: string,
  plan?: Pick<PlanDocument, 'content' | 'title'>,
  options?: { activate?: boolean; forceContent?: boolean },
): string | null {
  if (!conversationId) return null;

  const activate = options?.activate !== false;
  const forceContent = options?.forceContent === true;
  const source = plan ?? peekPlan(conversationId);
  if (!source.content.trim() && !plan) {
    return null;
  }

  const path = getPlanEditorPath(conversationId);
  pathToConversationId.set(path, conversationId);

  const name = displayNameForPlan(source);
  const content = source.content ?? '';
  const store = useEditorStore.getState();
  const existing = store.openFilesByPath[path];

  if (existing?.kind === 'text' && existing.isDirty && !forceContent) {
    // Keep user edits; only refresh the tab name if title changed.
    if (existing.name !== name) {
      store.setOpenFilesByPath((prev) => {
        const cur = prev[path];
        if (!cur || cur.kind !== 'text') return prev;
        return { ...prev, [path]: { ...cur, name } };
      });
    }
    ensureTab(path, activate);
    return path;
  }

  const nextFile: OpenFile = {
    kind: 'text',
    path,
    name,
    content,
    isDirty: false,
  };
  store.setOpenFilesByPath((prev) => ({ ...prev, [path]: nextFile }));
  pushContentToMonacoModel(path, content);
  ensureTab(path, activate);
  return path;
}

/**
 * Push latest planStore content into an already-open editor tab.
 */
export function syncPlanToOpenEditor(
  conversationId: string,
  plan?: PlanDocument,
  options?: { force?: boolean },
): void {
  if (!conversationId) return;
  const path = getPlanEditorPath(conversationId);
  pathToConversationId.set(path, conversationId);
  const store = useEditorStore.getState();
  const existing = store.openFilesByPath[path];
  if (!existing || existing.kind !== 'text') return;

  const source = plan ?? peekPlan(conversationId);
  if (!options?.force && existing.isDirty) return;

  store.setOpenFilesByPath((prev) => {
    const cur = prev[path];
    if (!cur || cur.kind !== 'text') return prev;
    const name = displayNameForPlan(source);
    if (cur.content === source.content && cur.name === name && !cur.isDirty) {
      return prev;
    }
    return {
      ...prev,
      [path]: {
        ...cur,
        content: source.content,
        name,
        isDirty: false,
      },
    };
  });
  if (options?.force) {
    pushContentToMonacoModel(path, source.content);
  }
}

/**
 * Persist editor buffer back into planStore (virtual save — no disk write).
 */
export function savePlanEditorContent(filePath: string, content: string): boolean {
  const conversationId = conversationIdFromPlanEditorPath(filePath);
  if (!conversationId) return false;

  const prev = peekPlan(conversationId);
  setPlan(conversationId, {
    content,
    title: prev.title,
    status: prev.status,
  });

  const store = useEditorStore.getState();
  store.setOpenFilesByPath((prevFiles) => {
    const existing = prevFiles[filePath];
    if (!existing || existing.kind !== 'text') return prevFiles;
    return {
      ...prevFiles,
      [filePath]: { ...existing, content, isDirty: false },
    };
  });
  return true;
}

/**
 * When the editor buffer changes for a plan tab, mirror into planStore without disk I/O.
 * Emits PLAN_UPDATED so PlanDocumentPanel in the conversation updates immediately.
 */
export function onPlanEditorContentChange(filePath: string, content: string): boolean {
  const conversationId = conversationIdFromPlanEditorPath(filePath);
  if (!conversationId) return false;

  // Keep reverse lookup healthy even if the tab was restored without openPlanInEditor.
  const path = getPlanEditorPath(conversationId);
  pathToConversationId.set(path, conversationId);
  if (filePath !== path) {
    pathToConversationId.set(filePath, conversationId);
  }

  const prev = peekPlan(conversationId);
  // Normalize EOL so panel ↔ editor comparisons stay stable across Windows.
  const nextContent = content.replace(/\r\n/g, '\n');
  if (prev.content.replace(/\r\n/g, '\n') === nextContent) return true;
  setPlan(conversationId, {
    content: nextContent,
    title: prev.title,
    status:
      prev.status === 'pending_review'
        ? 'pending_review'
        : prev.status === 'accepted'
          ? 'accepted'
          : prev.status === 'rejected'
            ? 'rejected'
            : 'draft',
  });
  return true;
}
