/**
 * Monaco Editor 类型定义
 * 提供 Monaco 编辑器的类型扩展，用于消除代码中的类型断言
 */

import type * as Monaco from 'monaco-editor';

export interface MonacoModel {
  getValue(): string;
  getValueInRange?(range: MonacoSelection): string;
  getValueLength(): number;
  setValue(value: string): void;
  getLineCount(): number;
  getLineMaxColumn(lineNumber: number): number;
  getLineContent(lineNumber: number): string;
  updateOptions(opts: { tabSize?: number; insertSpaces?: boolean }): void;
  getLanguageId(): string;
  getURI(): Monaco.Uri;
  uri?: { fsPath?: string; path?: string; toString?: () => string };
  dispose(): void;
}

export interface MonacoSelection {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  isEmpty(): boolean;
}

export interface MonacoPosition {
  lineNumber: number;
  column: number;
}

export interface MonacoViewState {
  scrollTop: number;
  scrollLeft: number;
  cursorState: Monaco.ICursorState[];
}

export interface MonacoAction {
  id: string;
  label: string;
  run(): Promise<void>;
  isSupported?(): boolean;
}

export interface MonacoEditor {
  focus(): void;
  layout(): void;
  dispose(): void;

  getValue(): string;
  setValue(value: string): void;
  getModel(): MonacoModel | null;

  getSelection(): MonacoSelection | null;
  getSelections(): MonacoSelection[];
  setSelection(
    selection:
      | MonacoSelection
      | { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
  ): void;

  getPosition(): MonacoPosition | null;
  setPosition(position: MonacoPosition): void;

  revealRangeInCenter(range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }): void;
  revealLineInCenter(lineNumber: number): void;

  executeEdits(
    source: string,
    edits: Array<{
      range:
        | MonacoSelection
        | {
            startLineNumber: number;
            startColumn: number;
            endLineNumber: number;
            endColumn: number;
          };
      text: string;
      forceMoveMarkers?: boolean;
    }>
  ): void;
  trigger(source: string, handlerId: string, payload?: unknown): void;

  getAction(id: string): MonacoAction | null;

  saveViewState(): MonacoViewState | null;
  restoreViewState(state: MonacoViewState): void;

  onDidChangeModel(callback: () => void): { dispose: () => void };
  onDidDispose(callback: () => void): { dispose: () => void };

  getDomNode(): HTMLElement | null;

  updateOptions(opts: Record<string, unknown>): void;
}

export interface EditorInstanceMap {
  [groupId: string]: MonacoEditor | undefined;
}

export interface ClipboardAPI {
  readText(): Promise<string>;
}

declare global {
  interface Navigator {
    clipboard?: ClipboardAPI;
  }
}
