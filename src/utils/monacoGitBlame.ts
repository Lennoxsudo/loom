import { invoke } from '@tauri-apps/api/core';
import type * as Monaco from 'monaco-editor';

import type { GitBlameLine } from '../types/git';
import { isPathUnderRoot, toRelativePathUnderProject } from '../shared/lib/pathUtils';
import { formatBlameEpochDate } from './gitRefValidation';

const BLAME_GUTTER_BUCKETS = 8;

export function shortenBlameAuthor(author: string, maxLen = 22): string {
  const trimmed = author.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

export function formatBlameRelativeTime(epochStr: string, locale?: string): string {
  const n = Number(epochStr.trim());
  if (!Number.isFinite(n)) return '';
  const diffSec = Math.round((Date.now() - n * 1000) / 1000);
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const absSec = Math.abs(diffSec);
    if (absSec < 60) return rtf.format(-diffSec, 'second');
    const diffMin = Math.round(diffSec / 60);
    if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, 'minute');
    const diffHour = Math.round(diffSec / 3600);
    if (Math.abs(diffHour) < 24) return rtf.format(-diffHour, 'hour');
    const diffDay = Math.round(diffSec / 86400);
    if (Math.abs(diffDay) < 30) return rtf.format(-diffDay, 'day');
    const diffMonth = Math.round(diffSec / (86400 * 30));
    if (Math.abs(diffMonth) < 12) return rtf.format(-diffMonth, 'month');
    const diffYear = Math.round(diffSec / (86400 * 365));
    return rtf.format(-diffYear, 'year');
  } catch {
    return formatBlameEpochDate(epochStr);
  }
}

function blameGutterClass(commitHash: string): string {
  const bucket = parseInt(commitHash.slice(0, 8), 16) % BLAME_GUTTER_BUCKETS;
  return `monaco-git-blame-gutter-${bucket}`;
}

export function buildGitBlameDecorations(
  monaco: typeof Monaco,
  lines: GitBlameLine[],
  locale?: string
): Monaco.editor.IModelDeltaDecoration[] {
  return lines.map((line) => {
    const shortHash = line.commitHash.slice(0, 7);
    const relative = formatBlameRelativeTime(line.date, locale);
    const label = relative
      ? `${shortenBlameAuthor(line.author)} · ${relative}`
      : shortenBlameAuthor(line.author);
    const absolute = formatBlameEpochDate(line.date);

    return {
      range: new monaco.Range(line.lineNo, 1, line.lineNo, Number.MAX_SAFE_INTEGER),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: blameGutterClass(line.commitHash),
        after: {
          content: ` ${label}`,
          inlineClassName: 'monaco-git-blame-inline',
        },
        hoverMessage: {
          value: `**${line.author}**\n\n\`${shortHash}\` · ${absolute}`,
          isTrusted: true,
        },
      },
    };
  });
}

export async function fetchGitBlameLines(
  projectPath: string,
  filePath: string
): Promise<GitBlameLine[]> {
  const repo = projectPath.trim();
  const file = filePath.trim();
  if (!repo || !file) return [];
  if (!isPathUnderRoot(file, repo)) return [];

  const relativePath = toRelativePathUnderProject(file, repo);
  return invoke<GitBlameLine[]>('git_workspace_blame', {
    repoPath: repo,
    filePath: relativePath,
  });
}
