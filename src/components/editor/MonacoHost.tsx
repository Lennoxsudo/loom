import { useEffect, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import type { MonacoEditor } from '../../types/monaco';
import { getMonacoInstance } from '../../monaco-loader';
import { applyMonacoTheme } from '../../utils/monacoTheme';
import { forceRegisterTokenizers } from '../../monaco-languages';
import { loadMonacoLanguage, isLanguageLoaded, languageLoadMonitor } from '../../utils/monacoLanguageLoader';
import { installEditorClipboardShortcuts } from '../../utils/editorClipboardShortcuts';

export interface MonacoHostProps {
  modelUri: string;
  language: string;
  value: string;
  groupId: string;
  filePath?: string;
  fontSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  cursorStyle: 'line' | 'block' | 'underline';
  cursorBlinking: 'blink' | 'smooth' | 'phase' | 'solid';
  tabSize: 2 | 4 | 8;
  themeMode?: 'system' | 'dark' | 'light';
  renderWhitespace?: 'none' | 'boundary' | 'selection' | 'all';
  currentLineHighlight?: boolean;
  bracketPairColorization?: boolean;
  readOnly?: boolean;
  onChange: (value: string | undefined, ev?: unknown) => void;
  onMount?: (editor: MonacoEditor) => void;
}

export interface MonacoDiffHostProps {
  originalValue?: string;
  modifiedValue?: string;
  originalUri?: string;
  modifiedUri?: string;
  original?: string;
  modified?: string;
  language: string;
  fontSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  tabSize: 2 | 4 | 8;
  themeMode?: 'system' | 'dark' | 'light';
  renderWhitespace?: 'none' | 'boundary' | 'selection' | 'all';
  currentLineHighlight?: boolean;
  bracketPairColorization?: boolean;
  readOnly?: boolean;
  renderSideBySide?: boolean;
}

const viewStates = new Map<string, Monaco.editor.ICodeEditorViewState | null>();

function getContainerDimension(
  container: HTMLDivElement | null
): Monaco.editor.IDimension | undefined {
  if (!container) return undefined;
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
}

function layoutEditor(
  editor: Monaco.editor.IStandaloneCodeEditor | Monaco.editor.IStandaloneDiffEditor,
  container: HTMLDivElement | null
) {
  const dimension = getContainerDimension(container);
  if (dimension) {
    editor.layout(dimension);
    return;
  }
  editor.layout();
}

function createModel(
  monaco: typeof Monaco,
  modelUri: string,
  value: string,
  language: string
): Monaco.editor.ITextModel {
  const uri = monaco.Uri.parse(modelUri);
  const existing = monaco.editor.getModel(uri);
  if (existing) {
    if (existing.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(existing, language);
    }
    if (existing.getValue() !== value) {
      existing.setValue(value);
    }
    return existing;
  }
  return monaco.editor.createModel(value, language, uri);
}

const COMMON_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  contextmenu: false,
  detectIndentation: false,
  scrollBeyondLastLine: false,
  renderLineHighlight: 'all',
  padding: { top: 12, bottom: 12 },
  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
  fontLigatures: false,
  disableLayerHinting: true,
  letterSpacing: 0,
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    useShadows: false,
  },
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  glyphMargin: false,
  folding: true,
  lineDecorationsWidth: 10,
  lineNumbersMinChars: 3,
};

