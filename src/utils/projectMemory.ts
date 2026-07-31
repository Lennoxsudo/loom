/**
 * Project convention memory (~/.loom/memory/{projectKey}/*.md)
 *
 * Short, reviewable project conventions injected into Agent / subagent context.
 * Distinct from Agent Rules (global) and AGENTS.md (human docs).
 */

import { invoke } from '@tauri-apps/api/core';
import { hashString } from '../hooks/useContextInjectionState';
import { getProjectsIndex, projectStorageKey } from './agentPersistence';

export const MEMORY_DIR_NAME = 'memory';
export const MAX_MEMORY_ENTRIES = 30;
export const MAX_MEMORY_BODY_CHARS = 1500;
export const MAX_MEMORY_INJECT_CHARS = 8000;

const MEMORY_START_TAG = '[Project Memory]';
const MEMORY_END_TAG = '[End Project Memory]';

export interface ProjectMemoryEntry {
  id: string;
  title: string;
  body: string;
  tags: string[];
  source: 'agent' | 'user';
  updatedAt: string;
  filePath: string;
}

export interface ProjectMemoryGroup {
  projectKey: string;
  projectPath: string;
  displayName: string;
  memoryDir: string;
  entries: ProjectMemoryEntry[];
}

function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') ? '\\' : '/';
  const trimmedBase = base.replace(/[\\/]+$/, '');
  return [trimmedBase, ...parts.map((p) => p.replace(/^[\\/]+|[\\/]+$/g, ''))].join(sep);
}

function projectDisplayName(projectPath: string, projectKey: string): string {
  const parts = projectPath.split(/[\\/]/).filter(Boolean);
  if (parts.length > 0) return parts[parts.length - 1]!;
  return projectKey.length > 12 ? `${projectKey.slice(0, 8)}…` : projectKey || 'unknown';
}

let _dotConfigPath: string | null = null;

async function getDotConfigPath(): Promise<string> {
  if (_dotConfigPath) return _dotConfigPath;
  try {
    const path = await invoke<string>('get_dot_config_path');
    _dotConfigPath = typeof path === 'string' && path.length > 0 ? path : '';
  } catch {
    _dotConfigPath = '';
  }
  return _dotConfigPath ?? '';
}

/** Resolve ~/.loom/memory/{projectKey} for a project path. */
export async function getMemoryDir(projectPath: string): Promise<string> {
  const root = projectPath.trim();
  if (!root) return '';
  const [dotConfig, projectKey] = await Promise.all([getDotConfigPath(), projectStorageKey(root)]);
  if (!dotConfig || !projectKey) return '';
  return joinPath(dotConfig, MEMORY_DIR_NAME, projectKey);
}

