import type { CSSProperties } from 'react';

/** Full-width row aligned with ThinkingBlock column width */
export const TOOL_RESULT_WIDTH: CSSProperties = {
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box',
};

export function parseMcpToolName(
  toolName: string
): { serverId: string; toolName: string } | null {
  if (!toolName.startsWith('mcp_')) return null;
  const rest = toolName.slice('mcp_'.length);
  const sep = rest.indexOf('__');
  if (sep <= 0) return null;
  const serverId = rest.slice(0, sep);
  const name = rest.slice(sep + 2);
  if (!serverId || !name) return null;
  return { serverId, toolName: name };
}

export function stripMcpToolPrefix(toolName: string): string {
  return parseMcpToolName(toolName)?.toolName ?? toolName.replace(/^mcp_[^_]+__/, '');
}

export function formatToolDisplayName(toolName: string | undefined, fallback = 'Tool'): string {
  const raw = stripMcpToolPrefix((toolName || fallback).trim());
  if (!raw) return fallback;
  const spaced = raw.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function toolCompactShell(marginBottom: string, extra?: CSSProperties): CSSProperties {
  return {
    ...TOOL_RESULT_WIDTH,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom,
    fontSize: '12px',
    ...extra,
  };
}

export function toolCardShell(marginBottom: string, extra?: CSSProperties): CSSProperties {
  return {
    ...TOOL_RESULT_WIDTH,
    marginBottom,
    ...extra,
  };
}
