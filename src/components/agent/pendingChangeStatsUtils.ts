import { diffLines } from 'diff';
import type { PendingFileChange } from './utils';

export interface PendingChangeLineStats {
  added: number;
  removed: number;
}

export interface PendingChangeLineStatsSummary extends PendingChangeLineStats {
  fileCount: number;
}

export function computePendingChangeLineStats(input: {
  beforeContent: string | null;
  afterContent: string;
  toolName: string;
  oldSnippet?: string;
  newSnippet?: string;
}): PendingChangeLineStats {
  const { beforeContent, afterContent, toolName, oldSnippet, newSnippet } = input;
  let added = 0;
  let removed = 0;

  if (!beforeContent) {
    if (
      (toolName === 'edit' || toolName === 'edit_file') &&
      typeof oldSnippet === 'string' &&
      typeof newSnippet === 'string'
    ) {
      const d = diffLines(oldSnippet, newSnippet);
      for (const part of d) {
        if (part.added) added += part.count || 0;
        if (part.removed) removed += part.count || 0;
      }
    } else {
      added = afterContent ? afterContent.split('\n').length : 0;
    }
  } else if (!afterContent) {
    removed = beforeContent ? beforeContent.split('\n').length : 0;
  } else {
    const d = diffLines(beforeContent, afterContent);
    for (const part of d) {
      if (part.added) added += part.count || 0;
      if (part.removed) removed += part.count || 0;
    }
  }

  return { added, removed };
}

export function computePendingChangeLineStatsFromChange(
  change: PendingFileChange
): PendingChangeLineStats {
  return computePendingChangeLineStats({
    beforeContent: change.beforeContent,
    afterContent: change.afterContent,
    toolName: change.toolName,
    oldSnippet: change.oldSnippet,
    newSnippet: change.newSnippet,
  });
}

export function sumPendingChangeLineStats(
  changes: PendingFileChange[]
): PendingChangeLineStatsSummary {
  return changes.reduce(
    (acc, change) => {
      const stats = computePendingChangeLineStatsFromChange(change);
      return {
        added: acc.added + stats.added,
        removed: acc.removed + stats.removed,
        fileCount: acc.fileCount + 1,
      };
    },
    { added: 0, removed: 0, fileCount: 0 }
  );
}
