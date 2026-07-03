import type { CSSProperties } from 'react';

/** Full-width row aligned with ThinkingBlock column width */
export const TOOL_RESULT_WIDTH: CSSProperties = {
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box',
};

export function stripMcpToolPrefix(toolName: string): string {
  return toolName.replace(/^mcp_[^_]+__/, '');
}

export function formatToolDisplayName(toolName: string | undefined, fallback = 'Tool'): string {
  const raw = stripMcpToolPrefix((toolName || fallback).trim());
  if (!raw) return fallback;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function toolCompactShell(
  marginBottom: string,
  extra?: CSSProperties
): CSSProperties {
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

export function toolCardShell(
  marginBottom: string,
  extra?: CSSProperties
): CSSProperties {
  return {
    ...TOOL_RESULT_WIDTH,
    marginBottom,
    ...extra,
  };
}
