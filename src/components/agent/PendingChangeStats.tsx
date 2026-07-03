import { useMemo } from 'react';
import { computePendingChangeLineStats } from './pendingChangeStatsUtils';

interface PendingChangeStatsProps {
  beforeContent: string | null;
  afterContent: string;
  toolName: string;
  oldSnippet?: string;
  newSnippet?: string;
}

export default function PendingChangeStats({
  beforeContent,
  afterContent,
  toolName,
  oldSnippet,
  newSnippet,
}: PendingChangeStatsProps) {
  const stats = useMemo(
    () =>
      computePendingChangeLineStats({
        beforeContent,
        afterContent,
        toolName,
        oldSnippet,
        newSnippet,
      }),
    [beforeContent, afterContent, toolName, oldSnippet, newSnippet]
  );

  if (stats.added === 0 && stats.removed === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        gap: '6px',
        fontSize: '11px',
        fontFamily: 'var(--font-mono, monospace)',
        flexShrink: 0,
        opacity: 0.92,
      }}
    >
      {stats.added > 0 && (
        <span style={{ color: 'color-mix(in srgb, #2f9e44 82%, var(--text-primary))' }}>+{stats.added}</span>
      )}
      {stats.removed > 0 && (
        <span style={{ color: 'var(--text-error)' }}>-{stats.removed}</span>
      )}
    </div>
  );
}
