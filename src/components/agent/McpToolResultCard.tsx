import { memo, useMemo, useState } from 'react';
import type { ChatMessage } from '../../types/chat';
import { TOOL_RESULT_WIDTH, formatToolDisplayName } from './toolResultLayout';
import styles from './McpToolResultCard.module.css';

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
  const summaryEntries = useMemo(() => collectSummaryEntries(structuredOutput), [structuredOutput]);
  const argumentEntries = useMemo(
    () => collectArgumentEntries(message.tool_args),
    [message.tool_args]
  );
  const rawOutput = useMemo(() => {
    if (structuredOutput == null) return message.text;
    return JSON.stringify(structuredOutput, null, 2);
  }, [message.text, structuredOutput]);

  return (
    <div style={TOOL_RESULT_WIDTH}>
      <div className={`${styles.card} ${isError ? styles.cardError : ''}`}>
        <button
          type="button"
          className={styles.header}
          onClick={() => setIsExpanded((value) => !value)}
          aria-expanded={isExpanded}
        >
          <div className={styles.headerMain}>
            <div className={styles.toolName}>{formatToolDisplayName(toolName)}</div>
            <div className={styles.meta}>
              <span className={styles.metaItem}>MCP</span>
              <span className={styles.metaSep} aria-hidden />
              <span className={styles.metaItem}>{serverId}</span>
            </div>
          </div>
          <div className={styles.headerAside}>
            <span
              className={`${styles.status} ${isError ? styles.statusError : styles.statusOk}`}
            >
              {isError ? failedLabel : statusLabel}
            </span>
            <span
              className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ''}`}
              aria-hidden
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>
        </button>

        <div
          className={`${styles.panel} ${isExpanded ? styles.panelExpanded : ''}`}
          aria-hidden={!isExpanded}
        >
          <div className={`${styles.panelInner} ${isExpanded ? styles.panelInnerExpanded : ''}`}>
            {summaryEntries.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>{summaryLabel}</div>
                <div className={styles.summaryGrid}>
                  {summaryEntries.map((entry) => (
                    <div key={`${entry.label}-${entry.value}`} className={styles.summaryCard}>
                      <div className={styles.summaryLabel}>{entry.label}</div>
                      <div className={styles.summaryValue}>{entry.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {argumentEntries.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>{argumentsLabel}</div>
                <div className={styles.argsGrid}>
                  {argumentEntries.map((entry) => (
                    <FragmentRow key={entry.label} label={entry.label} value={entry.value} />
                  ))}
                </div>
              </div>
            )}

            <div className={styles.section}>
              <div className={styles.sectionTitle}>{rawOutputLabel}</div>
              <pre className={styles.rawOutput}>{rawOutput}</pre>
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
      <div className={styles.argLabel}>{label}</div>
      <div className={styles.argValue}>{value}</div>
    </>
  );
}

export default McpToolResultCard;
