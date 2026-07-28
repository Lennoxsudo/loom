/**
 * Extract read-tool file paths from messages for compact summaries.
 * @module compact/readFilePaths
 */

import type { CompactableMessage } from './types';

const READ_TOOL_NAMES = new Set(['read', 'read_file']);
const READ_OUTPUT_PATH_RE = /^文件内容\s*\(([^)]+)\)\s*:/gm;
const BINARY_FILE_RE = /^文件是二进制:\s*(.+?)(?:\n|$)/gm;

function readMessageText(msg: CompactableMessage): string {
  if (typeof msg.text === 'string') return msg.text;
  if (typeof msg.content === 'string') return msg.content;
  return '';
}

function parseReadPathFromArgs(argsJson: string | undefined): string[] {
  if (!argsJson) return [];
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    const path = args.path ?? args.file_path ?? args.filePath;
    if (typeof path === 'string' && path.trim()) return [path.trim()];
    if (Array.isArray(path)) {
      return path
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
        .map((p) => p.trim());
    }
  } catch {
    // ignore malformed tool args
  }
  return [];
}

function addPath(paths: string[], seen: Set<string>, raw: string): void {
  const normalized = raw.trim();
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  paths.push(normalized);
}

/**
 * Collect unique file paths from read tool calls and read tool results.
 */
export function collectReadFilePathsFromMessages(messages: CompactableMessage[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const fn = (tc as { function?: { name?: string; arguments?: string } }).function;
        if (!fn?.name || !READ_TOOL_NAMES.has(fn.name)) continue;
        for (const path of parseReadPathFromArgs(fn.arguments)) {
          addPath(paths, seen, path);
        }
      }
    }

    if (msg.role !== 'tool') continue;

    const toolName = typeof msg.tool_name === 'string' ? msg.tool_name : '';
    if (toolName && !READ_TOOL_NAMES.has(toolName)) continue;

    const text = readMessageText(msg);
    if (!text) continue;

    READ_OUTPUT_PATH_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = READ_OUTPUT_PATH_RE.exec(text)) !== null) {
      addPath(paths, seen, match[1]);
    }

    BINARY_FILE_RE.lastIndex = 0;
    while ((match = BINARY_FILE_RE.exec(text)) !== null) {
      addPath(paths, seen, match[1]);
    }
  }

  return paths;
}

const FILES_READ_SECTION = '## Files Read';

/**
 * Append a deterministic read-files section when not already present.
 */
export function appendReadFilesSection(summaryText: string, paths: string[]): string {
  if (paths.length === 0 || summaryText.includes(FILES_READ_SECTION)) {
    return summaryText;
  }

  return `${summaryText.trimEnd()}\n\n${FILES_READ_SECTION}\n${paths.map((p) => `- ${p}`).join('\n')}`;
}
