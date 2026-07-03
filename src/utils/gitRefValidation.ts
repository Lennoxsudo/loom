/** 与后端 validate_commit_hash 对齐的前端预检 */
export function isValidCommitHash(hash: string): boolean {
  const t = hash.trim();
  if (t.length < 7 || t.length > 40) return false;
  return /^[0-9a-fA-F]+$/.test(t);
}

/** 与后端 sanitize_branch_ref 对齐的前端预检 */
export function isValidBranchName(name: string): boolean {
  const t = name.trim();
  if (!t || t.length > 240) return false;
  if (t.includes('\n') || t.includes('\r') || t.includes('..')) return false;
  return true;
}

/** git blame porcelain 的 author-time（epoch 秒）格式化为本地时间 */
export function formatBlameEpochDate(epochStr: string): string {
  const trimmed = epochStr.trim();
  if (!trimmed) return epochStr;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return epochStr;
  try {
    return new Date(n * 1000).toLocaleString();
  } catch {
    return epochStr;
  }
}

/** git branch -d 因未合并失败时的典型错误 */
export function isUnmergedBranchDeleteError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('not fully merged') ||
    message.includes('未完全合并') ||
    message.includes('没有完全合并') ||
    message.includes('尚未完全合并')
  );
}
