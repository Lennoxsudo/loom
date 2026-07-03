/**
 * 路径处理工具函数
 */

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
 */
export function isPathUnderRoot(filePath: string, root: string): boolean {
  const f = normalizePathForCompare(filePath);
  const r = normalizePathForCompare(root);
  if (!f || !r) return false;
  if (f === r) return true;
  return f.startsWith(r + '\\');
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
