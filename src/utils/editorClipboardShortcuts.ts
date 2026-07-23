import type { MonacoEditor } from '../types/monaco';
import { getMonacoInstance } from '../monaco-loader';
import { copyEditorContent, cutEditorContent, pasteEditorContent } from './editorClipboard';

type MonacoEditorWithCommands = MonacoEditor & {
  addCommand(keybinding: number, handler: () => void | Promise<void>): string | null;
};

export function installEditorClipboardShortcuts(
  editor: MonacoEditor,
  options?: { readOnly?: boolean }
): void {
  const monaco = getMonacoInstance();
  const editorWithCommands = editor as MonacoEditorWithCommands;
  if (typeof editorWithCommands.addCommand !== 'function') {
    return;
  }

  const { KeyMod, KeyCode } = monaco;

  editorWithCommands.addCommand(KeyMod.CtrlCmd | KeyCode.KeyC, () => {
    void copyEditorContent(editor);
  });

  if (!options?.readOnly) {
    editorWithCommands.addCommand(KeyMod.CtrlCmd | KeyCode.KeyV, () => {
      void pasteEditorContent(editor);
    });

    editorWithCommands.addCommand(KeyMod.CtrlCmd | KeyCode.KeyX, () => {
      void cutEditorContent(editor);
    });
  }
}
