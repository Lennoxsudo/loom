import { useMemo, useState, useRef, useEffect, type CSSProperties, type ReactNode } from 'react';
import { MonacoHost, MonacoDiffHost } from './editor/MonacoHost';
import { EditorCopyButton } from './editor/EditorCopyButton';
import type { MonacoEditor } from '../types/monaco';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from '../i18n';
import { useThemeMode } from '../stores';
import { FileTypeIcon } from './shared/FileTypeIcon';

// 图标组件
function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function DiffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function MarkdownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M9 15v-2l2 2 2-2v2" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

// Markdown 渲染子组件
interface MdCodeBlockProps {
  children?: ReactNode;
  className?: string;
  node?: unknown;
  ref?: unknown;
}

const MdCodeBlock = ({ children, className, node: _node, ref: _ref, ...rest }: MdCodeBlockProps) => {
  const match = /language-(\w+)/.exec(className || '');
  const isInline = !match && !String(children).includes('\n');

  if (isInline) {
    return (
      <code
        {...rest}
        style={{
          backgroundColor: 'rgba(100, 100, 100, 0.25)',
          padding: '2px 5px',
          borderRadius: '4px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.88em',
        }}
      >
        {children}
      </code>
    );
  }

  return (
    <div style={{ margin: '10px 0', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', backgroundColor: 'rgba(0,0,0,0.3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 12px', backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#999', fontSize: '11px' }}>
        <span style={{ fontWeight: 600 }}>{match?.[1] || 'text'}</span>
      </div>
      <SyntaxHighlighter
        {...rest}
        PreTag="div"
        children={String(children).replace(/\n$/, '')}
        language={match ? match[1] : 'text'}
        style={vscDarkPlus}
        customStyle={{ margin: 0, padding: '12px', fontSize: '12px', backgroundColor: 'transparent' }}
      />
    </div>
  );
};

export type PreviewMode = 'preview' | 'diff';

interface PreviewFile {
  filePath: string;
  content: string;
  originalContent?: string;
  modifiedContent?: string;
  language?: string;
}

export interface FilePreviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  mode: PreviewMode;
  onModeChange?: (mode: PreviewMode) => void;
  previewWidth?: number;

  // 多文件支持
  files?: PreviewFile[];
  currentIndex?: number;
  onSelectFile?: (index: number) => void;

  // 兼容旧接口（单文件）
  filePath?: string;
  content?: string;
  originalContent?: string;
  modifiedContent?: string;
  language?: string;
  embedded?: boolean;
}

// 根据文件扩展名推断语言
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    md: 'markdown',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    toml: 'ini', // Monaco Editor 不支持 TOML，使用 INI 替代
  };
  return langMap[ext] || 'plaintext';
}

// 从路径中提取文件名
function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

