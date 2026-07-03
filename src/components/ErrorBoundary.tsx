import React, { type ErrorInfo, type ReactNode } from 'react';
import { toAppError, type AppError, type ErrorSeverity } from '../utils/errorHandling';
import { zhCN } from '../i18n/zh-CN';
import type { I18nMessages } from '../i18n/types';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: AppError, errorInfo: ErrorInfo) => void;
  locale?: string;
}

interface State {
  hasError: boolean;
  error: AppError | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    const appError = toAppError(error);
    return { hasError: true, error: appError };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const appError = toAppError(error);
    this.setState({ errorInfo, error: appError });
    this.props.onError?.(appError, errorInfo);
    console.error(
      `[ErrorBoundary] ${appError.severity.toUpperCase()} error:`,
      appError.message,
      errorInfo
    );
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

function ErrorFallback({
  error,
  errorInfo,
  onRetry,
}: {
  error: AppError | null;
  errorInfo: ErrorInfo | null;
  onRetry: () => void;
}) {
  const t: I18nMessages = zhCN;
  const isUser = error?.severity === 'user';

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.icon}>{isUser ? '⚠️' : '🔴'}</div>
        <h2 style={styles.title}>
          {isUser ? t.errorBoundary.userErrorTitle : t.errorBoundary.systemErrorTitle}
        </h2>
        <p style={styles.message}>{error?.userMessage ?? t.errorBoundary.defaultMessage}</p>
        {error && (
          <div style={styles.errorInfo}>
            <span style={styles.badge(error.severity)}>
              {error.severity === 'user' ? t.labels.userError : t.labels.systemError}
            </span>
            <span style={styles.category}>{error.category}</span>
          </div>
        )}
        {error && (
          <details style={styles.details}>
            <summary style={styles.summary}>{t.labels.errorDetails}</summary>
            <pre style={styles.errorText}>
              {error.message}
              {errorInfo?.componentStack}
            </pre>
          </details>
        )}
        <div style={styles.actions}>
          {error?.recoverable && (
            <button style={styles.retryButton} onClick={onRetry}>
              {t.actions.retry}
            </button>
          )}
          <button style={styles.reloadButton} onClick={() => window.location.reload()}>
            {t.actions.refreshPage}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '24px',
    backgroundColor: 'var(--bg-primary, #1e1e1e)',
    color: 'var(--text-primary, #e0e0e0)',
  } as React.CSSProperties,
  content: {
    maxWidth: '480px',
    textAlign: 'center',
  } as React.CSSProperties,
  icon: {
    fontSize: '48px',
    marginBottom: '16px',
  } as React.CSSProperties,
  title: {
    fontSize: '24px',
    fontWeight: 600,
    marginBottom: '12px',
    color: 'var(--text-primary, #e0e0e0)',
  } as React.CSSProperties,
  message: {
    fontSize: '14px',
    color: 'var(--text-secondary, #888)',
    marginBottom: '16px',
    lineHeight: 1.6,
  } as React.CSSProperties,
  errorInfo: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'center',
    marginBottom: '16px',
  } as React.CSSProperties,
  badge: (severity: ErrorSeverity): React.CSSProperties => ({
    padding: '4px 8px',
    fontSize: '11px',
    fontWeight: 500,
    borderRadius: '4px',
    backgroundColor: severity === 'user' ? 'rgba(255, 152, 0, 0.2)' : 'rgba(244, 67, 54, 0.2)',
    color: severity === 'user' ? '#ff9800' : '#f44336',
  }),
  category: {
    padding: '4px 8px',
    fontSize: '11px',
    fontWeight: 500,
    borderRadius: '4px',
    backgroundColor: 'var(--bg-secondary, #252526)',
    color: 'var(--text-secondary, #888)',
  } as React.CSSProperties,
  details: {
    marginBottom: '24px',
    textAlign: 'left',
    backgroundColor: 'var(--bg-secondary, #252526)',
    borderRadius: '8px',
    padding: '12px',
  } as React.CSSProperties,
  summary: {
    cursor: 'pointer',
    fontSize: '13px',
    color: 'var(--text-secondary, #888)',
    marginBottom: '8px',
  } as React.CSSProperties,
  errorText: {
    fontSize: '12px',
    color: 'var(--error-color, #f44336)',
    overflow: 'auto',
    maxHeight: '200px',
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  } as React.CSSProperties,
  actions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'center',
  } as React.CSSProperties,
  retryButton: {
    padding: '10px 24px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: 'var(--accent-color, #0078d4)',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  } as React.CSSProperties,
  reloadButton: {
    padding: '10px 24px',
    fontSize: '14px',
    fontWeight: 500,
    color: 'var(--text-primary, #e0e0e0)',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-color, #3c3c3c)',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  } as React.CSSProperties,
};

export default ErrorBoundary;
