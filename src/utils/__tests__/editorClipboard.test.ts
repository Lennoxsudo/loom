import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getEditorCopyText,
  copyEditorContent,
  pasteEditorContent,
  cutEditorContent,
} from '../editorClipboard';
import type { MonacoEditor, MonacoModel, MonacoSelection } from '../../types/monaco';

function createSelection(
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
  isEmpty = false
): MonacoSelection {
  return {
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
    isEmpty: () => isEmpty,
  };
}

function createMockEditor(options: {
  modelValue?: string;
  selection?: MonacoSelection | null;
  selections?: MonacoSelection[];
  getValueInRange?: (range: MonacoSelection) => string;
  model?: MonacoModel | null;
}): MonacoEditor {
  const modelValue = options.modelValue ?? 'full document content';
  const model: MonacoModel =
    options.model ??
    ({
      getValue: () => modelValue,
      getLineContent: (line: number) => modelValue.split('\n')[line - 1] ?? '',
      getValueInRange: options.getValueInRange,
    } as MonacoModel);

  return {
    getModel: () => model,
    getValue: () => modelValue,
    getSelection: () => options.selection ?? null,
    getSelections: () => options.selections,
  } as MonacoEditor;
}

describe('editorClipboard', () => {
  describe('getEditorCopyText', () => {
    it('returns selection text when a non-empty selection exists', () => {
      const selection = createSelection(1, 3, 1, 8);
      const editor = createMockEditor({
        modelValue: 'hello world',
        selection,
        getValueInRange: () => 'llo w',
      });

      expect(getEditorCopyText(editor)).toBe('llo w');
    });

    it('returns full document when selection is empty', () => {
      const selection = createSelection(1, 1, 1, 1, true);
      const editor = createMockEditor({
        modelValue: 'entire file',
        selection,
      });

      expect(getEditorCopyText(editor)).toBe('entire file');
    });

    it('merges multiple non-empty selections', () => {
      const selections = [createSelection(1, 1, 1, 3), createSelection(2, 1, 2, 4)];
      const editor = createMockEditor({
        modelValue: 'alpha\nbeta\ngamma',
        selections,
        getValueInRange: (range) => {
          if (range.startLineNumber === 1) return 'alp';
          if (range.startLineNumber === 2) return 'bet';
          return '';
        },
      });

      expect(getEditorCopyText(editor)).toBe('alp\nbet');
    });

    it('returns full document when fullDocument option is set', () => {
      const selection = createSelection(1, 3, 1, 8);
      const editor = createMockEditor({
        modelValue: 'hello world',
        selection,
        getValueInRange: () => 'llo w',
      });

      expect(getEditorCopyText(editor, { fullDocument: true })).toBe('hello world');
    });

    it('falls back to editor.getValue when model is missing', () => {
      const editor = {
        getModel: () => null,
        getValue: () => 'fallback value',
      } as MonacoEditor;

      expect(getEditorCopyText(editor)).toBe('fallback value');
    });
  });

  describe('copyEditorContent', () => {
    const writeText = vi.fn();

    beforeEach(() => {
      writeText.mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('writes resolved text to clipboard', async () => {
      const editor = createMockEditor({ modelValue: 'copy me' });

      const result = await copyEditorContent(editor);

      expect(result).toBe(true);
      expect(writeText).toHaveBeenCalledWith('copy me');
    });

    it('returns false when clipboard write fails', async () => {
      writeText.mockRejectedValue(new Error('denied'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const editor = createMockEditor({ modelValue: 'copy me' });

      const result = await copyEditorContent(editor);

      expect(result).toBe(false);
      consoleError.mockRestore();
    });
  });

  describe('pasteEditorContent', () => {
    const readText = vi.fn();
    const writeText = vi.fn();

    beforeEach(() => {
      readText.mockResolvedValue('pasted text');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText, writeText },
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('inserts clipboard text at current selections', async () => {
      const selection = createSelection(1, 1, 1, 1, true);
      const executeEdits = vi.fn();
      const editor = {
        ...createMockEditor({ modelValue: 'hello', selection, selections: [selection] }),
        executeEdits,
      } as MonacoEditor;

      const result = await pasteEditorContent(editor);

      expect(result).toBe(true);
      expect(executeEdits).toHaveBeenCalledWith('clipboard', [
        {
          range: selection,
          text: 'pasted text',
          forceMoveMarkers: true,
        },
      ]);
    });
  });

  describe('cutEditorContent', () => {
    const writeText = vi.fn();

    beforeEach(() => {
      writeText.mockClear();
      writeText.mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('copies selection and clears it', async () => {
      const selection = createSelection(1, 1, 1, 4);
      const executeEdits = vi.fn();
      const editor = {
        ...createMockEditor({
          modelValue: 'hello',
          selection,
          selections: [selection],
          getValueInRange: () => 'hel',
        }),
        executeEdits,
      } as MonacoEditor;

      const result = await cutEditorContent(editor);

      expect(result).toBe(true);
      expect(writeText).toHaveBeenCalledWith('hel');
      expect(executeEdits).toHaveBeenCalledWith('clipboard', [
        {
          range: selection,
          text: '',
          forceMoveMarkers: true,
        },
      ]);
    });

    it('does nothing when selection is empty', async () => {
      const selection = createSelection(1, 1, 1, 1, true);
      const executeEdits = vi.fn();
      const editor = {
        ...createMockEditor({ modelValue: 'hello', selection, selections: [selection] }),
        executeEdits,
      } as MonacoEditor;

      const result = await cutEditorContent(editor);

      expect(result).toBe(false);
      expect(writeText).not.toHaveBeenCalled();
      expect(executeEdits).not.toHaveBeenCalled();
    });
  });
});
