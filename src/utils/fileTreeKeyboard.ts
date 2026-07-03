import type { EditorInstanceMap, MonacoEditor } from '../types/monaco';

export const CLIPBOARD_SURFACE_SELECTOR = '[data-clipboard-surface="true"]';
export const FILE_TREE_SURFACE_SELECTOR = '[data-file-tree="true"]';

function collectKeyboardTargetElements(target: EventTarget | null): HTMLElement[] {
  const elements: HTMLElement[] = [];
  if (target instanceof HTMLElement) {
    elements.push(target);
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement && !elements.includes(active)) {
    elements.push(active);
  }
  return elements;
}

function isStandardTextInput(element: HTMLElement): boolean {
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.isContentEditable
  );
}

function isInsideMonacoEditorDom(element: HTMLElement): boolean {
  return Boolean(element.closest('.monaco-editor'));
}

function editorHasTextFocus(editor: MonacoEditor): boolean {
  const editorWithFocus = editor as MonacoEditor & {
    hasTextFocus?: () => boolean;
    hasWidgetFocus?: () => boolean;
  };
  return Boolean(editorWithFocus.hasTextFocus?.() || editorWithFocus.hasWidgetFocus?.());
}

function editorContainsElement(editor: MonacoEditor, element: HTMLElement): boolean {
  const domNode = editor.getDomNode?.();
  return Boolean(domNode?.contains(element));
}

export function isAnyEditorClipboardSurfaceActive(editors: EditorInstanceMap): boolean {
  for (const editor of Object.values(editors)) {
    if (!editor) {
      continue;
    }
    if (editorHasTextFocus(editor)) {
      return true;
    }
  }
  return false;
}

export function editorHasCopyableSelection(editor: MonacoEditor): boolean {
  const selections = editor.getSelections?.() ?? [];
  if (selections.some((selection) => !selection.isEmpty())) {
    return true;
  }
  const selection = editor.getSelection();
  return Boolean(selection && !selection.isEmpty());
}

export function isAnyEditorCopyIntentActive(editors: EditorInstanceMap): boolean {
  if (isAnyEditorClipboardSurfaceActive(editors)) {
    return true;
  }
  for (const editor of Object.values(editors)) {
    if (!editor) {
      continue;
    }
    if (editorHasCopyableSelection(editor)) {
      return true;
    }
  }
  return false;
}

export function hasNonCollapsedTextSelection(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return false;
  }
  return selection.toString().length > 0;
}

function isInsideClipboardSurface(element: HTMLElement): boolean {
  return Boolean(element.closest(CLIPBOARD_SURFACE_SELECTOR));
}

function selectionAnchorIsOutsideFileTree(): boolean {
  if (!hasNonCollapsedTextSelection()) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection) {
    return false;
  }

  const nodes = [selection.anchorNode, selection.focusNode];
  for (const node of nodes) {
    if (!node) continue;
    const element = node instanceof HTMLElement ? node : node.parentElement;
    if (!element) continue;
    if (!element.closest(FILE_TREE_SURFACE_SELECTOR)) {
      return true;
    }
  }

  return false;
}

export function shouldSkipFileTreeCopyShortcut(
  target: EventTarget | null,
  editors: EditorInstanceMap
): boolean {
  if (shouldSkipFileTreeKeyboardShortcut(target, editors)) {
    return true;
  }
  if (isAnyEditorCopyIntentActive(editors)) {
    return true;
  }
  return hasNonCollapsedTextSelection() && selectionAnchorIsOutsideFileTree();
}

export function shouldSkipFileTreeKeyboardShortcut(
  target: EventTarget | null,
  editors: EditorInstanceMap
): boolean {
  const elements = collectKeyboardTargetElements(target);

  for (const element of elements) {
    if (isStandardTextInput(element)) {
      return true;
    }
    if (isInsideMonacoEditorDom(element)) {
      return true;
    }
    if (element.closest('.xterm')) {
      return true;
    }
    if (isInsideClipboardSurface(element)) {
      return true;
    }
  }

  if (isAnyEditorClipboardSurfaceActive(editors)) {
    return true;
  }

  for (const editor of Object.values(editors)) {
    if (!editor) {
      continue;
    }
    for (const element of elements) {
      if (editorContainsElement(editor, element)) {
        return true;
      }
    }
  }

  return false;
}
