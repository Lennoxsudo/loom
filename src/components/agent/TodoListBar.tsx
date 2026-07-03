import React, {
  memo,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  loadTodos,
  peekTodos,
  TODO_UPDATED_EVENT,
  type TodoItem,
  type TodoStatus,
} from '../../utils/aiTools/todoStore';
import { useTranslation } from '../../i18n';
import { TodoInProgressIndicator } from './TodoInProgressIndicator';
import styles from './TodoListBar.module.css';

interface TodoListBarProps {
  conversationId: string;
  style?: React.CSSProperties;
  onLayoutChange?: (detail: { overlayHeight: number }) => void;
}

const STATUS_ORDER: Record<TodoStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

function sortTodos(items: TodoItem[]): TodoItem[] {
  return [...items].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

const TodoStatusIndicator = memo(function TodoStatusIndicator({ status }: { status: TodoStatus }) {
  if (status === 'in_progress') {
    return (
      <span className={styles.indicator}>
        <TodoInProgressIndicator />
      </span>
    );
  }

  if (status === 'completed') {
    return (
      <span className={`${styles.indicator} ${styles.completedMark}`} aria-hidden>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }

  return <span className={`${styles.indicator} ${styles.pendingDot}`} aria-hidden />;
});

const TodoRow = memo(function TodoRow({ todo }: { todo: TodoItem }) {
  return (
    <div
      className={`${styles.row} ${
        todo.status === 'completed'
          ? styles.rowCompleted
          : todo.status === 'pending'
            ? styles.rowPending
            : ''
      }`}
    >
      <TodoStatusIndicator status={todo.status} />
      <span className={styles.rowText}>{todo.content}</span>
    </div>
  );
});

const TodoListBar: React.FC<TodoListBarProps> = ({ conversationId, style, onLayoutChange }) => {
  const t = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  const refreshTodosFromCache = useCallback(() => {
    if (!conversationId) return;
    setTodoItems(peekTodos(conversationId));
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) {
      setTodoItems([]);
      return;
    }

    let cancelled = false;

    void loadTodos(conversationId).then((loadedTodos) => {
      if (!cancelled) {
        setTodoItems(loadedTodos);
      }
    });

    const handleTodosUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      if (detail?.conversationId === conversationId) {
        refreshTodosFromCache();
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === `loom.todo_write.items.${conversationId}`) {
        refreshTodosFromCache();
      }
    };

    window.addEventListener(TODO_UPDATED_EVENT, handleTodosUpdated);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      cancelled = true;
      window.removeEventListener(TODO_UPDATED_EVENT, handleTodosUpdated);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [conversationId, refreshTodosFromCache]);

  const sortedTodos = useMemo(() => sortTodos(todoItems), [todoItems]);
  const inProgressItems = useMemo(
    () => sortedTodos.filter((item) => item.status === 'in_progress'),
    [sortedTodos],
  );
  const pendingCount = useMemo(
    () => sortedTodos.filter((item) => item.status === 'pending').length,
    [sortedTodos],
  );
  const completedCount = useMemo(
    () => sortedTodos.filter((item) => item.status === 'completed').length,
    [sortedTodos],
  );

  const metaSummary = useMemo(() => {
    const parts: string[] = [];
    if (pendingCount > 0) parts.push(`${pendingCount} ${t.todo.pending}`);
    if (completedCount > 0) parts.push(`${completedCount} ${t.todo.completed}`);
    return parts.join(' · ') || t.todo.noItems;
  }, [completedCount, pendingCount, t.todo.completed, t.todo.noItems, t.todo.pending]);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const reportLayout = useCallback(() => {
    if (!onLayoutChange) return;
    const overlayHeight =
      isExpanded && panelRef.current
        ? Math.ceil(panelRef.current.getBoundingClientRect().height)
        : 0;
    onLayoutChange({ overlayHeight });
  }, [isExpanded, onLayoutChange]);

  useEffect(() => {
    reportLayout();
  }, [reportLayout, todoItems.length]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !onLayoutChange) return;

    const observer = new ResizeObserver(() => {
      reportLayout();
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [onLayoutChange, reportLayout, isExpanded]);

  useEffect(() => {
    if (!isExpanded) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      setIsExpanded(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isExpanded]);

  if (todoItems.length === 0) {
    return null;
  }

  const primaryInProgress = inProgressItems[0];
  const extraInProgress = inProgressItems.length - 1;

  return (
    <div ref={rootRef} className={styles.root} style={style}>
      <div
        ref={panelRef}
        className={`${styles.panel} ${isExpanded ? styles.panelOpen : ''}`}
        aria-hidden={!isExpanded}
      >
        <div className={styles.list}>
          {sortedTodos.map((todo) => (
            <TodoRow key={todo.id} todo={todo} />
          ))}
        </div>
      </div>

      <button
        type="button"
        className={styles.header}
        onClick={handleToggle}
        aria-expanded={isExpanded}
      >
        <div className={styles.summary}>
          {primaryInProgress ? (
            <>
              <TodoInProgressIndicator />
              <span className={styles.summaryText}>{primaryInProgress.content}</span>
              {extraInProgress > 0 && (
                <span className={styles.more}>+{extraInProgress}</span>
              )}
            </>
          ) : (
            <span className={styles.summaryMeta}>{metaSummary}</span>
          )}
        </div>

        <span className={`${styles.chevron} ${isExpanded ? styles.chevronExpanded : ''}`} aria-hidden>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
    </div>
  );
};

export default memo(TodoListBar);