/** Sanitize id to safe filename stem (kebab-case, a-z0-9-). */
export function slugifyMemoryId(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || `memory-${Date.now().toString(36)}`;
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((t) => t.trim()).filter(Boolean);
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function parseMemoryMarkdown(raw: string, filePath: string): ProjectMemoryEntry | null {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const yaml = match?.[1] ?? '';
  const body = (match ? raw.slice(match[0].length) : raw).trim();
  if (!body) return null;

  const fields: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    fields[trimmed.slice(0, colonIdx).trim()] = trimmed.slice(colonIdx + 1).trim();
  }

  const fileStem =
    filePath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.md$/i, '') ?? '';
  const id = slugifyMemoryId(fields.id || fileStem);
  const title = (fields.title || id).replace(/^['"]|['"]$/g, '').trim() || id;
  const source = fields.source === 'user' ? 'user' : 'agent';
  const updatedAt = fields.updatedAt || fields.updated_at || new Date().toISOString();

  return {
    id,
    title,
    body: body.slice(0, MAX_MEMORY_BODY_CHARS),
    tags: parseTags(fields.tags),
    source,
    updatedAt,
    filePath,
  };
}

export function serializeMemoryEntry(
  entry: Pick<ProjectMemoryEntry, 'id' | 'title' | 'body' | 'tags' | 'source' | 'updatedAt'>
): string {
  const tags =
    entry.tags.length > 0 ? entry.tags.map((t) => t.trim()).filter(Boolean).join(', ') : '';
  const lines = [
    '---',
    `id: ${entry.id}`,
    `title: ${entry.title}`,
    tags ? `tags: ${tags}` : null,
    `source: ${entry.source}`,
    `updatedAt: ${entry.updatedAt}`,
    '---',
    '',
    entry.body.trim(),
    '',
  ].filter((line) => line !== null) as string[];
  return lines.join('\n');
}

async function loadEntriesFromMemoryDir(memoryDir: string): Promise<ProjectMemoryEntry[]> {
  if (!memoryDir.trim()) return [];

  let paths: string[] = [];
  try {
    paths = await invoke<string[]>('glob_search_files', {
      rootPath: memoryDir,
      pattern: '*.md',
      maxResults: MAX_MEMORY_ENTRIES * 2,
      maxDepth: 1,
    });
  } catch {
    return [];
  }

  const entries: ProjectMemoryEntry[] = [];
  for (const filePath of paths) {
    const base = filePath.split(/[\\/]/).pop() ?? '';
    if (base.toLowerCase() === 'readme.md') continue;
    try {
      const raw = await invoke<string>('read_file_content', { filePath });
      const parsed = parseMemoryMarkdown(raw ?? '', filePath);
      if (parsed) entries.push(parsed);
    } catch {
      // skip unreadable
    }
  }

  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return entries.slice(0, MAX_MEMORY_ENTRIES);
}

/** Load memory entries from ~/.loom/memory/{projectKey}/*.md (newest first, capped). */
export async function loadProjectMemoryEntries(projectPath: string): Promise<ProjectMemoryEntry[]> {
  const memoryDir = await getMemoryDir(projectPath);
  return loadEntriesFromMemoryDir(memoryDir);
}

/** List all ~/.loom/memory/{key} groups, resolved via projects-index. */
export async function listAllProjectMemoryGroups(
  preferProjectPath?: string
): Promise<ProjectMemoryGroup[]> {
  const dotConfig = await getDotConfigPath();
  if (!dotConfig) return [];

  const memoryRoot = joinPath(dotConfig, MEMORY_DIR_NAME);
  let dirNames: string[] = [];
  try {
    const nodes = await invoke<Array<{ name: string; is_dir: boolean }>>('read_folder_children', {
      folderPath: memoryRoot,
    });
    dirNames = nodes.filter((n) => n.is_dir).map((n) => n.name);
  } catch {
    dirNames = [];
  }

  let pathByKey = new Map<string, string>();
  try {
    const index = await getProjectsIndex();
    pathByKey = new Map((index.projects ?? []).map((p) => [p.key, p.path]));
  } catch {
    pathByKey = new Map();
  }

  const prefer = preferProjectPath?.trim() || '';
  const keySet = new Set(dirNames);
  if (prefer) {
    try {
      keySet.add(await projectStorageKey(prefer));
    } catch {
      // ignore
    }
  }

  const groups: ProjectMemoryGroup[] = [];
  for (const projectKey of keySet) {
    const memoryDir = joinPath(memoryRoot, projectKey);
    const entries = await loadEntriesFromMemoryDir(memoryDir);

    let projectPath = pathByKey.get(projectKey) ?? '';
    if (!projectPath && prefer) {
      try {
        if ((await projectStorageKey(prefer)) === projectKey) projectPath = prefer;
      } catch {
        // ignore
      }
    }

    const isPreferredEmpty = Boolean(prefer && projectPath === prefer && entries.length === 0);
    if (entries.length === 0 && !isPreferredEmpty) continue;

    groups.push({
      projectKey,
      projectPath,
      displayName: projectDisplayName(projectPath, projectKey),
      memoryDir,
      entries,
    });
  }

  groups.sort((a, b) => {
    if (prefer) {
      const aCur = a.projectPath === prefer ? 0 : 1;
      const bCur = b.projectPath === prefer ? 0 : 1;
      if (aCur !== bCur) return aCur - bCur;
    }
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
  });
  return groups;
}

/** Format entries for prompt injection; empty if none. */
export function formatProjectMemoryContext(entries: ProjectMemoryEntry[]): string {
  if (entries.length === 0) return '';

  const blocks: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const tagSuffix = entry.tags.length ? ` [${entry.tags.join(', ')}]` : '';
    const block = `### ${entry.title}${tagSuffix}\n${entry.body.trim()}`;
    if (used + block.length + 2 > MAX_MEMORY_INJECT_CHARS) {
      blocks.push('_…additional memory entries omitted (budget)_');
      break;
    }
    blocks.push(block);
    used += block.length + 2;
  }

  if (blocks.length === 0) return '';
  return `${MEMORY_START_TAG}\nStable project conventions (prefer AGENTS.md / user Rules when they conflict):\n\n${blocks.join('\n\n')}\n${MEMORY_END_TAG}`;
}

