import type { MonacoEditor, MonacoModel, MonacoSelection } from '../types/monaco';

function hasNonEmptySelection(editor: MonacoEditor): boolean {
  const selections = editor.getSelections?.() ?? [];
  if (selections.some((selection) => !selection.isEmpty())) {
    return true;
  }

  const selection = editor.getSelection();
  return !!selection && !selection.isEmpty();
}

function getValueInRange(model: MonacoModel, range: MonacoSelection): string {
  const getValueInRangeFn = (
    model as MonacoModel & { getValueInRange?: (range: MonacoSelection) => string }
  ).getValueInRange;
  if (typeof getValueInRangeFn === 'function') {
    return getValueInRangeFn.call(model, range);
  }

  const lines: string[] = [];
  for (let line = range.startLineNumber; line <= range.endLineNumber; line++) {
    const lineContent = model.getLineContent(line);
    if (range.startLineNumber === range.endLineNumber) {
      lines.push(lineContent.slice(range.startColumn - 1, range.endColumn - 1));
      continue;
    }
    if (line === range.startLineNumber) {
      lines.push(lineContent.slice(range.startColumn - 1));
      continue;
    }
    if (line === range.endLineNumber) {
      lines.push(lineContent.slice(0, range.endColumn - 1));
      continue;
    }
    lines.push(lineContent);
  }
  return lines.join('\n');
}

function getSelectionCopyText(editor: MonacoEditor, model: MonacoModel): string | null {
  const selections = editor.getSelections?.() ?? [];
  const nonEmptySelections = selections.filter((selection) => !selection.isEmpty());

  if (nonEmptySelections.length > 0) {
    return nonEmptySelections.map((selection) => getValueInRange(model, selection)).join('\n');
  }

  const selection = editor.getSelection();
  if (selection && !selection.isEmpty()) {
    return getValueInRange(model, selection);
  }

  return null;
}

export function getEditorCopyText(
  editor: MonacoEditor,
  options?: { fullDocument?: boolean }
): string {
  const model = editor.getModel();
  if (!model) {
    return editor.getValue();
  }

  if (!options?.fullDocument) {
    const selectionText = getSelectionCopyText(editor, model);
    if (selectionText !== null) {
      return selectionText;
    }
  }

  return model.getValue();
}

export async function copyEditorContent(
  editor: MonacoEditor,
  options?: { fullDocument?: boolean }
): Promise<boolean> {
  const text = getEditorCopyText(editor, options);

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy editor content:', error);
    return false;
  }
}

export async function pasteEditorContent(editor: MonacoEditor): Promise<boolean> {
  try {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.readText !== 'function') {
      return false;
    }

    const text = await clipboard.readText();
    if (typeof text !== 'string' || text.length === 0) {
      return false;
    }

    const selections = editor.getSelections();
    if (!selections || selections.length === 0) {
      return false;
    }

    editor.executeEdits(
      'clipboard',
      selections.map((selection) => ({
        range: selection,
        text,
        forceMoveMarkers: true,
      }))
    );
    return true;
  } catch (error) {
    console.error('Failed to paste editor content:', error);

    try {
      const action = editor.getAction('editor.action.clipboardPasteAction');
      if (action?.run) {
        await action.run();
        return true;
      }
    } catch {
      /* ignore fallback errors */
    }

    return false;
  }
}

export async function cutEditorContent(editor: MonacoEditor): Promise<boolean> {
  if (!hasNonEmptySelection(editor)) {
    return false;
  }

  const text = getEditorCopyText(editor);
  const selections = editor.getSelections();
  if (!selections || selections.length === 0) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    editor.executeEdits(
      'clipboard',
      selections.map((selection) => ({
        range: selection,
        text: '',
        forceMoveMarkers: true,
      }))
    );
    return true;
  } catch (error) {
    console.error('Failed to cut editor content:', error);

    try {
      const action = editor.getAction('editor.action.clipboardCutAction');
      if (action?.run) {
        await action.run();
        return true;
      }
    } catch {
      /* ignore fallback errors */
    }

    return false;
  }
}
