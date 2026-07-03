import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { MonacoEditor } from './types/monaco';

import App from './App';

let lastEditor: MonacoEditor | null = null;

vi.mock('@tauri-apps/api/core', () => {
  return {
    convertFileSrc: (p: string) => p,
    invoke: vi.fn(async (cmd: string, _args: Record<string, unknown>) => {
      if (cmd === 'open_folder') return [];
      if (cmd === 'read_folder_children') return [];
      if (cmd === 'read_file_content') return 'hello world\n';
      if (cmd === 'search_in_folder') {
        return [
          {
            path: 'C:\\testproj\\a.txt',
            matches: [{ line: 1, column: 1, preview: 'hello world', match_len: 5 }],
          },
        ];
      }
      return null;
    }),
  };
});

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => null),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    constructor() {}
    setPosition() {}
    close() {}
  },
}));

vi.mock('@tauri-apps/api/window', () => {
  return {
    LogicalPosition: class {
      constructor(
        public x: number,
        public y: number
      ) {}
    },
    getCurrentWindow: () => {
      return {
        show: async () => undefined,
        isMaximized: async () => false,
        toggleMaximize: async () => undefined,
        minimize: async () => undefined,
        close: async () => undefined,
        startDragging: async () => undefined,
        onResized: async () => () => {},
      };
    },
  };
});

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  const { useEffect } = React;

  interface EditorProps {
    path?: string;
    onMount?: (editor: MonacoEditor) => void;
  }

  const Editor = (props: EditorProps) => {
    const { path, onMount } = props;
    useEffect(() => {
      const editor = {
        getDomNode: () => document.createElement('div'),
        onDidDispose: (cb: () => void) => cb,
        layout: vi.fn(),
        revealLineInCenter: vi.fn(),
        setPosition: vi.fn(),
        setSelection: vi.fn(),
        focus: vi.fn(),
      };
      lastEditor = editor as unknown as MonacoEditor;

      setTimeout(() => {
        onMount?.(editor as unknown as MonacoEditor);
      }, 50);
    }, [path, onMount]);

    return React.createElement('div', { 'data-testid': 'monaco' });
  };

  return { default: Editor };
});

beforeEach(() => {
  window.history.pushState({}, '', '/?projectPath=C:%5Ctestproj');
  lastEditor = null;
});

afterEach(() => {
  cleanup();
});

test('clicking a search result jumps on first click even when file not yet active', async () => {
  const user = userEvent.setup();

  render(<App />);

  await user.click(screen.getByLabelText('Search'));

  const input = screen.getByPlaceholderText('Search');
  await user.type(input, 'hello');

  await user.click(await screen.findByRole('button', { name: /1:1/ }));

  // Editor mounts later; the bug requires a second click to jump.
  await new Promise((r) => setTimeout(r, 120));

  expect(lastEditor).toBeTruthy();
  expect(lastEditor?.setSelection).toHaveBeenCalledTimes(1);
});
