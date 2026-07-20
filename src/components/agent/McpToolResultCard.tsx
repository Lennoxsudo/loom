import { memo, useMemo, useState, type CSSProperties } from 'react';
import type { ChatMessage } from '../../types/chat';
import { TOOL_RESULT_WIDTH, formatToolDisplayName } from './toolResultLayout';

interface McpToolResultCardProps {
  message: ChatMessage;
  statusLabel: string;
  failedLabel: string;
  summaryLabel: string;
  argumentsLabel: string;
  rawOutputLabel: string;
}

type SummaryEntry = {
  label: string;
  value: string;
};

function parseToolIdentity(toolName: string | undefined): {
  serverId: string;
  toolName: string;
} {
  const fallback = toolName || 'mcp_tool';
  if (!fallback.startsWith('mcp_')) {
    return { serverId: 'mcp', toolName: fallback };
  }

  const separatorIndex = fallback.indexOf('__');
  if (separatorIndex === -1) {
    return { serverId: fallback.slice(4), toolName: fallback };
  }

  return {
    serverId: fallback.slice(4, separatorIndex),
    toolName: fallback.slice(separatorIndex + 2),
  };
}

function looksLikeFailure(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('error') ||
    normalized.includes('failed') ||
    normalized.includes('exception') ||
    normalized.includes('denied') ||
    text.includes('错误') ||
    text.includes('失败') ||
    text.includes('异常')
  );
}

function parseStructuredOutput(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (
    !trimmed.startsWith('{') &&
    !trimmed.startsWith('[') &&
    !trimmed.startsWith('"') &&
    trimmed !== 'true' &&
    trimmed !== 'false' &&
    trimmed !== 'null' &&
    Number.isNaN(Number(trimmed))
  ) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value == null) return 'null';
  return JSON.stringify(value);
}

function toPreviewText(value: unknown, maxLength = 120): string {
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function collectSummaryEntries(data: unknown): SummaryEntry[] {
  if (Array.isArray(data)) {
    const firstItem = data[0];
    const items: SummaryEntry[] = [{ label: 'Items', value: String(data.length) }];
    if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
      items.push({
        label: 'Shape',
        value: `${Object.keys(firstItem as Record<string, unknown>).length} fields/item`,
      });
    }
    return items;
  }

  if (!data || typeof data !== 'object') {
    return [];
  }

  const record = data as Record<string, unknown>;
  const importantKeys = [
    'status',
    'message',
    'path',
    'uri',
    'resource',
    'name',
    'type',
    'count',
    'total',
    'matches',
    'files',
  ];

  const entries: SummaryEntry[] = [];
  for (const key of importantKeys) {
    const value = record[key];
    if (value == null) continue;

    if (Array.isArray(value)) {
      entries.push({ label: key, value: `${value.length} items` });
      continue;
    }

    if (typeof value === 'object') {
      entries.push({
        label: key,
        value: `${Object.keys(value as Record<string, unknown>).length} fields`,
      });
      continue;
    }

    entries.push({ label: key, value: toPreviewText(value, 64) });
  }

  if (entries.length > 0) {
    return entries.slice(0, 6);
  }

  return Object.entries(record)
    .filter(([, value]) => value == null || ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 6)
    .map(([key, value]) => ({ label: key, value: formatScalar(value) }));
}

function collectArgumentEntries(args: Record<string, unknown> | undefined): SummaryEntry[] {
  if (!args) return [];
  return Object.entries(args).map(([key, value]) => ({
    label: key,
    value: Array.isArray(value)
      ? `${value.length} items`
      : value && typeof value === 'object'
        ? JSON.stringify(value)
        : formatScalar(value),
  }));
}