export default function FilePreviewPanel({
  isOpen,
  onClose,
  mode,
  onModeChange,
  previewWidth = 420,
  files = [],
  currentIndex = 0,
  onSelectFile,
  filePath = '',
  content = '',
  originalContent = '',
  modifiedContent = '',
  language,
  embedded = false,
}: FilePreviewPanelProps) {
  const t = useTranslation();
  const themeMode = useThemeMode();

  // 用于横向滚动的 ref
  const tabScrollRef = useRef<HTMLDivElement | null>(null);

  // 手动绑定非 passive 的 wheel 事件，支持横向滚动标签
  useEffect(() => {
    const el = tabScrollRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY * 0.5;
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const [isHoverClose, setIsHoverClose] = useState(false);
  const [mdRendered, setMdRendered] = useState(true);
  const [monacoEditor, setMonacoEditor] = useState<MonacoEditor | null>(null);

  const activeFile = useMemo(() => {
    if (files.length > 0 && currentIndex >= 0 && currentIndex < files.length) {
      return files[currentIndex];
    }
    return {
      filePath,
      content,
      originalContent,
      modifiedContent,
      language,
    } satisfies PreviewFile;
  }, [files, currentIndex, filePath, content, originalContent, modifiedContent, language]);

  const detectedLanguage = useMemo(() => {
    if (activeFile.language) return activeFile.language;
    if (activeFile.filePath) return getLanguageFromPath(activeFile.filePath);
    return 'plaintext';
  }, [activeFile.language, activeFile.filePath]);

  const fileName = useMemo(() => getFileName(activeFile.filePath || ''), [activeFile.filePath]);

  const isMarkdownFile = detectedLanguage === 'markdown';

  useEffect(() => {
    setMonacoEditor(null);
  }, [activeFile.filePath, mode, mdRendered, isMarkdownFile]);

  // 计算 Diff 统计信息
  const diffStats = useMemo(() => {
    if (mode !== 'diff' || !activeFile.originalContent || !activeFile.modifiedContent) {
      return null;
    }
    const originalLines = activeFile.originalContent.split('\n');
    const modifiedLines = activeFile.modifiedContent.split('\n');
    const originalLength = originalLines.length;
    const modifiedLength = modifiedLines.length;
    const added = Math.max(0, modifiedLength - originalLength);
    const removed = Math.max(0, originalLength - modifiedLength);
    return { added, removed, originalLength, modifiedLength };
  }, [mode, activeFile.originalContent, activeFile.modifiedContent]);

  // 样式
  const containerStyle: CSSProperties = {
    width: embedded ? '100%' : `${Math.round(previewWidth)}px`,
    minWidth: embedded ? undefined : '320px',
    maxWidth: embedded ? undefined : '640px',
    height: '100%',
    display: isOpen ? 'flex' : 'none',
    flexDirection: 'column',
    backgroundColor: embedded ? 'transparent' : 'var(--bg-primary, #1e1e1e)',
    borderLeft: embedded ? undefined : '1px solid var(--border-subtle, #333)',
    boxShadow: embedded ? undefined : '-4px 0 12px rgba(0, 0, 0, 0.18)',
    overflow: 'hidden',
    zIndex: embedded ? undefined : 5,
    flexShrink: embedded ? undefined : 0,
  };

  const fileListStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 8px',
    backgroundColor: '#111',
    overflowX: 'auto',
    overflowY: 'hidden',
    borderBottom: '1px solid #222',
    flexShrink: 0,
    scrollbarWidth: 'thin',
    scrollbarColor: '#3a3a3a transparent',
    WebkitOverflowScrolling: 'touch',
  };

  const fileTabStyle = (isActive: boolean): CSSProperties => ({
    padding: '4px 10px',
    borderRadius: '4px',
    fontSize: '11px',
    color: isActive ? '#fff' : '#888',
    backgroundColor: isActive ? '#2d2d2d' : 'transparent',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.15s ease',
    border: `1px solid ${isActive ? 'rgba(255,255,255,0.08)' : 'transparent'}`,
    flexShrink: 0,
  });

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid var(--border-subtle, #333)',
    backgroundColor: '#1c1c1c',
    flexShrink: 0,
  };

  const titleSectionStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
    flex: 1,
  };

  const fileNameStyle: CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: '#e0e0e0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-mono, monospace)',
  };

  const modeToggleStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    backgroundColor: '#111',
    padding: '2px',
    borderRadius: '6px',
    marginRight: '8px',
  };

  const modeButtonStyle = (isActive: boolean): CSSProperties => ({
    all: 'unset',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    height: '24px',
    padding: '0 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 500,
    cursor: 'pointer',
    color: isActive ? '#ffffff' : '#888',
    backgroundColor: isActive ? '#333' : 'transparent',
    transition: 'all 0.15s ease',
  });

  const closeButtonStyle: CSSProperties = {
    all: 'unset',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    cursor: 'pointer',
    color: isHoverClose ? '#ff5f56' : '#888',
    backgroundColor: isHoverClose ? 'rgba(255, 95, 86, 0.1)' : 'transparent',
    transition: 'all 0.1s ease',
  };

  const editorContainerStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
  };

  const emptyStateStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#555',
    fontSize: '12px',
    gap: '12px',
  };

  if (!isOpen) {
    return null;
  }

  const hasContent =
    mode === 'preview'
      ? (activeFile.content || '').length > 0
      : (activeFile.originalContent || '').length > 0 ||
        (activeFile.modifiedContent || '').length > 0;

  return (
    <div style={containerStyle}>
      <style>
        {`
          [data-preview-tabs="true"]::-webkit-scrollbar {
            height: 6px;
            background: transparent;
          }
          [data-preview-tabs="true"]::-webkit-scrollbar-track {
            background: transparent;
          }
          [data-preview-tabs="true"]::-webkit-scrollbar-thumb {
            background-color: #3a3a3a;
            border-radius: 999px;
          }
          [data-preview-tabs="true"]::-webkit-scrollbar-corner {
            background: transparent;
          }
        `}
      </style>
      {/* 多文件列表 */}
      {files.length > 1 && (
        <div
          ref={tabScrollRef}
          style={fileListStyle}
          data-preview-tabs="true"
        >
          {files.map((file, idx) => (
            <div
              key={file.filePath}
              style={fileTabStyle(idx === currentIndex)}
              onClick={() => onSelectFile?.(idx)}
              title={file.filePath}
            >
              <FileTypeIcon name={getFileName(file.filePath)} size={14} />
              {getFileName(file.filePath)}
            </div>
          ))}
        </div>
      )}

      {/* 头部 */}
      <div style={headerStyle}>
        <div style={titleSectionStyle}>
          {mode === 'preview' ? (
            <FileTypeIcon name={fileName || 'file'} size={14} />
          ) : (
            <DiffIcon />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <span style={fileNameStyle} title={activeFile.filePath}>
              {fileName || t.preview.noFile}
            </span>
            {diffStats && (
              <div
                style={{
                  fontSize: '10px',
                  color: '#888',
                  marginTop: '2px',
                  display: 'flex',
                  gap: '8px',
                }}
              >
                {diffStats.added > 0 && (
                  <span style={{ color: '#4ec9b0' }}>+{diffStats.added}</span>
                )}
                {diffStats.removed > 0 && (
                  <span style={{ color: '#f48771' }}>-{diffStats.removed}</span>
                )}
                {diffStats.added === 0 && diffStats.removed === 0 && (
                  <span style={{ color: '#888' }}>{t.preview.noChanges}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 模式切换 */}
        <div style={modeToggleStyle}>
          <button
            type="button"
            style={modeButtonStyle(mode === 'preview')}
            onClick={() => onModeChange?.('preview')}
            title={t.preview.filePreview}
          >
            <FileIcon />
            {t.preview.filePreview}
          </button>
          <button
            type="button"
            style={modeButtonStyle(mode === 'diff')}
            onClick={() => onModeChange?.('diff')}
            title={t.preview.diffCompare}
          >
            <DiffIcon />
            {t.preview.diffCompare}
          </button>
        </div>

        {/* Markdown 格式化/源码切换 */}
        {isMarkdownFile && mode === 'preview' && (
          <div style={{ ...modeToggleStyle, marginRight: '4px' }}>
            <button
              type="button"
              style={modeButtonStyle(mdRendered)}
              onClick={() => setMdRendered(true)}
              title={t.preview.markdownRendered}
            >
              <MarkdownIcon />
              {t.preview.markdownRendered}
            </button>
            <button
              type="button"
              style={modeButtonStyle(!mdRendered)}
              onClick={() => setMdRendered(false)}
              title={t.preview.markdownSource}
            >
              <CodeIcon />
              {t.preview.markdownSource}
            </button>
          </div>
        )}

        {/* 关闭按钮 */}
        {!embedded && (
          <button
            type="button"
            style={closeButtonStyle}
            onClick={onClose}
            onMouseEnter={() => setIsHoverClose(true)}
            onMouseLeave={() => setIsHoverClose(false)}
            title={t.preview.closePreview}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {/* 编辑器区域 */}
      <div style={editorContainerStyle}>
        {!hasContent ? (
          <div style={emptyStateStyle}>
            <FileIcon />
            <span>{t.preview.noContent}</span>
            <span style={{ fontSize: '11px', color: '#555' }}>{t.preview.selectToPreview}</span>
          </div>
        ) : mode === 'preview' && isMarkdownFile && mdRendered ? (
          <div
            style={{
              height: '100%',
              overflowY: 'auto',
              padding: '20px 24px',
              fontSize: '14px',
              lineHeight: '1.7',
              color: '#d4d4d4',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code: MdCodeBlock,
                p: ({ children }) => <div style={{ margin: '6px 0', lineHeight: '1.7' }}>{children}</div>,
                ul: ({ children }) => <ul style={{ margin: '6px 0', paddingLeft: '20px', listStyleType: 'disc' }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ margin: '6px 0', paddingLeft: '20px', listStyleType: 'decimal' }}>{children}</ol>,
                li: ({ children }) => <li style={{ paddingLeft: '2px', marginBottom: '2px' }}>{children}</li>,
                h1: ({ children }) => <div style={{ fontSize: '1.6em', fontWeight: 700, margin: '16px 0 8px', color: '#e8e8e8', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '6px' }}>{children}</div>,
                h2: ({ children }) => <div style={{ fontSize: '1.35em', fontWeight: 600, margin: '14px 0 6px', color: '#e8e8e8', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '4px' }}>{children}</div>,
                h3: ({ children }) => <div style={{ fontSize: '1.15em', fontWeight: 600, margin: '12px 0 4px', color: '#e8e8e8' }}>{children}</div>,
                h4: ({ children }) => <div style={{ fontSize: '1.05em', fontWeight: 600, margin: '10px 0 4px', color: '#d0d0d0' }}>{children}</div>,
                h5: ({ children }) => <div style={{ fontSize: '0.95em', fontWeight: 600, margin: '8px 0 4px', color: '#c0c0c0' }}>{children}</div>,
                h6: ({ children }) => <div style={{ fontSize: '0.9em', fontWeight: 600, margin: '8px 0 4px', color: '#b0b0b0' }}>{children}</div>,
                strong: ({ children }) => <strong style={{ fontWeight: 600, color: '#e8e8e8' }}>{children}</strong>,
                blockquote: ({ children }) => <blockquote style={{ margin: '8px 0', paddingLeft: '14px', borderLeft: '3px solid rgba(0,122,204,0.5)', color: '#aaa', fontStyle: 'italic' }}>{children}</blockquote>,
                a: ({ href, children }) => (
                <a
                  href={href}
                  style={{ color: '#4fc1ff', textDecoration: 'none', cursor: 'pointer' }}
                  onClick={async (e) => {
                    e.preventDefault();
                    if (href) {
                      try {
                        await openUrl(href);
                      } catch (err) {
                        console.error('Failed to open URL:', err);
                      }
                    }
                  }}
                >
                  {children}
                </a>
              ),
              hr: () => <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '16px 0' }} />,
                table: ({ children }) => <table style={{ borderCollapse: 'collapse', width: '100%', margin: '10px 0', fontSize: '13px' }}>{children}</table>,
                thead: ({ children }) => <thead style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>{children}</thead>,
                th: ({ children }) => <th style={{ padding: '6px 12px', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'left', fontWeight: 600, color: '#e0e0e0' }}>{children}</th>,
                td: ({ children }) => <td style={{ padding: '6px 12px', border: '1px solid rgba(255,255,255,0.08)' }}>{children}</td>,
                img: ({ src, alt }) => <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: '6px', margin: '8px 0' }} />,
              }}
            >
              {activeFile.content || ''}
            </ReactMarkdown>
          </div>
        ) : mode === 'preview' ? (
          <>
            {!(isMarkdownFile && mdRendered) && !embedded && (
              <div style={{ position: 'absolute', top: '8px', right: '24px', zIndex: 10 }}>
                <EditorCopyButton editor={monacoEditor} />
              </div>
            )}
            <MonacoHost
            key={`${activeFile.filePath}-preview`}
            modelUri={`inmemory://preview/${encodeURIComponent(activeFile.filePath)}`}
            language={detectedLanguage}
            value={activeFile.content || ''}
            groupId="preview"
            filePath={activeFile.filePath}
            fontSize={13}
            wordWrap={true}
            lineNumbers={true}
            minimap={false}
            cursorStyle="line"
            cursorBlinking="blink"
            tabSize={4}
            themeMode={themeMode}
            onChange={() => {}}
            onMount={(editor) => setMonacoEditor(editor)}
          />
          </>
        ) : mode === 'diff' ? (
          <MonacoDiffHost
            key={`${activeFile.filePath}-diff`}
            original={activeFile.originalContent || ''}
            modified={activeFile.modifiedContent || ''}
            language={detectedLanguage}
            readOnly={true}
            renderSideBySide={true}
            fontSize={13}
            wordWrap={true}
            lineNumbers={true}
            minimap={true}
            tabSize={4}
            themeMode={themeMode}
          />
        ) : null}
      </div>
    </div>
  );
}
