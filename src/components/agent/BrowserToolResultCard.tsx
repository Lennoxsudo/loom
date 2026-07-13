/**
 * BrowserToolResultCard — browser / fetch 结果展示
 */

import { memo, useState } from 'react';
import type { ChatMessage } from '../../types/chat';
import styles from './BrowserToolResultCard.module.css';

interface BrowserToolResultCardProps {
  message: ChatMessage;
}

function extractHost(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      return `${parsed.hostname}:${parsed.port}`;
    }
    return parsed.hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function parseFetchOutput(text: string): {
  source: string;
  status: string;
  size: string;
  body: string;
} {
  const sourceMatch = text.match(/来源:\s*(.+?)(?:\n|$)/);
  const statusMatch = text.match(/状态:\s*(.+?)(?:\n|$)/);
  const sizeMatch = text.match(/大小:\s*(.+?)(?:\n|$)/);

  const headerEndIdx = text.indexOf('---');
  const body = headerEndIdx !== -1 ? text.slice(headerEndIdx + 3).trim() : text;

  return {
    source: sourceMatch?.[1]?.trim() || '',
    status: statusMatch?.[1]?.trim() || '',
    size: sizeMatch?.[1]?.trim() || '',
    body,
  };
}

function statusCode(status: string): string {
  return status.split(/\s+/)[0] || status;
}

function isSuccessStatus(code: string): boolean {
  return /^[23]\d{2}$/.test(code);
}

const BrowserToolResultCard = memo(function BrowserToolResultCard({
  message,
}: BrowserToolResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toolName = message.tool_name || '';
  const isError = message.isError === true
    || message.text.startsWith('❌')
    || message.text.includes('错误:')
    || message.text.includes('执行失败')
    || message.text.toLowerCase().includes('failed')
    || message.text.toLowerCase().includes('error:');

  const isControlBrowser = toolName === 'control_browser' || toolName === 'browser';
  const isFetchWeb = toolName === 'fetch' || toolName === 'fetch_web_content';

  const args = (message.tool_args || {}) as Record<string, unknown>;
  const action = (args.action as string) || '';
  const url = (args.url as string) || '';

  const actionLabel = isControlBrowser
    ? ({ open: 'Open', navigate: 'Navigate', refresh: 'Refresh' } as Record<string, string>)[action] || action || 'Browser'
    : isFetchWeb
      ? 'Fetch'
      : 'Browser';

  const fetchParsed = isFetchWeb ? parseFetchOutput(message.text) : null;

  const domain = isControlBrowser
    ? (url ? extractHost(url) : '')
    : fetchParsed?.source
      ? extractHost(fetchParsed.source)
      : (url ? extractHost(url) : '');

  const httpCode = fetchParsed ? statusCode(fetchParsed.status) : '';
  const codeIsOk = httpCode ? isSuccessStatus(httpCode) : !isError;

  const metaParts: string[] = [];
  if (isControlBrowser && url) {
    metaParts.push(url);
  }
  if (isFetchWeb && fetchParsed) {
    if (fetchParsed.source) metaParts.push(fetchParsed.source);
    if (fetchParsed.status) metaParts.push(fetchParsed.status);
    if (fetchParsed.size) metaParts.push(fetchParsed.size);
  }

  const bodyText = isFetchWeb && fetchParsed?.body
    ? (fetchParsed.body.length > 3000
      ? `${fetchParsed.body.slice(0, 3000)}\n… [truncated]`
      : fetchParsed.body)
    : (isControlBrowser && message.text ? message.text : '');

  const hasExpandableContent = metaParts.length > 0 || Boolean(bodyText);

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.header}
        onClick={() => hasExpandableContent && setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        disabled={!hasExpandableContent}
      >
        <span className={styles.summary}>
          <span className={styles.summaryStrong}>{actionLabel}</span>
          {domain && (
            <>
              {' · '}
              <span className={styles.summaryStrong}>{truncate(domain, 48)}</span>
            </>
          )}
          {httpCode && (
            <>
              {' · '}
              <span className={codeIsOk ? styles.summaryOk : styles.summaryError}>{httpCode}</span>
            </>
          )}
          {isError && (
            <>
              {' · '}
              <span className={styles.summaryError}>✘</span>
            </>
          )}
        </span>

        {hasExpandableContent && (
          <span className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ''}`} aria-hidden>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        )}
      </button>

      {hasExpandableContent && isExpanded && (
        <div className={`${styles.panel} ${styles.panelOpen}`}>
          {metaParts.length > 0 && (
            <div className={styles.meta}>
              {metaParts.join(' · ')}
            </div>
          )}
          {bodyText && (
            <pre className={`${styles.body} ${isError ? styles.bodyError : ''}`}>
              {bodyText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});

export default BrowserToolResultCard;
