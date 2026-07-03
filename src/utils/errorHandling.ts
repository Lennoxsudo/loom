import { getMessages } from '../i18n';
import type { LocaleCode } from '../i18n/types';

type ErrorCategory =
  | 'cancel'
  | 'network'
  | 'permission'
  | 'file'
  | 'validation'
  | 'api'
  | 'unknown';

export type ErrorSeverity = 'user' | 'system';

export interface AppError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  code: string;
  message: string;
  originalError?: unknown;
  userMessage: string;
  recoverable: boolean;
  timestamp: string;
}

const ERROR_CODES: Record<
  string,
  { category: ErrorCategory; severity: ErrorSeverity; recoverable: boolean }
> = {
  CANCEL: { category: 'cancel', severity: 'user', recoverable: true },
  NETWORK_ERROR: { category: 'network', severity: 'system', recoverable: true },
  PERMISSION_DENIED: { category: 'permission', severity: 'system', recoverable: false },
  FILE_NOT_FOUND: { category: 'file', severity: 'user', recoverable: true },
  FILE_READ_ERROR: { category: 'file', severity: 'system', recoverable: true },
  FILE_WRITE_ERROR: { category: 'file', severity: 'system', recoverable: true },
  INVALID_PATH: { category: 'validation', severity: 'user', recoverable: true },
  API_ERROR: { category: 'api', severity: 'system', recoverable: true },
  TIMEOUT: { category: 'network', severity: 'system', recoverable: true },
  VALIDATION_ERROR: { category: 'validation', severity: 'user', recoverable: true },
  UNKNOWN: { category: 'unknown', severity: 'system', recoverable: false },
};

export function isTauriCancellationError(error: unknown): boolean {
  if (!error) return false;

  const message =
    typeof error === 'string'
      ? error.toLowerCase()
      : typeof error === 'object'
        ? String(
            (error as { msg?: unknown; message?: unknown }).msg ??
              (error as { message?: unknown }).message ??
              ''
          ).toLowerCase()
        : '';

  const type =
    typeof error === 'object' ? String((error as { type?: unknown }).type ?? '').toLowerCase() : '';

  return (
    type === 'cancelation' ||
    type === 'cancellation' ||
    message.includes('operation is manually canceled') ||
    message.includes('manually canceled') ||
    message.includes('cancelled') ||
    message.includes('canceled')
  );
}

function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String(
    (error as Error).message ?? (error as { msg?: string }).msg ?? ''
  ).toLowerCase();
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('enotfound')
  );
}

function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String(
    (error as Error).message ?? (error as { msg?: string }).msg ?? ''
  ).toLowerCase();
  return (
    message.includes('permission') ||
    message.includes('access denied') ||
    message.includes('unauthorized') ||
    message.includes('forbidden')
  );
}

function isFileNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String(
    (error as Error).message ?? (error as { msg?: string }).msg ?? ''
  ).toLowerCase();
  return (
    message.includes('not found') ||
    message.includes('no such file') ||
    message.includes('does not exist')
  );
}

function isValidationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String(
    (error as Error).message ?? (error as { msg?: string }).msg ?? ''
  ).toLowerCase();
  return (
    message.includes('invalid') || message.includes('validation') || message.includes('required')
  );
}

function categorizeError(error: unknown): ErrorCategory {
  if (isTauriCancellationError(error)) return 'cancel';
  if (isNetworkError(error)) return 'network';
  if (isPermissionError(error)) return 'permission';
  if (isFileNotFoundError(error)) return 'file';
  if (isValidationError(error)) return 'validation';
  return 'unknown';
}

function determineSeverity(category: ErrorCategory): ErrorSeverity {
  const userErrors: ErrorCategory[] = ['cancel', 'validation', 'file'];
  return userErrors.includes(category) ? 'user' : 'system';
}

export function toAppError(
  error: unknown,
  context?: string,
  locale: LocaleCode = 'zh-CN'
): AppError {
  const timestamp = new Date().toISOString();
  const t = getMessages(locale);

  if (isTauriCancellationError(error)) {
    return {
      category: 'cancel',
      severity: 'user',
      code: 'CANCEL',
      message: t.errors.operationCancelled,
      originalError: error,
      userMessage: t.errors.operationCancelled,
      recoverable: true,
      timestamp,
    };
  }

  const category = categorizeError(error);
  const severity = determineSeverity(category);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const code = category.toUpperCase() + '_ERROR';

  const errorDef = ERROR_CODES[code] ?? ERROR_CODES.UNKNOWN;

  const userMessageMap: Record<ErrorCategory, string> = {
    cancel: t.errors.operationCancelled,
    network: t.errors.networkConnectionFailed,
    permission: t.errors.permissionDeniedAction,
    file: t.errors.fileNotFound,
    validation: t.errors.invalidInput,
    api: t.errors.apiRequestFailed,
    unknown: t.errors.unknownError,
  };

  return {
    category,
    severity,
    code,
    message: context ? `${context}: ${errorMessage}` : errorMessage,
    originalError: error,
    userMessage: context ? `${context}: ${userMessageMap[category]}` : userMessageMap[category],
    recoverable: errorDef.recoverable,
    timestamp,
  };
}

function formatErrorForLog(error: unknown, context?: string): string {
  const appError = toAppError(error, context);
  const details = error instanceof Error ? `\nStack: ${error.stack}` : '';
  return `[${appError.timestamp}] [${appError.severity.toUpperCase()}] [${appError.category.toUpperCase()}] ${appError.message}${details}`;
}

function shouldReportError(error: unknown): boolean {
  if (isTauriCancellationError(error)) return false;
  const category = categorizeError(error);
  return category !== 'cancel';
}

export function logError(error: unknown, context?: string): void {
  if (!shouldReportError(error)) return;
  console.error(formatErrorForLog(error, context));
}

export function logWarning(message: string, context?: string): void {
  const timestamp = new Date().toISOString();
  const prefix = context ? `[${context}]` : '';
  console.warn(`[${timestamp}] [WARNING] ${prefix} ${message}`);
}

export function logDebug(message: string, context?: string): void {
  const timestamp = new Date().toISOString();
  const prefix = context ? `[${context}]` : '';
  console.warn(`[${timestamp}] [DEBUG] ${prefix} ${message}`);
}
