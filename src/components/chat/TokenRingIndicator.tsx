import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './TokenRingIndicator.module.css';

export interface TokenRingIndicatorProps {
  safeTotalTokens: number;
  ctxPercent: number;
  MAX_CONTEXT_TOKENS: number;
  variant?: 'ring' | 'minimal';
  showInlineUsage?: boolean;
  t: { agent: { contextLabel: string; contextUsageRate: string } };
}

const TOOLTIP_GAP = 6;
const VIEWPORT_PADDING = 8;

export default function TokenRingIndicator({
  safeTotalTokens,
  ctxPercent,
  MAX_CONTEXT_TOKENS,
  variant = 'ring',
  showInlineUsage = true,
  t,
}: TokenRingIndicatorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const progressClass =
    ctxPercent > 95
      ? styles.progressDanger
      : ctxPercent > 80
        ? styles.progressWarning
        : styles.progress;

  const usageClass =
    ctxPercent > 95
      ? `${styles.usage} ${styles.usageDanger}`
      : ctxPercent > 80
        ? `${styles.usage} ${styles.usageWarning}`
        : styles.usage;

  const tooltipHeaderClass =
    ctxPercent > 95
      ? styles.tooltipHeaderDanger
      : ctxPercent > 80
        ? styles.tooltipHeaderWarning
        : styles.tooltipHeader;

  const usageText = `${ctxPercent.toFixed(1)}%`;
  const ariaLabel = `${t.agent.contextLabel}: ${safeTotalTokens.toLocaleString()} / ${MAX_CONTEXT_TOKENS.toLocaleString()}, ${t.agent.contextUsageRate}: ${usageText}`;

  const updateTooltipPosition = useCallback(() => {
    const root = rootRef.current;
    const tooltip = tooltipRef.current;
    if (!root || !tooltip) return;

    const rootRect = root.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let left = rootRect.left;
    let top = rootRect.top - tooltipRect.height - TOOLTIP_GAP;

    if (left + tooltipRect.width > window.innerWidth - VIEWPORT_PADDING) {
      left = rootRect.right - tooltipRect.width;
    }
    if (left < VIEWPORT_PADDING) {
      left = VIEWPORT_PADDING;
    }

    if (top < VIEWPORT_PADDING) {
      top = rootRect.bottom + TOOLTIP_GAP;
    }

    setTooltipPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!hovered) {
      setTooltipVisible(false);
      return;
    }

    updateTooltipPosition();
    setTooltipVisible(true);
  }, [hovered, safeTotalTokens, MAX_CONTEXT_TOKENS, ctxPercent, updateTooltipPosition]);

  useLayoutEffect(() => {
    if (!hovered) return;

    const handleReposition = () => updateTooltipPosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [hovered, updateTooltipPosition]);

  const tooltip =
    hovered &&
    createPortal(
      <div
        ref={tooltipRef}
        className={`${styles.tooltip} ${tooltipVisible ? styles.tooltipVisible : ''}`}
        style={{ top: tooltipPos.top, left: tooltipPos.left }}
        role="tooltip"
      >
        <div className={tooltipHeaderClass}>
          {t.agent.contextLabel}: {safeTotalTokens.toLocaleString()} /{' '}
          {MAX_CONTEXT_TOKENS.toLocaleString()}
        </div>
        <div className={styles.tooltipSub}>
          {t.agent.contextUsageRate}: {usageText}
        </div>
      </div>,
      document.body
    );

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${!showInlineUsage ? styles.rootIconOnly : ''}`}
      aria-label={ariaLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {variant === 'minimal' ? (
        <span
          className={`${styles.dot} ${
            ctxPercent > 95
              ? styles.dotDanger
              : ctxPercent > 80
                ? styles.dotWarning
                : styles.dotNormal
          }`}
          aria-hidden
        />
      ) : (
        <svg width="16" height="16" viewBox="0 0 20 20" className={styles.ring} aria-hidden>
          <circle cx="10" cy="10" r="8" className={styles.track} />
          <circle
            cx="10"
            cy="10"
            r="8"
            className={progressClass}
            strokeDasharray={`${Math.min(ctxPercent, 100) * 0.5027} 50.27`}
          />
        </svg>
      )}
      {showInlineUsage && <span className={usageClass}>{usageText}</span>}
      {tooltip}
    </div>
  );
}