const ChevronDown = ({ expanded }: { expanded: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
      transition: 'transform 0.2s ease',
    }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const McpToolResultCard = memo(function McpToolResultCard({
  message,
  statusLabel,
  failedLabel,
  summaryLabel,
  argumentsLabel,
  rawOutputLabel,
}: McpToolResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { serverId, toolName } = parseToolIdentity(message.tool_name);
  const isError = looksLikeFailure(message.text);
  const structuredOutput = useMemo(() => parseStructuredOutput(message.text), [message.text]);
  const summaryEntries = useMemo(
    () => collectSummaryEntries(structuredOutput),
    [structuredOutput]
  );
  const argumentEntries = useMemo(
    () => collectArgumentEntries(message.tool_args),
    [message.tool_args]
  );
  const rawOutput = useMemo(() => {
    if (structuredOutput == null) return message.text;
    return JSON.stringify(structuredOutput, null, 2);
  }, [message.text, structuredOutput]);

  const accent = isError ? '#f48771' : 'var(--text-accent)';
  const containerStyle: CSSProperties = {
    ...TOOL_RESULT_WIDTH,
    marginBottom: '6px',
  };

  const cardStyle: CSSProperties = {
    borderRadius: '10px',
    overflow: 'hidden',
    background:
      isError
        ? 'linear-gradient(180deg, rgba(244, 135, 113, 0.08) 0%, rgba(30, 30, 30, 0.96) 100%)'
        : 'linear-gradient(180deg, rgba(0, 122, 204, 0.07) 0%, rgba(30, 30, 30, 0.96) 100%)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderLeft: `3px solid ${accent}`,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
  };

  const headerButtonStyle: CSSProperties = {
    all: 'unset',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    width: '100%',
    padding: '12px 14px',
    cursor: 'pointer',
    boxSizing: 'border-box',
  };

  const sectionTitleStyle: CSSProperties = {
    fontSize: '11px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
    marginBottom: '8px',
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <button
          type="button"
          style={headerButtonStyle}
          onClick={() => setIsExpanded((value) => !value)}
          aria-expanded={isExpanded}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: 'var(--text-secondary)',
                }}
              >
                MCP
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '10px',
                  fontWeight: 600,
                  background: 'rgba(255, 255, 255, 0.04)',
                  color: '#d4d4d4',
                  fontFamily: 'Consolas, "Courier New", monospace',
                }}
              >
                {serverId}
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '10px',
                  fontWeight: 600,
                  background: isError ? 'rgba(244, 135, 113, 0.14)' : 'rgba(0, 122, 204, 0.16)',
                  color: accent,
                }}
              >
                {isError ? failedLabel : statusLabel}
              </span>
            </div>
            <div
              style={{
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 600,
                fontFamily: 'Consolas, "Courier New", monospace',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {formatToolDisplayName(toolName)}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)' }}>
            {summaryEntries[0] && (
              <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
                {summaryEntries[0].label}: {summaryEntries[0].value}
              </span>
            )}
            <ChevronDown expanded={isExpanded} />
          </div>
        </button>

        <div
          style={{
            display: 'grid',
            gridTemplateRows: isExpanded ? '1fr' : '0fr',
            transition: 'grid-template-rows 0.25s ease',
          }}
          aria-hidden={!isExpanded}
        >
          <div
            style={{
              minHeight: 0,
              overflow: 'hidden',
              opacity: isExpanded ? 1 : 0,
              padding: isExpanded ? '0 14px 14px' : '0 14px 0',
              pointerEvents: isExpanded ? 'auto' : 'none',
              transition: 'opacity 0.18s ease, padding 0.25s ease',
            }}
          >
            {summaryEntries.length > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <div style={sectionTitleStyle}>{summaryLabel}</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: '8px',
                  }}
                >
                  {summaryEntries.map((entry) => (
                    <div
                      key={`${entry.label}-${entry.value}`}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                        {entry.label}
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-primary)',
                          lineHeight: 1.5,
                          wordBreak: 'break-word',
                        }}
                      >
                        {entry.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {argumentEntries.length > 0 && (
              <div style={{ marginBottom: '14px' }}>
                <div style={sectionTitleStyle}>{argumentsLabel}</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(120px, 180px) minmax(0, 1fr)',
                    gap: '8px 12px',
                    padding: '12px',
                    borderRadius: '8px',
                    background: 'rgba(0, 0, 0, 0.14)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                >
                  {argumentEntries.map((entry) => (
                    <FragmentRow key={entry.label} label={entry.label} value={entry.value} />
                  ))}
                </div>
              </div>
            )}

            <div>
              <div style={sectionTitleStyle}>{rawOutputLabel}</div>
              <pre
                style={{
                  margin: 0,
                  padding: '12px',
                  maxHeight: '220px',
                  overflow: 'auto',
                  borderRadius: '8px',
                  background: 'rgba(0, 0, 0, 0.22)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  color: '#d4d4d4',
                  fontSize: '12px',
                  lineHeight: 1.6,
                  fontFamily: 'Consolas, "Courier New", monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {rawOutput}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

function FragmentRow({ label, value }: SummaryEntry) {
  return (
    <>
      <div
        style={{
          color: 'var(--text-secondary)',
          fontSize: '11px',
          fontFamily: 'Consolas, "Courier New", monospace',
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: 'var(--text-primary)',
          fontSize: '12px',
          lineHeight: 1.5,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </div>
    </>
  );
}

export default McpToolResultCard;
