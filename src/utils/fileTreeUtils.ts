/**
 * 文件树工具函数
 */

import type { FileNode } from '../components/FileTree';
import { getExtLower, normalizeToForwardSlash, toRelativePathUnderProject } from './pathUtils';

/**
 * 支持的图片扩展名
 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

/**
 * 检查文件路径是否为图片
 */
export function isImageFilePath(p: string): boolean {
  return IMAGE_EXTS.has(getExtLower(p));
}

/**
 * 将 glob 模式转换为正则表达式
 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\\\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * 排除模式匹配器
 */
export interface ExcludeMatcher {
  raw: string;
  normalized: string;
  hasWildcard: boolean;
  hasPathSep: boolean;
  regex: RegExp;
}

/**
 * 构建排除模式匹配器列表
 */
export function buildExcludeMatchers(patterns: string[]): ExcludeMatcher[] {
  return patterns
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0)
    .map((raw) => {
      const normalized = normalizeToForwardSlash(raw);
      return {
        raw,
        normalized,
        hasWildcard: raw.includes('*') || raw.includes('?'),
        hasPathSep: normalized.includes('/'),
        regex: globToRegExp(normalized),
      };
    });
}

/**
 * 检查文件节点是否应被排除
 */
function shouldExcludeFileNode(
  nodePath: string,
  nodeName: string,
  projectRoot: string,
  matchers: ExcludeMatcher[]
): boolean {
  if (matchers.length === 0) return false;

  const relPath = toRelativePathUnderProject(nodePath, projectRoot);
  const relPathLower = relPath.toLowerCase();
  const baseLower = nodeName.toLowerCase();
  const segments = relPathLower.split('/').filter(Boolean);

  for (const matcher of matchers) {
    const m = matcher.normalized.toLowerCase();

    if (matcher.hasPathSep) {
      if (matcher.regex.test(relPathLower)) return true;
      if (!matcher.hasWildcard && (relPathLower === m || relPathLower.startsWith(`${m}/`)))
        return true;
      continue;
    }

    if (matcher.regex.test(baseLower)) return true;
    if (!matcher.hasWildcard && segments.includes(m)) return true;
  }

  return false;
}

/**
 * 根据排除模式过滤文件树
 */
export function filterFileTreeByExcludePatterns(
  nodes: FileNode[],
  projectRoot: string,
  matchers: ExcludeMatcher[]
): FileNode[] {
  let changed = false;
  const out: FileNode[] = [];

  for (const node of nodes) {
    if (shouldExcludeFileNode(node.path, node.name, projectRoot, matchers)) {
      changed = true;
      continue;
    }

    let nextNode = node;
    if (node.is_dir && node.children && node.children.length > 0) {
      const nextChildren = filterFileTreeByExcludePatterns(node.children, projectRoot, matchers);
      if (nextChildren !== node.children) {
        changed = true;
        nextNode = { ...node, children: nextChildren };
      }
    }

    out.push(nextNode);
  }

  return changed ? out : nodes;
}

/**
 * 文本比较函数
 */
function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * 文件节点比较函数
 */
function compareFileNodes(
  a: FileNode,
  b: FileNode,
  sortBy: 'name' | 'type' | 'modified',
  foldersFirst: boolean
): number {
  if (foldersFirst && a.is_dir !== b.is_dir) {
    return a.is_dir ? -1 : 1;
  }

  if (sortBy === 'modified') {
    const am = typeof (a as { modified_at?: number }).modified_at === 'number' ? (a as { modified_at?: number }).modified_at : 0;
    const bm = typeof (b as { modified_at?: number }).modified_at === 'number' ? (b as { modified_at?: number }).modified_at : 0;
    if (am !== bm) return (bm ?? 0) - (am ?? 0);
    return compareText(a.name, b.name);
  }

  if (sortBy === 'type') {
    const aExt = a.is_dir ? '' : getExtLower(a.name);
    const bExt = b.is_dir ? '' : getExtLower(b.name);
    const extCmp = compareText(aExt, bExt);
    if (extCmp !== 0) return extCmp;
    return compareText(a.name, b.name);
  }

  return compareText(a.name, b.name);
}

/**
 * 对文件树节点进行排序
 */
export function sortFileTreeNodes(
  nodes: FileNode[],
  sortBy: 'name' | 'type' | 'modified',
  foldersFirst: boolean
): FileNode[] {
  const next = nodes.map((node) => {
    if (node.is_dir && node.children && node.children.length > 0) {
      return {
        ...node,
        children: sortFileTreeNodes(node.children, sortBy, foldersFirst),
      };
    }
    return node;
  });

  next.sort((a, b) => compareFileNodes(a, b, sortBy, foldersFirst));
  return next;
}

/**
 * 在文件树中查找节点
 */
export function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.is_dir && node.children) {
      const found = findNodeByPath(node.children, path);
      if (found) return found;
    }
  }
  return null;
}
