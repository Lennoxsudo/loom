/**
 * 快捷键解析工具函数
 */

/**
 * 解析后的快捷键
 */
interface ParsedShortcut {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

/**
 * 仅修饰键的集合
 */
const MODIFIER_ONLY_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

/**
 * 规范化快捷键主键名
 */
function normalizeShortcutMainKey(raw: string): string {
  const key = raw.trim();
  if (!key) return '';

  const lower = key.toLowerCase();
  const aliasMap: Record<string, string> = {
    esc: 'Escape',
    escape: 'Escape',
    return: 'Enter',
    space: 'Space',
    spacebar: 'Space',
    del: 'Delete',
    plus: '+',
    minus: '-',
  };

  if (aliasMap[lower]) return aliasMap[lower];
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  return key;
}

/**
 * 解析快捷键绑定字符串
 * @example parseShortcutBinding('Ctrl+S') => { ctrl: true, shift: false, alt: false, meta: false, key: 'S' }
 */
function parseShortcutBinding(binding: string): ParsedShortcut | null {
  const tokens = binding
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  let ctrl = false;
  let shift = false;
  let alt = false;
  let meta = false;
  let mainKey = '';

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') {
      ctrl = true;
      continue;
    }
    if (lower === 'shift') {
      shift = true;
      continue;
    }
    if (lower === 'alt' || lower === 'option') {
      alt = true;
      continue;
    }
    if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') {
      meta = true;
      continue;
    }

    if (mainKey) return null;
    mainKey = normalizeShortcutMainKey(token);
  }

  if (!mainKey || MODIFIER_ONLY_KEYS.has(mainKey)) return null;
  return { ctrl, shift, alt, meta, key: mainKey };
}

/**
 * 检查快捷键绑定是否匹配键盘事件
 */
export function shortcutMatchesEvent(binding: string, event: KeyboardEvent): boolean {
  const parsed = parseShortcutBinding(binding);
  if (!parsed) return false;

  const pressedKey = normalizeShortcutMainKey(event.key);
  if (!pressedKey || MODIFIER_ONLY_KEYS.has(pressedKey)) return false;

  return (
    parsed.ctrl === event.ctrlKey &&
    parsed.shift === event.shiftKey &&
    parsed.alt === event.altKey &&
    parsed.meta === event.metaKey &&
    parsed.key === pressedKey
  );
}
