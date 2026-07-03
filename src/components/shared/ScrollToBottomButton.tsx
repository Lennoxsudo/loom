import { memo } from 'react';
import styles from './ScrollToBottomButton.module.css';

export interface ScrollToBottomButtonProps {
  onClick: () => void;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

function ScrollToBottomButton({
  onClick,
  title = 'Scroll to bottom',
  className,
  style,
}: ScrollToBottomButtonProps) {
  return (
    <button
      type="button"
      className={[styles.button, className].filter(Boolean).join(' ')}
      onClick={onClick}
      title={title}
      aria-label={title}
      style={style}
    >
      <svg
        className={styles.icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

export default memo(ScrollToBottomButton);
