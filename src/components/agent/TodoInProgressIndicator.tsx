import styles from './TodoInProgressIndicator.module.css';

export function TodoInProgressIndicator() {
  return (
    <span
      className={styles.spinner}
      data-testid="todo-in-progress-indicator"
      aria-hidden
    >
      <svg viewBox="25 25 50 50">
        <circle r="20" cy="50" cx="50" />
      </svg>
    </span>
  );
}
