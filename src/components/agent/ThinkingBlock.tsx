import { memo, useRef, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import styles from './ThinkingBlock.module.css';

interface ThinkingBlockProps {
  thinking: string;
  isThinking: boolean;
  thinkingStartedAt?: number;
  thinkingEndedAt?: number;
  createdAt: number;
  isExpanded: boolean;
  onToggle: () => void;
}

const ThinkingBlock = memo(function ThinkingBlock({
  thinking,
  isThinking,
  thinkingStartedAt,
  thinkingEndedAt,
  createdAt,
  isExpanded,
  onToggle,
}: ThinkingBlockProps) {
  const t = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isThinking && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [thinking, isThinking]);

  const hasThinkingEnded = !isThinking || !!thinkingEndedAt;
  let thinkingLabel = t.agentInternal.thinking;
  if (thinking) {
    if (hasThinkingEnded) {
      const startedAt = thinkingStartedAt ?? createdAt;
      const endedAt = thinkingEndedAt ?? startedAt;
      const durationMs = Math.max(0, endedAt - startedAt);
      const durationSec = Math.round(durationMs / 1000);
      thinkingLabel = t.agentInternal.thoughtFor.replace('{duration}', String(durationSec));
    } else {
      thinkingLabel = t.agentInternal.thinking;
    }
  }

  return (
    <div className={styles.root} data-testid="thinking-block">
      <div
        className={`${styles.header} ${isExpanded ? styles.headerExpanded : ''}`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
      >
        <span>{thinkingLabel}</span>
        <span className={`${styles.arrow} ${isExpanded ? styles.arrowExpanded : ''}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </span>
      </div>
      <div className={`${styles.content} ${isExpanded ? styles.contentExpanded : ''}`}>
        <div
          ref={contentRef}
          className={`${styles.contentInner} ${isExpanded ? styles.contentInnerExpanded : ''}`}
          data-testid="thinking-content"
        >
          {thinking}
        </div>
      </div>
    </div>
  );
});

export default ThinkingBlock;
