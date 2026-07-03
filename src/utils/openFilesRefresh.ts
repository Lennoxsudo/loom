export type OpenFileLike = {
  kind: 'text' | 'image' | 'settings' | 'agent' | 'browser' | 'diff';
  path: string;
  name: string;
  isDirty: boolean;
  content?: string;
  src?: string;
  url?: string;
  originalContent?: string;
  modifiedContent?: string;
  language?: string;
  leftLabel?: string;
  rightLabel?: string;
};

export function mergeRefreshedContents<T extends OpenFileLike>(
  openFilesByPath: Record<string, T>,
  refreshed: Record<string, string>
): Record<string, T> {
  let changed = false;
  const next = { ...openFilesByPath };

  for (const [path, content] of Object.entries(refreshed)) {
    const existing = next[path];
    if (!existing || existing.kind !== 'text') {
      continue;
    }
    // 外部修改（如 AI 工具）应该强制更新文件内容
    // 不再跳过 isDirty 的文件
    if (existing.content === content) {
      continue;
    }
    next[path] = { ...existing, content, isDirty: false } as T;
    changed = true;
  }

  return changed ? next : openFilesByPath;
}
