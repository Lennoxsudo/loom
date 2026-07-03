import type { Terminal } from 'xterm';

export type ResolvedThemeMode = 'system' | 'dark' | 'light';

function resolveThemeMode(themeMode: ResolvedThemeMode): 'dark' | 'light' {
  if (themeMode === 'dark') return 'dark';
  if (themeMode === 'light') return 'light';
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

function getCssVarValue(computed: CSSStyleDeclaration, name: string): string {
  return computed.getPropertyValue(name).trim();
}

export function getTerminalTheme(themeMode: ResolvedThemeMode) {
  const computed = getComputedStyle(document.documentElement);
  const isDark = resolveThemeMode(themeMode) === 'dark';

  return {
    background: getCssVarValue(computed, '--bg-editor'),
    foreground: getCssVarValue(computed, '--text-primary'),
    cursor: getCssVarValue(computed, '--text-accent'),
    cursorAccent: getCssVarValue(computed, '--bg-editor'),
    selectionBackground: getCssVarValue(computed, '--editor-selection-background'),
    selectionInactiveBackground: getCssVarValue(computed, '--editor-selection-inactive-background'),
    black: isDark ? '#000000' : '#1f2328',
    red: isDark ? '#cd3131' : '#c73e1d',
    green: isDark ? '#0dbc79' : '#1a7f37',
    yellow: isDark ? '#e5e510' : '#9a6700',
    blue: isDark ? '#2472c8' : '#0b69c7',
    magenta: isDark ? '#bc3fbc' : '#8250df',
    cyan: isDark ? '#11a8cd' : '#0969da',
    white: isDark ? '#e5e5e5' : '#d0d7de',
    brightBlack: isDark ? '#666666' : '#5f6b7a',
    brightRed: isDark ? '#f14c4c' : '#cf5b3e',
    brightGreen: isDark ? '#23d18b' : '#2da44e',
    brightYellow: isDark ? '#f5f543' : '#bf8700',
    brightBlue: isDark ? '#3b8eea' : '#218bff',
    brightMagenta: isDark ? '#d670d6' : '#a475f9',
    brightCyan: isDark ? '#29b8db' : '#1b7c83',
    brightWhite: isDark ? '#f5f5f5' : '#ffffff',
  };
}

export function applyTerminalTheme(term: Terminal, themeMode: ResolvedThemeMode) {
  const nextTheme = getTerminalTheme(themeMode);
  const themedTerm = term as Terminal & {
    setOption?: (key: string, value: unknown) => void;
    options?: { theme?: unknown } & Record<string, unknown>;
  };

  if (typeof themedTerm.setOption === 'function') {
    themedTerm.setOption('theme', nextTheme);
    return;
  }

  if (themedTerm.options && typeof themedTerm.options === 'object') {
    themedTerm.options.theme = nextTheme;
  }
}
