import { memo } from 'react';
import styles from './SessionStreamingLoader.module.css';

export interface SessionStreamingLoaderProps {
  className?: string;
  title?: string;
}

const SessionStreamingLoader = memo(function SessionStreamingLoader({
  className,
  title,
}: SessionStreamingLoaderProps) {
  return (
    <span
      className={[styles.spinner, className].filter(Boolean).join(' ')}
      data-testid="session-streaming-loader"
      title={title}
      aria-label={title}
      role="status"
    >
      {Array.from({ length: 9 }, (_, index) => (
        <span key={index} className={styles.square} aria-hidden />
      ))}
    </span>
  );
});

export default SessionStreamingLoader;
