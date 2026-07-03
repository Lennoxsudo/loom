import cbmVersionJson from '../../src-tauri/cbm-version.json';

/** Pinned CBM sidecar version (single source: src-tauri/cbm-version.json). */
export const CBM_PINNED_VERSION: string = cbmVersionJson.version;

/** Default CBM 3D graph UI port. */
export const CBM_UI_PORT = 9749;

export const CBM_UI_URL = `http://localhost:${CBM_UI_PORT}`;

/** Default auto-index file ceiling (matches CBM auto_index_limit default). */
export const CBM_DEFAULT_AUTO_INDEX_MAX_FILES = 50_000;

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}
