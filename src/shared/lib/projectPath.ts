/**
 * Pure project-path helpers (no UI / agent-engine dependency).
 * Used by persistence, stores, and agent UI.
 */

export function coerceProjectPath(path: unknown): string {
  if (typeof path === 'string') return path;
  if (path == null) return '';
  return String(path);
}

export function normalizeProjectPath(path: unknown): string {
  return coerceProjectPath(path).trim().replace(/\\/g, '/').toLowerCase();
}