export function MonacoHost(props: MonacoHostProps) {
  const {
    modelUri,
    language,
    value,
    groupId,
    fontSize,
    wordWrap,
    lineNumbers,
    minimap,
    cursorStyle,
    cursorBlinking,
    tabSize,
    themeMode = 'system',
    renderWhitespace = 'none',
    currentLineHighlight = true,
    bracketPairColorization = true,
    readOnly = false,
    onChange,
    onMount,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const currentOnChangeRef = useRef(onChange);
  const currentOnMountRef = useRef(onMount);
  const changeDisposableRef = useRef<Monaco.IDisposable | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const langDisposableRef = useRef<Monaco.IDisposable | null>(null);
  const valueRef = useRef(value);
  const [isLanguageReady, setIsLanguageReady] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  valueRef.current = value;

  useEffect(() => {
    currentOnChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    currentOnMountRef.current = onMount;
  }, [onMount]);

  // 加载Monaco语言的useEffect
  useEffect(() => {
    // 检查语言是否已经加载
    if (isLanguageLoaded(language)) {
      setIsLanguageReady(true);
      return;
    }

    // 异步加载语言
    const startTime = languageLoadMonitor.startLoad(language);
    loadMonacoLanguage(language)
      .then(() => {
        languageLoadMonitor.endLoad(language, startTime);
        setIsLanguageReady(true);
        setLoadingError(null);
      })
      .catch((error) => {
        languageLoadMonitor.recordError(language, error);
        setLoadingError(`Failed to load language "${language}": ${error.message}`);
        console.error(`[MonacoHost] Error loading language "${language}":`, error);
        // 即使加载失败，也尝试继续（可能使用纯文本模式）
        setIsLanguageReady(true);
      });
  }, [language]);

  // 创建编辑器的useEffect
  useEffect(() => {
    if (!isLanguageReady) {
      return; // 等待语言加载完成
    }

    const monaco = getMonacoInstance();
    if (!containerRef.current) return;

    applyMonacoTheme(monaco, themeMode);
    const model = createModel(monaco, modelUri, valueRef.current, language);
    const initialDimension = getContainerDimension(containerRef.current);

    const editor = monaco.editor.create(containerRef.current, {
      ...COMMON_OPTIONS,
      minimap: { enabled: minimap },
      fontSize,
      lineHeight: 22,
      wordWrap: wordWrap ? 'on' : 'off',
      lineNumbers: lineNumbers ? 'on' : 'off',
      cursorStyle,
      cursorBlinking,
      tabSize,
      readOnly,
      renderWhitespace,
      renderLineHighlight: currentLineHighlight ? 'all' : 'none',
      bracketPairColorization: { enabled: bracketPairColorization },
      // 仅用 bracketPairColorization 只关彩虹着色；配对括号的块状高亮由 matchBrackets 控制（默认 always）
      matchBrackets: bracketPairColorization ? 'always' : 'never',
      insertSpaces: true,
      model,
      dimension: initialDimension,
    });

    editorRef.current = editor;

    installEditorClipboardShortcuts(editor as unknown as MonacoEditor, {
      readOnly,
    });

    const savedViewState = viewStates.get(modelUri);
    if (savedViewState) {
      editor.restoreViewState(savedViewState);
    }

    changeDisposableRef.current = editor.onDidChangeModelContent((event) => {
      currentOnChangeRef.current(editor.getValue(), event);
    });

    resizeObserverRef.current = new ResizeObserver(() => {
      if (editorRef.current) layoutEditor(editorRef.current, containerRef.current);
    });
    resizeObserverRef.current.observe(containerRef.current);

    currentOnMountRef.current?.(editor as unknown as MonacoEditor);

    const initModel = editor.getModel();
    if (initModel) {
      const initLangId = initModel.getLanguageId();

      forceRegisterTokenizers();

      langDisposableRef.current?.dispose();
      langDisposableRef.current = monaco.languages.onLanguage(initLangId, () => {
        const ed = editorRef.current;
        if (ed) {
          ed.trigger('wv2-fix', 'editor.action.forceRetokenize', null);
        }
      });

      const existingLang = monaco.languages.getLanguages().find(l => l.id === initLangId);
      if (existingLang && editorRef.current) {
        editorRef.current.trigger('wv2-fix', 'editor.action.forceRetokenize', null);
      }
    }

    return () => {
      if (editorRef.current) {
        viewStates.set(modelUri, editorRef.current.saveViewState());
        changeDisposableRef.current?.dispose();
        langDisposableRef.current?.dispose();
        resizeObserverRef.current?.disconnect();
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, [
    modelUri,
    language,
    groupId,
    fontSize,
    wordWrap,
    lineNumbers,
    minimap,
    cursorStyle,
    cursorBlinking,
    tabSize,
    themeMode,
    renderWhitespace,
    currentLineHighlight,
    bracketPairColorization,
    isLanguageReady, // 添加依赖
  ]);

  if (!isLanguageReady) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontSize: '14px',
          backgroundColor: 'var(--bg-editor)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div>Loading {language} language support...</div>
          {loadingError && <div style={{ fontSize: '12px', color: 'var(--text-error)', marginTop: '8px' }}>{loadingError}</div>}
        </div>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%', backgroundColor: 'var(--bg-editor)' }} />;
}

export function MonacoDiffHost(props: MonacoDiffHostProps) {
  const {
    originalValue,
    modifiedValue,
    originalUri,
    modifiedUri,
    original,
    modified,
    language,
    fontSize,
    wordWrap,
    lineNumbers,
    minimap,
    tabSize,
    themeMode = 'system',
    renderWhitespace = 'none',
    currentLineHighlight = true,
    bracketPairColorization = true,
    readOnly,
    renderSideBySide,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const langDisposableRef = useRef<Monaco.IDisposable | null>(null);
  const [isLanguageReady, setIsLanguageReady] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  // 加载Monaco语言的useEffect
  useEffect(() => {
    // 检查语言是否已经加载
    if (isLanguageLoaded(language)) {
      setIsLanguageReady(true);
      return;
    }

    // 异步加载语言
    const startTime = languageLoadMonitor.startLoad(language);
    loadMonacoLanguage(language)
      .then(() => {
        languageLoadMonitor.endLoad(language, startTime);
        setIsLanguageReady(true);
        setLoadingError(null);
      })
      .catch((error) => {
        languageLoadMonitor.recordError(language, error);
        setLoadingError(`Failed to load language "${language}": ${error.message}`);
        console.error(`[MonacoDiffHost] Error loading language "${language}":`, error);
        // 即使加载失败，也尝试继续（可能使用纯文本模式）
        setIsLanguageReady(true);
      });
  }, [language]);

  useEffect(() => {
    if (!isLanguageReady) {
      return; // 等待语言加载完成
    }

    const monaco = getMonacoInstance();
    if (!containerRef.current) return;

    applyMonacoTheme(monaco, themeMode);
    const oVal = originalValue ?? original ?? '';
    const mVal = modifiedValue ?? modified ?? '';
    const oUri = originalUri ?? `inmemory://original/${Date.now()}`;
    const mUri = modifiedUri ?? `inmemory://modified/${Date.now()}`;

    const originalModel = createModel(monaco, oUri, oVal, language);
    const modifiedModel = createModel(monaco, mUri, mVal, language);
    const initialDimension = getContainerDimension(containerRef.current);

    const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
      ...COMMON_OPTIONS,
      fontSize,
      lineHeight: 22,
      wordWrap: wordWrap ? 'on' : 'off',
      lineNumbers: lineNumbers ? 'on' : 'off',
      minimap: { enabled: minimap },
      renderWhitespace,
      renderLineHighlight: currentLineHighlight ? 'all' : 'none',
      bracketPairColorization: { enabled: bracketPairColorization },
      matchBrackets: bracketPairColorization ? 'always' : 'never',
      renderSideBySide: renderSideBySide ?? true,
      readOnly: readOnly ?? false,
      dimension: initialDimension,
    });

    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    diffEditorRef.current = diffEditor;

    forceRegisterTokenizers();

    langDisposableRef.current?.dispose();
    langDisposableRef.current = monaco.languages.onLanguage(language, () => {
      const de = diffEditorRef.current;
      if (de) {
        de.getOriginalEditor().trigger('wv2-fix', 'editor.action.forceRetokenize', null);
        de.getModifiedEditor().trigger('wv2-fix', 'editor.action.forceRetokenize', null);
      }
    });

    const existingLang = monaco.languages.getLanguages().find(l => l.id === language);
    if (existingLang && diffEditorRef.current) {
      diffEditorRef.current.getOriginalEditor().trigger('wv2-fix', 'editor.action.forceRetokenize', null);
      diffEditorRef.current.getModifiedEditor().trigger('wv2-fix', 'editor.action.forceRetokenize', null);
    }

    resizeObserverRef.current = new ResizeObserver(() => {
      if (diffEditorRef.current) layoutEditor(diffEditorRef.current, containerRef.current);
    });
    resizeObserverRef.current.observe(containerRef.current);

    return () => {
      if (diffEditorRef.current) {
        langDisposableRef.current?.dispose();
        resizeObserverRef.current?.disconnect();
        diffEditorRef.current.dispose();
        diffEditorRef.current = null;
      }
    };
  }, [
    originalValue,
    modifiedValue,
    originalUri,
    modifiedUri,
    original,
    modified,
    language,
    fontSize,
    wordWrap,
    lineNumbers,
    minimap,
    tabSize,
    themeMode,
    renderWhitespace,
    currentLineHighlight,
    bracketPairColorization,
    readOnly,
    renderSideBySide,
    isLanguageReady, // 添加依赖
  ]);

  if (!isLanguageReady) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontSize: '14px',
          backgroundColor: 'var(--bg-editor)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div>Loading {language} language support...</div>
          {loadingError && <div style={{ fontSize: '12px', color: 'var(--text-error)', marginTop: '8px' }}>{loadingError}</div>}
        </div>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%', backgroundColor: 'var(--bg-editor)' }} />;
}
