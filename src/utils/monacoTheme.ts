import type * as Monaco from 'monaco-editor';
import { getMonacoInstance } from '../monaco-loader';

export function resolveMonacoThemeMode(themeMode: 'system' | 'dark' | 'light'): 'dark' | 'light' {
  if (themeMode === 'dark') return 'dark';
  if (themeMode === 'light') return 'light';
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

function cssVar(computed: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = computed.getPropertyValue(name).trim();
  return v || fallback;
}

const BYTE = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');

/**
 * Monaco `defineTheme` 对浏览器返回的 rgb()/rgba() 常解析失败，颜色项会被丢弃并回退到 vs 默认
 *（含 diff 用的纯红底与括号相关色），表现为配对括号整块「亮红」。
 * 统一转为 #RRGGBB 或 #RRGGBBAA。
 */
function toMonacoColor(rawInput: string, fallbackHex: string): string {
  const raw = rawInput?.trim() ?? '';
  if (!raw) return fallbackHex;
  if (raw === 'transparent') return '#00000000';
  if (/^#/i.test(raw)) {
    if (/^#[0-9a-f]{6}$/i.test(raw) || /^#[0-9a-f]{8}$/i.test(raw)) return raw.toLowerCase();
    return fallbackHex;
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(raw);
  if (!m) return fallbackHex;
  const r = parseInt(m[1], 10);
  const g = parseInt(m[2], 10);
  const b = parseInt(m[3], 10);
  let alphaByte = 255;
  if (m[4] !== undefined) {
    const af = parseFloat(m[4]);
    alphaByte = af <= 1 ? Math.round(af * 255) : Math.min(255, Math.round(af));
  }
  return `#${BYTE(r)}${BYTE(g)}${BYTE(b)}${BYTE(alphaByte)}`;
}

function monoColor(css: CSSStyleDeclaration, varName: string, fallbackHex: string): string {
  return toMonacoColor(cssVar(css, varName, fallbackHex), fallbackHex);
}

export function applyMonacoTheme(monaco: typeof Monaco, themeMode: 'system' | 'dark' | 'light') {
  const computed = getComputedStyle(document.documentElement);
  const resolvedMode = resolveMonacoThemeMode(themeMode);
  const isDark = resolvedMode === 'dark';
  const themeName = isDark ? 'loom-dark' : 'loom-light';

  const FB = {
    bg: isDark ? '#1e1e1e' : '#ffffff',
    fg: isDark ? '#cccccc' : '#1f2328',
    secondary: isDark ? '#858585' : '#5f6b7a',
    accent: isDark ? '#007acc' : '#0b69c7',
    borderSubtle: isDark ? '#2b2b2b' : '#e5e7eb',
    borderStrong: isDark ? '#3c3c3c' : '#c1c7cf',
    sidebar: isDark ? '#252526' : '#ebebeb',
    borderPrimary: isDark ? '#454545' : '#d0d7de',
    scrollbar: isDark ? '#424242' : '#c1c1c1',
    scrollbarHover: isDark ? '#4f4f4f' : '#a9a9a9',
    selection: isDark ? '#264f7880' : '#b3d7ff99',
    selectionInactive: isDark ? '#264f7840' : '#b3d7ff52',
    lineHi: isDark ? 'rgba(0, 122, 204, 0.08)' : 'rgba(11, 105, 199, 0.08)',
    lineHiBorder: isDark ? 'rgba(0, 122, 204, 0.2)' : 'rgba(11, 105, 199, 0.18)',
    diffInsLine: isDark ? 'rgba(80, 200, 120, 0.12)' : 'rgba(34, 160, 80, 0.1)',
    diffInsText: isDark ? 'rgba(80, 200, 120, 0.16)' : 'rgba(34, 160, 80, 0.14)',
    diffRmLine: isDark ? 'rgba(255, 80, 80, 0.14)' : 'rgba(200, 40, 40, 0.1)',
    diffRmText: isDark ? 'rgba(255, 80, 80, 0.18)' : 'rgba(200, 40, 40, 0.14)',
    bracketBg: isDark ? 'rgba(38, 79, 120, 0.42)' : 'rgba(11, 105, 199, 0.14)',
    bracketBorder: isDark ? 'rgba(120, 180, 235, 0.7)' : 'rgba(11, 105, 199, 0.5)',
  };

  monaco.editor.defineTheme(themeName, {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': monoColor(computed, '--bg-editor', FB.bg),
      'editor.foreground': monoColor(computed, '--text-primary', FB.fg),
      'editorLineNumber.foreground': monoColor(computed, '--text-secondary', FB.secondary),
      'editorLineNumber.activeForeground': monoColor(computed, '--text-primary', FB.fg),
      'editorCursor.foreground': monoColor(computed, '--text-accent', FB.accent),
      'editor.selectionBackground': monoColor(
        computed,
        '--editor-selection-background',
        FB.selection
      ),
      'editor.inactiveSelectionBackground': monoColor(
        computed,
        '--editor-selection-inactive-background',
        FB.selectionInactive
      ),
      'editor.selectionHighlightBackground': monoColor(
        computed,
        '--editor-selection-inactive-background',
        FB.selectionInactive
      ),
      'diffEditor.insertedLineBackground': monoColor(
        computed,
        '--editor-diff-inserted-line',
        FB.diffInsLine
      ),
      'diffEditor.insertedTextBackground': monoColor(
        computed,
        '--editor-diff-inserted-text',
        FB.diffInsText
      ),
      'diffEditor.removedLineBackground': monoColor(
        computed,
        '--editor-diff-removed-line',
        FB.diffRmLine
      ),
      'diffEditor.removedTextBackground': monoColor(
        computed,
        '--editor-diff-removed-text',
        FB.diffRmText
      ),
      'diffEditor.removedTextBorder': '#00000000',
      'diffEditor.insertedTextBorder': '#00000000',
      'editor.lineHighlightBackground': monoColor(computed, '--editor-line-highlight', FB.lineHi),
      'editor.lineHighlightBorder': monoColor(
        computed,
        '--editor-line-highlight-border',
        FB.lineHiBorder
      ),
      'editor.lineHighlightOnlyWhenFocus': 'true',
      'editorIndentGuide.background1': monoColor(computed, '--border-subtle', FB.borderSubtle),
      'editorIndentGuide.activeBackground1': monoColor(
        computed,
        '--border-strong',
        FB.borderStrong
      ),
      'editorWhitespace.foreground': monoColor(computed, '--text-secondary', FB.secondary),
      'editorBracketMatch.background': monoColor(
        computed,
        '--editor-bracket-match-background',
        FB.bracketBg
      ),
      'editorBracketMatch.border': monoColor(
        computed,
        '--editor-bracket-match-border',
        FB.bracketBorder
      ),
      'editorBracketHighlight.foreground1': monoColor(
        computed,
        '--editor-bracket-fg-1',
        isDark ? '#79b8ff' : '#0969da'
      ),
      'editorBracketHighlight.foreground2': monoColor(
        computed,
        '--editor-bracket-fg-2',
        isDark ? '#4dcdb2' : '#087e6c'
      ),
      'editorBracketHighlight.foreground3': monoColor(
        computed,
        '--editor-bracket-fg-3',
        isDark ? '#cfa8ff' : '#6639ba'
      ),
      'editorBracketHighlight.foreground4': monoColor(
        computed,
        '--editor-bracket-fg-4',
        isDark ? '#b8e986' : '#1a7f37'
      ),
      'editorBracketHighlight.foreground5': monoColor(
        computed,
        '--editor-bracket-fg-5',
        isDark ? '#9bdcfe' : '#1f6feb'
      ),
      'editorBracketHighlight.foreground6': monoColor(
        computed,
        '--editor-bracket-fg-6',
        isDark ? '#87d6ff' : '#0b6899'
      ),
      'editorBracketHighlight.unexpectedBracket.foreground': monoColor(
        computed,
        '--editor-bracket-unexpected-fg',
        isDark ? '#e0a958' : '#9a6700'
      ),
      'editorError.background': '#00000000',
      'editorError.border': '#00000000',
      'editorWarning.background': '#00000000',
      'editorWarning.border': '#00000000',
      'editorWidget.background': monoColor(computed, '--bg-sidebar', FB.sidebar),
      'editorWidget.border': monoColor(computed, '--border-primary', FB.borderPrimary),
      'editorGutter.background': monoColor(computed, '--bg-editor', FB.bg),
      'editorOverviewRuler.border': '#00000000',
      'scrollbarSlider.background': monoColor(computed, '--bg-scrollbar-thumb', FB.scrollbar),
      'scrollbarSlider.hoverBackground': monoColor(
        computed,
        '--bg-scrollbar-thumb-hover',
        FB.scrollbarHover
      ),
      'scrollbarSlider.activeBackground': monoColor(
        computed,
        '--bg-scrollbar-thumb-hover',
        FB.scrollbarHover
      ),
      'minimap.background': monoColor(computed, '--bg-editor', FB.bg),
    },
  });

  monaco.editor.setTheme(themeName);
}

export function refreshMonacoTheme(themeMode: 'system' | 'dark' | 'light'): void {
  try {
    const monaco = getMonacoInstance();
    applyMonacoTheme(monaco, themeMode);
  } catch {
    // Monaco may not be loaded yet (e.g. settings view before any editor opens)
  }
}
