/**
 * Insert transcribed text into a composer value at the current selection.
 * Replaces the selected range when present; otherwise inserts at the caret.
 */
export function insertComposerText(
  current: string,
  text: string,
  selectionStart: number,
  selectionEnd: number
): { nextValue: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, current.length));
  const end = Math.max(start, Math.min(selectionEnd, current.length));
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { nextValue: current, cursor: end };
  }

  const before = current.slice(0, start);
  const after = current.slice(end);
  const needsLeadingSpace =
    before.length > 0 && !/\s$/.test(before) && !/^[,.;:!?…)]/.test(cleaned);
  const needsTrailingSpace = after.length > 0 && !/^\s/.test(after) && !/[,.;:!?…(]$/.test(cleaned);
  const insertion = `${needsLeadingSpace ? ' ' : ''}${cleaned}${needsTrailingSpace ? ' ' : ''}`;
  const nextValue = before + insertion + after;
  const cursor = before.length + insertion.length;
  return { nextValue, cursor };
}
