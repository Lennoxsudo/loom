/**
 * Helpers for rolling back AI file mutations (pending changes + checkpoints).
 */

export function isMissingPathRollbackError(error: unknown): boolean {
  const text = String(error).toLowerCase();
  return (
    text.includes('path does not exist') ||
    text.includes('folder does not exist') ||
    text.includes('no such file or directory') ||
    text.includes('cannot find the path') ||
    text.includes('cannot find the file') ||
    text.includes('系统找不到指定的路径') ||
    text.includes('找不到指定的路径') ||
    text.includes('文件不存在') ||
    text.includes('路径不存在')
  );
}

/** Paths touched by a checkpoint restore that the file tree / editor should refresh. */
export function collectRestoredPaths(result: {
  restoredFiles?: string[];
  deletedFiles?: string[];
}): string[] {
  const paths = [...(result.restoredFiles ?? []), ...(result.deletedFiles ?? [])];
  return paths.filter((p) => typeof p === 'string' && p.trim().length > 0);
}
