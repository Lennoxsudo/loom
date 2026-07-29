import { useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';

import { getMonacoInstance } from '../monaco-loader';
import { useGitBlameInEditor, useLanguage } from '../stores/useSettingsStore';
import { buildGitBlameDecorations, fetchGitBlameLines } from '../utils/monacoGitBlame';

export function useMonacoGitBlame(options: {
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  filePath?: string;
  projectPath?: string;
  enabled?: boolean;
}): void {
  const { editor, filePath, projectPath, enabled = true } = options;
  const gitBlameInEditor = useGitBlameInEditor();
  const language = useLanguage();
  const decorationIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const clearDecorations = () => {
      if (!editor || decorationIdsRef.current.length === 0) return;
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
    };

    if (!editor || !enabled || !gitBlameInEditor || !filePath?.trim() || !projectPath?.trim()) {
      clearDecorations();
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const lines = await fetchGitBlameLines(projectPath, filePath);
        if (cancelled || !editor) return;
        const monaco = getMonacoInstance();
        const locale = language === 'zh-CN' ? 'zh-CN' : 'en';
        decorationIdsRef.current = editor.deltaDecorations(
          decorationIdsRef.current,
          buildGitBlameDecorations(monaco, lines, locale)
        );
      } catch {
        if (!cancelled) clearDecorations();
      }
    };

    void load();

    return () => {
      cancelled = true;
      clearDecorations();
    };
  }, [editor, enabled, filePath, projectPath, gitBlameInEditor, language]);
}
