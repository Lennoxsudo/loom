import { describe, expect, it } from 'vitest';
import {
  editorHasCopyableSelection,
  isAnyEditorCopyIntentActive,
  shouldSkipFileTreeCopyShortcut,
  shouldSkipFileTreeKeyboardShortcut,
} from '../fileTreeKeyboard';
import type { MonacoEditor } from '../../types/monaco';

function createMockEditor(options?: {
  hasTextFocus?: boolean;
  hasSelection?: boolean;
  containsTarget?: boolean;
}): MonacoEditor {
  const domNode = document.createElement('div');
  domNode.className = 'monaco-editor';

  return {
    focus: () => {},
    layout: () => {},
    dispose: () => {},
    getValue: () => '',
    setValue: () => {},
    getModel: () => null,
    getSelection: () =>
      options?.hasSelection
        ? {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 4,
            isEmpty: () => false,
          }
        : null,
    getSelections: () =>
      options?.hasSelection
        ? [
            {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 4,
              isEmpty: () => false,
            },
          ]
        : [],
    setSelection: () => {},
    getPosition: () => null,
    setPosition: () => {},
    revealRangeInCenter: () => {},
    revealLineInCenter: () => {},
    executeEdits: () => {},
    trigger: () => {},
    getAction: () => null,
    saveViewState: () => null,
    restoreViewState: () => {},
    onDidChangeModel: () => ({ dispose: () => {} }),
    onDidDispose: () => ({ dispose: () => {} }),
    getDomNode: () => domNode,
    updateOptions: () => {},
    ...(options?.hasTextFocus
      ? {
          hasTextFocus: () => true,
        }
      : {}),
    ...(options?.containsTarget
      ? {
          getDomNode: () => {
            const wrapper = document.createElement('div');
            wrapper.appendChild(domNode);
            return wrapper;
          },
        }
      : {}),
  } as MonacoEditor & { hasTextFocus?: () => boolean };
}

describe('shouldSkipFileTreeKeyboardShortcut', () => {
  it('skips when target is inside monaco editor DOM', () => {
    const monacoRoot = document.createElement('div');
    monacoRoot.className = 'monaco-editor';
    const textarea = document.createElement('textarea');
    monacoRoot.appendChild(textarea);

    expect(shouldSkipFileTreeKeyboardShortcut(textarea, {})).toBe(true);
  });

  it('skips when an editor instance reports text focus', () => {
    const editor = createMockEditor({ hasTextFocus: true });
    expect(shouldSkipFileTreeKeyboardShortcut(document.createElement('div'), { g1: editor })).toBe(
      true
    );
  });

  it('does not skip plain file tree rows', () => {
    const row = document.createElement('div');
    row.className = 'file-tree-row';
    expect(shouldSkipFileTreeKeyboardShortcut(row, {})).toBe(false);
  });

  it('skips when target is inside a clipboard surface', () => {
    const surface = document.createElement('div');
    surface.setAttribute('data-clipboard-surface', 'true');
    const child = document.createElement('div');
    surface.appendChild(child);
    document.body.appendChild(surface);

    expect(shouldSkipFileTreeKeyboardShortcut(child, {})).toBe(true);

    surface.remove();
  });
});

describe('shouldSkipFileTreeCopyShortcut', () => {
  it('skips when chat text is selected even if focus stays on file tree', () => {
    const chat = document.createElement('div');
    chat.setAttribute('data-clipboard-surface', 'true');
    const message = document.createElement('p');
    message.textContent = 'selected chat text';
    chat.appendChild(message);
    document.body.appendChild(chat);

    const range = document.createRange();
    range.selectNodeContents(message);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const fileTreeRow = document.createElement('div');
    fileTreeRow.setAttribute('data-file-tree', 'true');

    expect(shouldSkipFileTreeCopyShortcut(fileTreeRow, {})).toBe(true);

    selection?.removeAllRanges();
    chat.remove();
  });
});

describe('isAnyEditorCopyIntentActive', () => {
  it('returns true when editor has a non-empty selection', () => {
    const editor = createMockEditor({ hasSelection: true });
    expect(isAnyEditorCopyIntentActive({ g1: editor })).toBe(true);
  });

  it('returns false when no editor is focused or selected', () => {
    const editor = createMockEditor();
    expect(isAnyEditorCopyIntentActive({ g1: editor })).toBe(false);
  });
});

describe('editorHasCopyableSelection', () => {
  it('detects non-empty selections', () => {
    const editor = createMockEditor({ hasSelection: true });
    expect(editorHasCopyableSelection(editor)).toBe(true);
  });
});
