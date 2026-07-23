import { invoke } from '@tauri-apps/api/core';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

export type TodoWriteInputItem = {
  id?: string;
  content?: string;
  status?: string;
};

const TODO_STORAGE_KEY_PREFIX = 'loom.todo_write.items';
export const TODO_UPDATED_EVENT = 'loom:todos-updated';

// 按 conversationId 存储的内存缓存
const memoryTodosByConversation: Map<string, TodoItem[]> = new Map();

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeStatus(value: unknown): TodoStatus {
  if (value === 'completed') return 'completed';
  if (value === 'in_progress' || value === 'in-progress' || value === 'inprogress') {
    return 'in_progress';
  }
  return 'pending';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function makeFallbackId(index: number): string {
  return `todo-${Date.now()}-${index + 1}`;
}

function parseStoredTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];

  const result: TodoItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as TodoWriteInputItem;
    const content = normalizeText(item?.content);
    if (!content) continue;
    const id = normalizeText(item?.id) || makeFallbackId(i);
    result.push({
      id,
      content,
      status: normalizeStatus(item?.status),
    });
  }
  return result;
}

function getStorageKey(conversationId: string): string {
  return `${TODO_STORAGE_KEY_PREFIX}.${conversationId}`;
}

function loadTodosFromLocalStorage(conversationId: string): TodoItem[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(conversationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return parseStoredTodos(parsed);
  } catch {
    return [];
  }
}

function saveTodosToLocalStorage(conversationId: string, todos: TodoItem[]): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(getStorageKey(conversationId), JSON.stringify(todos));
  } catch {
    // ignore quota/storage errors
  }
}

/** 通过 Rust 后端从文件加载 todos */
async function loadTodosFromFile(conversationId: string): Promise<TodoItem[] | null> {
  try {
    const result = await invoke<{ id: string; content: string; status: string }[]>('load_todos', {
      conversationId,
    });
    return parseStoredTodos(result);
  } catch {
    return null;
  }
}

/** 通过 Rust 后端将 todos 保存到文件 */
async function saveTodosToFile(conversationId: string, todos: TodoItem[]): Promise<void> {
  try {
    await invoke('save_todos', { conversationId, todos });
  } catch {
    // fallback 已由 localStorage 覆盖
  }
}

function getTodos(conversationId: string): TodoItem[] {
  if (!conversationId) return [];

  if (!memoryTodosByConversation.has(conversationId)) {
    memoryTodosByConversation.set(conversationId, loadTodosFromLocalStorage(conversationId));
  }
  return [...(memoryTodosByConversation.get(conversationId) || [])];
}

/** 同步读取内存 / localStorage 缓存，避免 UI 轮询时走 Tauri IPC。 */
export function peekTodos(conversationId: string): TodoItem[] {
  return getTodos(conversationId);
}

function notifyTodosUpdated(conversationId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TODO_UPDATED_EVENT, { detail: { conversationId } }));
}

/**
 * 异步加载 todos：优先从 Rust 文件持久化加载，失败时 fallback 到 localStorage。
 * 初始化时应使用此函数而非同步的 getTodos。
 */
export async function loadTodos(conversationId: string): Promise<TodoItem[]> {
  if (!conversationId) return [];

  // 先尝试从文件加载
  const fileTodos = await loadTodosFromFile(conversationId);
  if (fileTodos !== null && fileTodos.length > 0) {
    memoryTodosByConversation.set(conversationId, fileTodos);
    // 同步到 localStorage 作为备份
    saveTodosToLocalStorage(conversationId, fileTodos);
    return [...fileTodos];
  }

  // fallback: 从 localStorage 或内存缓存读取
  return getTodos(conversationId);
}

export function setTodos(conversationId: string, input: TodoWriteInputItem[]): TodoItem[] {
  if (!conversationId) return [];

  const todos = parseStoredTodos(input);
  memoryTodosByConversation.set(conversationId, todos);

  // 同步写入 localStorage（即时备份）
  saveTodosToLocalStorage(conversationId, todos);

  // 异步写入 Rust 文件持久化
  void saveTodosToFile(conversationId, todos);

  notifyTodosUpdated(conversationId);

  return getTodos(conversationId);
}

function statusLabel(status: TodoStatus): string {
  if (status === 'completed') return 'completed';
  if (status === 'in_progress') return 'in_progress';
  return 'pending';
}

export function formatTodos(todos: TodoItem[]): string {
  const pending = todos.filter((item) => item.status === 'pending').length;
  const inProgress = todos.filter((item) => item.status === 'in_progress').length;
  const completed = todos.filter((item) => item.status === 'completed').length;

  if (todos.length === 0) {
    return 'Todo list updated. Current list is empty.';
  }

  const lines = todos.map((item, index) => {
    const mark = item.status === 'completed' ? '[x]' : '[ ]';
    return `${index + 1}. ${mark} ${item.content} (${statusLabel(item.status)})`;
  });

  return [
    `Todo list updated (${todos.length} items).`,
    `Summary: pending=${pending}, in_progress=${inProgress}, completed=${completed}`,
    '',
    ...lines,
  ].join('\n');
}
