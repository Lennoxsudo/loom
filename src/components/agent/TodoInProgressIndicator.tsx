import styles from './TodoInProgressIndicator.module.css';

export function TodoInProgressIndicator() {
  return (
    <span className={styles.indicator} data-testid="todo-in-progress-indicator" aria-hidden>
      <svg viewBox="0 0 14 14" fill="none" className={styles.waveSvg}>
        <rect className={styles.bar1} x="1.5" y="2.5" width="2.2" height="9" rx="1.1" />
        <rect className={styles.bar2} x="5.9" y="1" width="2.2" height="12" rx="1.1" />
        <rect className={styles.bar3} x="10.3" y="3.5" width="2.2" height="7" rx="1.1" />
      </svg>
    </span>
  );
}
