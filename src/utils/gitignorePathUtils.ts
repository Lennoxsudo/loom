/** 仓库内相对路径，转为 .gitignore 中常用的正斜杠形式 */
export function normalizePathForGitignore(relPath: string): string {
  const s = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s || s.includes('..')) return '';
  return s;
}

export function isUnsafeGitignoreRelativePath(relPath: string): boolean {
  const n = normalizePathForGitignore(relPath);
  if (!n) return true;
  const lower = n.toLowerCase();
  if (lower === '.gitignore') return true;
  if (lower.startsWith('.git/')) return true;
  return false;
}

export function gitignoreAlreadyHasRule(existingContent: string, ruleLine: string): boolean {
  const target = ruleLine.trim();
  if (!target) return true;
  const lines = existingContent.split(/\r?\n/);
  return lines.some((l) => l.trim() === target);
}

export function appendGitignoreRule(existingContent: string, ruleLine: string): string {
  const rule = ruleLine.trim();
  if (!rule) return existingContent;
  const trimmedEnd = existingContent.replace(/\s+$/, '');
  if (!trimmedEnd) return `${rule}\n`;
  return `${trimmedEnd}\n${rule}\n`;
}
