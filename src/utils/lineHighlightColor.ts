export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const HEX_COLOR_RE = /^#?[0-9a-f]{6}$/i;

export function normalizeHexColor(input: string): string | null {
  const trimmed = input.trim();
  if (!HEX_COLOR_RE.test(trimmed)) return null;
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  return `#${hex.toLowerCase()}`;
}

export function parseHexColor(input: string): RgbColor | null {
  const normalized = normalizeHexColor(input);
  if (!normalized) return null;
  const hex = normalized.slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: RgbColor): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const byte = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

const LINE_HIGHLIGHT_BG_ALPHA = 0.08;
const LINE_HIGHLIGHT_BORDER_ALPHA_DARK = 0.2;
const LINE_HIGHLIGHT_BORDER_ALPHA_LIGHT = 0.18;

function toRgba({ r, g, b }: RgbColor, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildLineHighlightCss(
  color: string | null,
  isDark: boolean
): { bg: string; border: string } | null {
  if (!color) return null;
  const rgb = parseHexColor(color);
  if (!rgb) return null;
  const borderAlpha = isDark ? LINE_HIGHLIGHT_BORDER_ALPHA_DARK : LINE_HIGHLIGHT_BORDER_ALPHA_LIGHT;
  return {
    bg: toRgba(rgb, LINE_HIGHLIGHT_BG_ALPHA),
    border: toRgba(rgb, borderAlpha),
  };
}

export function applyCurrentLineHighlightColor(
  color: string | null,
  resolvedTheme: 'dark' | 'light'
): void {
  const root = document.documentElement;
  const css = buildLineHighlightCss(color, resolvedTheme === 'dark');
  if (!css) {
    root.style.removeProperty('--editor-line-highlight');
    root.style.removeProperty('--editor-line-highlight-border');
    return;
  }
  root.style.setProperty('--editor-line-highlight', css.bg);
  root.style.setProperty('--editor-line-highlight-border', css.border);
}

let previewFrameId = 0;
let pendingPreview: { color: string | null; theme: 'dark' | 'light' } | null = null;

/** rAF-throttled preview for color picker drag; avoids layout work every input event */
export function previewCurrentLineHighlightColor(
  color: string | null,
  resolvedTheme: 'dark' | 'light'
): void {
  pendingPreview = { color, theme: resolvedTheme };
  if (previewFrameId !== 0) return;
  previewFrameId = requestAnimationFrame(() => {
    previewFrameId = 0;
    const next = pendingPreview;
    pendingPreview = null;
    if (next) {
      applyCurrentLineHighlightColor(next.color, next.theme);
    }
  });
}

export function resolveThemeFromMode(themeMode: 'system' | 'dark' | 'light'): 'dark' | 'light' {
  if (themeMode === 'dark') return 'dark';
  if (themeMode === 'light') return 'light';
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}
