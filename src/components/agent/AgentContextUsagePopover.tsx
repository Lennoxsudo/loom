import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import TokenRingIndicator from '../chat/TokenRingIndicator';
import { useTranslation } from '../../i18n';
import type { AgentContextUsage, AgentContextUsageBreakdown } from './contextUsage';
import styles from './AgentContextUsagePopover.module.css';

const POPOVER_GAP = 10;
const VIEWPORT_PADDING = 8;

const BREAKDOWN_COLORS = {
  system: '#8b8b8b',
  tools: '#8b5cf6',
  rules: '#22c55e',
  skills: '#f59e0b',
  messages: '#fb7185',
} as const;

type BreakdownKey = keyof typeof BREAKDOWN_COLORS;

function formatCompactTokens(value: number): string {
  const n = Math.max(0, Math.round(value));
  if (n >= 1_000_000) {
    const compact = n / 1_000_000;
    return compact >= 10 ? `~${Math.round(compact)}M` : `~${compact.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const compact = n / 1000;
    return compact >= 10 ? `~${Math.round(compact)}K` : `~${compact.toFixed(1)}K`;
  }
  return String(n);
}

export interface AgentContextUsagePopoverProps {
  usage: AgentContextUsage | null;
  safeTotalTokens: number;
  ctxPercent: number;
  maxContextTokens: number;
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 4l8 8M12 4 4 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BreakdownListItem({
  itemKey,
  color,
  label,
  value,
  highlighted,
  dimmed,
  onHover,
}: {
  itemKey: BreakdownKey;
  color: string;
  label: string;
  value: number;
  highlighted: boolean;
  dimmed: boolean;
  onHover: (key: BreakdownKey | null) => void;
}) {
  if (value <= 0) return null;
  return (
    <div
      className={[
        styles.breakdownRow,
        highlighted ? styles.breakdownRowHighlighted : '',
        dimmed ? styles.breakdownRowDimmed : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={`context-usage-row-${itemKey}`}
      data-highlighted={highlighted ? 'true' : 'false'}
      onMouseEnter={() => onHover(itemKey)}
      onMouseLeave={() => onHover(null)}
    >
      <span className={styles.swatch} style={{ backgroundColor: color }} aria-hidden />
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{formatCompactTokens(value)}</span>
    </div>
  );
}

const AgentContextUsagePopover = memo(function AgentContextUsagePopover({
  usage,
  safeTotalTokens,
  ctxPercent,
  maxContextTokens,
}: AgentContextUsagePopoverProps) {
  const t = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [visible, setVisible] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<BreakdownKey | null>(null);

  const close = useCallback(() => setOpen(false), []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;

    const triggerRect = trigger.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();

    let left = triggerRect.left;
    let top = triggerRect.top - popoverRect.height - POPOVER_GAP;

    if (left + popoverRect.width > window.innerWidth - VIEWPORT_PADDING) {
      left = triggerRect.right - popoverRect.width;
    }
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
    if (top < VIEWPORT_PADDING) {
      top = triggerRect.bottom + POPOVER_GAP;
    }

    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    updatePosition();
    setVisible(true);
  }, [open, usage, safeTotalTokens, ctxPercent, updatePosition]);

  useEffect(() => {
    if (!open) setHoveredKey(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onReposition = () => updatePosition();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, close]);

  const breakdownItems = useMemo(() => {
    if (!usage) return [];
    const labels: Record<BreakdownKey, string> = {
      system: t.agent.contextUsageDetail.system,
      tools: t.agent.contextUsageDetail.tools,
      rules: t.agent.contextUsageDetail.rules,
      skills: t.agent.contextUsageDetail.skills,
      messages: t.agent.contextUsageDetail.messages,
    };
    const order: BreakdownKey[] = ['system', 'tools', 'rules', 'skills', 'messages'];
    return order
      .map((key) => ({
        key,
        color: BREAKDOWN_COLORS[key],
        label: labels[key],
        value: usage.breakdown[key as keyof AgentContextUsageBreakdown],
      }))
      .filter((item) => item.value > 0);
  }, [usage, t.agent.contextUsageDetail]);

  const popover =
    open &&
    createPortal(
      <div
        ref={popoverRef}
        className={styles.popover}
        style={{ top: pos.top, left: pos.left, opacity: visible ? 1 : 0 }}
        role="dialog"
        aria-label={t.agent.contextUsageDetail.title}
      >
        {!usage ? (
          <div className={styles.emptyHint}>{t.agent.contextUsageDetail.loading}</div>
        ) : (
          <>
            <div className={styles.header}>
              <div className={styles.headerTitle}>{t.agent.contextUsageDetail.title}</div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={close}
                aria-label={t.agent.contextUsageDetail.close}
                data-testid="context-usage-close"
              >
                <CloseIcon />
              </button>
            </div>

            <div className={styles.summaryRow}>
              <span className={styles.summaryPercent}>
                {t.agent.contextUsageDetail.percentFull.replace(
                  '{percent}',
                  String(Math.round(ctxPercent))
                )}
              </span>
              <span>
                {t.agent.contextUsageDetail.tokenSummary
                  .replace('{used}', formatCompactTokens(usage.usedTokens))
                  .replace('{max}', formatCompactTokens(usage.availableContextTokens))}
              </span>
            </div>

            <div
              className={[styles.segmentBar, hoveredKey ? styles.segmentBarActive : '']
                .filter(Boolean)
                .join(' ')}
              aria-hidden
            >
              {breakdownItems.map((item) => {
                const width =
                  usage.availableContextTokens > 0
                    ? (item.value / usage.availableContextTokens) * 100
                    : 0;
                const highlighted = hoveredKey === item.key;
                const dimmed = hoveredKey !== null && hoveredKey !== item.key;
                return (
                  <span
                    key={item.key}
                    className={[
                      styles.segment,
                      highlighted ? styles.segmentHighlighted : '',
                      dimmed ? styles.segmentDimmed : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ width: `${width}%`, backgroundColor: item.color }}
                    data-testid={`context-usage-segment-${item.key}`}
                    data-highlighted={highlighted ? 'true' : 'false'}
                    onMouseEnter={() => setHoveredKey(item.key)}
                    onMouseLeave={() => setHoveredKey(null)}
                  />
                );
              })}
            </div>

            <div className={styles.breakdownList}>
              {breakdownItems.map((item) => (
                <BreakdownListItem
                  key={item.key}
                  itemKey={item.key}
                  color={item.color}
                  label={item.label}
                  value={item.value}
                  highlighted={hoveredKey === item.key}
                  dimmed={hoveredKey !== null && hoveredKey !== item.key}
                  onHover={setHoveredKey}
                />
              ))}
            </div>
          </>
        )}
      </div>,
      document.body
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t.agent.contextUsageDetail.openHint}
        onClick={() => setOpen((prev) => !prev)}
        data-testid="agent-context-usage-trigger"
      >
        <TokenRingIndicator
          safeTotalTokens={safeTotalTokens}
          ctxPercent={ctxPercent}
          MAX_CONTEXT_TOKENS={maxContextTokens}
          t={t}
        />
      </button>
      {popover}
    </>
  );
});

export default AgentContextUsagePopover;
