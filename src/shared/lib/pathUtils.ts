/**
 * 路径处理工具函数
 */

/** Fire-and-forget: record frontend path-containment denial in the audit log. */
function reportPathDenied(path: string, baseDir: string, reason: string): void {
  // Dynamic import so unit tests without a full Tauri mock do not break path checks.
  void import('@tauri-apps/api/core')
    .then((mod) => {
      const isTauriFn = (mod as { isTauri?: () => boolean }).isTauri;
      if (typeof isTauriFn === 'function' && !isTauriFn()) return;
      const invokeFn = (
        mod as {
          invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
        }
      ).invoke;
      if (typeof invokeFn !== 'function') return;
      return invokeFn('audit_path_denied', {
        path,
        reason: `${reason} (baseDir=${baseDir})`,
        accessMode: null,
        toolName: null,
        sessionId: null,
        executionId: null,
      });
    })
    .catch(() => {
      // non-critical — caller still throws
    });
}

/**
 * 获取文件/文件夹的基础名称（最后一个路径段）
 */
export function getBasename(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

/**
 * 规范化路径用于比较（统一使用反斜杠，移除尾部斜杠）
 */
export function normalizePathForCompare(p: string): string {
  return p.replace(/\//g, '\\').replace(/\\+$/g, '');
}

/**
 * 获取父目录路径
 */
export function getParentDir(p: string): string {
  const norm = normalizePathForCompare(p);
  const parts = norm.split('\\');
  if (parts.length <= 1) return norm;
  parts.pop();
  return parts.join('\\');
}

/**
 * 规范化换行符用于比较
 */
export function normalizeEolForCompare(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/**
 * 检查文件路径是否在根目录下
 * Windows 盘符路径按不区分大小写比较。
 */
export function isPathUnderRoot(filePath: string, root: string): boolean {
  let f = normalizePathForCompare(filePath);
  let r = normalizePathForCompare(root);
  if (!f || !r) return false;
  // Windows drive letter → case-insensitive
  if (/^[A-Za-z]:/.test(f) || /^[A-Za-z]:/.test(r)) {
    f = f.toLowerCase();
    r = r.toLowerCase();
  }
  if (f === r) return true;
  return f.startsWith(r + '\\');
}

/**
 * 判断是否为绝对路径（Windows 盘符 / UNC / Unix 根路径）
 */
export function isAbsolutePath(p: string): boolean {
  if (!p) return false;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (p.startsWith('\\\\')) return true;
  if (p.startsWith('/')) return true;
  return false;
}

/**
 * 词法展开 `.` / `..`（不访问磁盘），用于路径收口校验。
 */
export function normalizeLexicalPath(path: string): string {
  const isUnc = path.startsWith('\\\\');
  const hasDrive = /^[a-zA-Z]:/.test(path);
  const isUnixAbs = path.startsWith('/');
  const sep = path.includes('\\') || hasDrive || isUnc ? '\\' : '/';
  const raw = path.replace(/\//g, '\\');
  const parts = raw.split('\\').filter((s, i) => {
    if (s === '' && i === 0) return false;
    return true;
  });

  const out: string[] = [];
  // Preserve drive prefix
  let start = 0;
  if (hasDrive && parts[0]?.endsWith(':')) {
    out.push(parts[0]);
    start = 1;
  } else if (isUnc) {
    // UNC: \\server\share\...
    // After replace, leading empties were filtered — rebuild from original
  }

  for (let i = start; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..' && !out[out.length - 1]?.endsWith(':')) {
        out.pop();
      } else if (!hasDrive && !isUnixAbs) {
        out.push('..');
      }
      continue;
    }
    out.push(seg);
  }

  if (isUnc) {
    return '\\\\' + out.join('\\');
  }
  if (isUnixAbs && !hasDrive) {
    return '/' + out.join('/');
  }
  return out.join(sep === '\\' ? '\\' : '/');
}

/**
 * 在 baseDir 下安全解析路径：拒绝盘符/UNC 越界与 `../` 逃逸。
 *
 * 对以 `/` 开头的「伪绝对路径」（模型常写成 `/project/...`）会尽量映射回工作区，
 * 而不是一律拒绝——例如 `/loom` + base=`D:\...\loom` → 工作区根。
 */
export function resolveContainedPath(
  path: string,
  baseDir: string,
  options?: { allowExternalPaths?: boolean }
): string {
  const allowExternal = options?.allowExternalPaths ?? false;
  const base = baseDir.trim();
  if (!base) {
    throw new Error('baseDir is required for path containment');
  }
  const p = path.trim();
  if (!p) {
    throw new Error('path cannot be empty');
  }

  let candidate: string;
  if (isAbsolutePath(p)) {
    candidate = normalizeLexicalPath(p);
    if (isPathUnderRoot(candidate, base)) {
      return candidate;
    }
    if (allowExternal) {
      return candidate;
    }
    const remapped = remapPseudoAbsoluteUnderWorkspace(candidate, base);
    if (remapped && isPathUnderRoot(remapped, base)) {
      return remapped;
    }
    const message = `Path escapes workspace root: ${path}`;
    reportPathDenied(path, base, message);
    throw new Error(message);
  }

  const baseNorm = base.replace(/[\\/]+$/g, '');
  const rel = p.replace(/^[\\/]+/g, '');
  const sep = baseNorm.includes('\\') || /^[A-Za-z]:/.test(baseNorm) ? '\\' : '/';
  candidate = normalizeLexicalPath(`${baseNorm}${sep}${rel}`);

  if (!isPathUnderRoot(candidate, base)) {
    const message = `Path escapes workspace root: ${path}`;
    reportPathDenied(path, base, message);
    throw new Error(message);
  }
  return candidate;
}

/**
 * Soft-remap absolute-looking paths that are not real Windows/UNC targets.
 * Keeps real drive/UNC escapes rejected.
 */
function remapPseudoAbsoluteUnderWorkspace(absolutePath: string, baseDir: string): string | null {
  const trimmed = absolutePath.trim();
  // Keep real Windows drive / UNC escapes strict.
  if (/^[A-Za-z]:/.test(trimmed) || trimmed.startsWith('\\\\')) {
    return null;
  }
  // Only remap Unix-style absolute paths (`/foo/...`).
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const baseNorm = baseDir.replace(/[\\/]+$/g, '');
  const baseName = getBasename(normalizePathForCompare(baseNorm));
  const segs = trimmed.replace(/^\/+/, '').split('/').filter(Boolean);

  if (
    segs.length > 0 &&
    baseName &&
    segs[0].localeCompare(baseName, undefined, { sensitivity: 'accent' }) === 0
  ) {
    segs.shift();
  }

  const sep = baseNorm.includes('\\') || /^[A-Za-z]:/.test(baseNorm) ? '\\' : '/';
  if (segs.length === 0) {
    return normalizeLexicalPath(baseNorm);
  }
  const rel = segs.join(sep);
  return normalizeLexicalPath(`${baseNorm}${sep}${rel}`);
}

/**
 * 将文件路径转换为相对于项目根目录的 URL 路径
 */
export function toRelativeUrlPath(filePath: string, root: string): string | null {
  const f = normalizePathForCompare(filePath);
  const r = normalizePathForCompare(root);
  if (!isPathUnderRoot(f, r)) return null;

  let rel = f.slice(r.length);
  rel = rel.replace(/^\\+/, '');
  const segs = rel.split('\\').filter(Boolean);
  return segs.map(encodeURIComponent).join('/');
}

/**
 * 获取文件扩展名（小写）
 */
export function getExtLower(p: string): string {
  const base = getBasename(p);
  const parts = base.split('.');
  if (parts.length < 2) return '';
  return (parts.pop() || '').toLowerCase();
}

/**
 * 规范化为正斜杠路径
 */
export function normalizeToForwardSlash(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

/**
 * 将本地文件路径转换为 Monaco 可接受的 file URI
 */
export function toMonacoModelUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');

  if (/^[A-Za-z]:\//.test(normalized)) {
    return encodeURI(`file:///${normalized}`);
  }

  if (normalized.startsWith('//')) {
    return encodeURI(`file:${normalized}`);
  }

  if (normalized.startsWith('/')) {
    return encodeURI(`file://${normalized}`);
  }

  return encodeURI(`inmemory://${normalized}`);
}

/**
 * 将相对路径转换为项目根目录下的相对路径
 */
export function toRelativePathUnderProject(filePath: string, projectRoot: string): string {
  const f = normalizePathForCompare(filePath);
  const r = normalizePathForCompare(projectRoot);
  if (!f || !r) return normalizeToForwardSlash(filePath);
  if (!isPathUnderRoot(f, r)) return normalizeToForwardSlash(filePath);
  return normalizeToForwardSlash(f.slice(r.length).replace(/^\\+/, ''));
}