export async function loadProjectMemoryContext(projectPath: string): Promise<string> {
  const entries = await loadProjectMemoryEntries(projectPath);
  return formatProjectMemoryContext(entries);
}

export function getProjectMemoryContentHash(contextText: string): string {
  if (!contextText.trim()) return '';
  return hashString(contextText);
}

export function shouldInjectProjectMemory(
  memoryText: string,
  alreadyInjected: boolean,
  prevContentHash?: string
): boolean {
  if (!memoryText.trim()) return false;
  if (!alreadyInjected) return true;
  if (prevContentHash !== undefined) {
    return getProjectMemoryContentHash(memoryText) !== prevContentHash;
  }
  return false;
}

export function prependProjectMemoryToFirstUserMessage<
  T extends { role: string; content: unknown },
>(requestMessages: T[], memoryText: string): boolean {
  const text = memoryText.trim();
  if (!text) return false;

  const firstUserIdx = requestMessages.findIndex((m) => m.role === 'user');
  if (firstUserIdx < 0) return false;

  const firstUser = requestMessages[firstUserIdx];
  const originalContent = typeof firstUser.content === 'string' ? firstUser.content : '';
  requestMessages[firstUserIdx] = {
    ...firstUser,
    content: `${text}\n\n${originalContent}`,
  };
  return true;
}

export async function upsertProjectMemory(
  projectPath: string,
  input: { id?: string; title: string; body: string; tags?: string[] }
): Promise<ProjectMemoryEntry> {
  const root = projectPath.trim();
  if (!root) throw new Error('No project path');

  const title = input.title.trim();
  const body = input.body.trim().slice(0, MAX_MEMORY_BODY_CHARS);
  if (!title) throw new Error('title is required');
  if (!body) throw new Error('body is required');

  const memoryDir = await getMemoryDir(root);
  if (!memoryDir) throw new Error('Unable to resolve memory directory');

  const id = slugifyMemoryId(input.id || title);
  const entry: ProjectMemoryEntry = {
    id,
    title,
    body,
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
    source: 'agent',
    updatedAt: new Date().toISOString(),
    filePath: joinPath(memoryDir, `${id}.md`),
  };

  const existing = await loadProjectMemoryEntries(root);
  const withoutSelf = existing.filter((e) => e.id !== id);
  if (withoutSelf.length >= MAX_MEMORY_ENTRIES) {
    throw new Error(`Memory limit reached (${MAX_MEMORY_ENTRIES}). Delete an entry first.`);
  }

  await invoke('write_file_content', {
    filePath: entry.filePath,
    content: serializeMemoryEntry(entry),
  });

  return entry;
}

export async function deleteProjectMemory(projectPath: string, id: string): Promise<boolean> {
  const root = projectPath.trim();
  const memoryId = slugifyMemoryId(id);
  if (!root || !memoryId) return false;

  const memoryDir = await getMemoryDir(root);
  if (!memoryDir) return false;

  const filePath = joinPath(memoryDir, `${memoryId}.md`);
  try {
    await invoke('delete_file_or_folder', {
      path: filePath,
      permanent: true,
    });
    return true;
  } catch {
    const entries = await loadProjectMemoryEntries(root);
    const match = entries.find((e) => e.id === memoryId);
    if (!match) return false;
    await invoke('delete_file_or_folder', {
      path: match.filePath,
      permanent: true,
    });
    return true;
  }
}

/** Delete a memory entry by absolute file path (orphan groups without projectPath). */
export async function deleteProjectMemoryByFilePath(filePath: string): Promise<boolean> {
  const path = filePath.trim();
  if (!path) return false;
  try {
    await invoke('delete_file_or_folder', {
      path,
      permanent: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** Remove ~/.loom/memory/{projectKey} when a workspace project is deleted. */
export async function deleteAllProjectMemory(projectPath: string): Promise<void> {
  const memoryDir = await getMemoryDir(projectPath);
  if (!memoryDir) return;
  try {
    await invoke('delete_file_or_folder', {
      path: memoryDir,
      permanent: true,
    });
  } catch {
    // missing dir or non-Tauri — ignore
  }
}

export async function getProjectMemoryEntry(
  projectPath: string,
  id: string
): Promise<ProjectMemoryEntry | null> {
  const entries = await loadProjectMemoryEntries(projectPath);
  const memoryId = slugifyMemoryId(id);
  return entries.find((e) => e.id === memoryId) ?? null;
}
