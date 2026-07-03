/** Git 面板路径展示：与资源管理器风格一致时在 Windows 下用反斜杠 */

const PATH_ELLIPSIS = '...';

export function gitPathPreferSeparators(repoRootNorm: string, relativePath: string): string {
  const p = relativePath.replace(/\\/g, '/');
  if (!repoRootNorm.includes('\\')) {
    return p;
  }
  return p.replace(/\//g, '\\');
}

/** 中段省略（单段过长或首尾拼接仍过长时回退） */

export function truncatePathMiddle(text: string, maxLen = 42): string {
  if (!text || text.length <= maxLen) {
    return text;
  }
  const reserve = maxLen - PATH_ELLIPSIS.length;
  if (reserve < 12) {
    return `${text.slice(0, Math.max(0, maxLen - PATH_ELLIPSIS.length))}${PATH_ELLIPSIS}`;
  }
  const front = Math.ceil(reserve * 0.45);
  const back = reserve - front;
  return `${text.slice(0, front)}${PATH_ELLIPSIS}${text.slice(-back)}`;
}

/** 目录层级 ≥3 时为完整「首段 + ... + 末段」（不按字符截断首尾） */
export function compactGitPathHeadTail(path: string): string {
  if (!path) {
    return path;
  }
  const sep = path.includes('\\') ? '\\' : '/';
  const segments = path.split(/[/\\]+/).filter((s) => s.length > 0);
  if (segments.length >= 3) {
    const head = segments[0]!;
    const tail = segments[segments.length - 1]!;
    return `${head}${sep}${PATH_ELLIPSIS}${sep}${tail}`;
  }
  return path;
}
