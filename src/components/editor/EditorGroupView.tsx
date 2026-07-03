/**
 * 编辑器组视图组件
 */

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { MonacoHost } from './MonacoHost';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import { openUrl } from '@tauri-apps/plugin-opener';
import SettingsView from '../SettingsView';
import BrowserPanel from '../BrowserPanel';
import { EditorDiffPanel } from '../diff';
import ImagePreview from '../ImagePreview';
import { EditorTab } from './EditorTab';
import {
  type EditorGroupId,
  type EditorGroupState,
  type OpenFilesByPath,
  type SplitDirection,
  makeTabBarId,
  makeTabId,
} from '../../types/app';
import { getLanguage } from '../../utils/editorUtils';
import { debugLog } from '../../utils/debugLog';
import { toMonacoModelUri } from '../../utils/pathUtils';
import { useTranslation } from '../../i18n';

// Markdown 代码块渲染组件
interface MdCodeProps {
  children?: ReactNode;
  className?: string;
  node?: unknown;
  ref?: unknown;
}

const EditorMdCodeBlock = ({ children, className, node: _node, ref: _ref, ...rest }: MdCodeProps) => {
  const match = /language-(\w+)/.exec(className || '');
  const isInline = !match && !String(children).includes('\n');

  if (isInline) {
    return (
      <code {...rest} style={{ backgroundColor: 'rgba(100,100,100,0.25)', padding: '2px 5px', borderRadius: '4px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.88em' }}>
        {children}
      </code>
    );
  }

  return (
    <div style={{ margin: '10px 0', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', backgroundColor: 'rgba(0,0,0,0.3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 12px', backgroundColor: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#999', fontSize: '11px' }}>
        <span style={{ fontWeight: 600 }}>{match?.[1] || 'text'}</span>
      </div>
      <SyntaxHighlighter {...rest} PreTag="div" children={String(children).replace(/\n$/, '')} language={match ? match[1] : 'text'} style={vscDarkPlus} customStyle={{ margin: 0, padding: '12px', fontSize: '13px', backgroundColor: 'transparent' }} />
    </div>
  );
};

interface EditorGroupViewProps {
  group: EditorGroupState;
  openFilesByPath: OpenFilesByPath;
  hoveredTabId: string | null;
  isFocused: boolean;
  isSplit: boolean;
  splitDirection: SplitDirection;
  onHoverTab: (tabId: string | null) => void;
  onActivateTab: (groupId: EditorGroupId, filePath: string) => void;
  onCloseTab: (e: React.MouseEvent, groupId: EditorGroupId, filePath: string) => void;
  isAgentBusy?: boolean;
  onEditorChange: (filePath: string, value: string | undefined, ev?: unknown) => void;
  onEditorMount?: (groupId: EditorGroupId, editor: unknown, filePath: string) => void;
  onFocusGroup: (groupId: EditorGroupId) => void;
  onSplitRight: (sourceGroupId: EditorGroupId) => void;
  onSplitDown: (sourceGroupId: EditorGroupId) => void;
  onSingle: () => void;
  showLeadingBorder: boolean;
  showControls: boolean;
  tabSize: 2 | 4 | 8;
  fontSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
  cursorStyle: 'line' | 'block' | 'underline';
  cursorBlinking: 'blink' | 'smooth' | 'phase' | 'solid';
  themeMode: 'system' | 'dark' | 'light';
  renderWhitespace: 'none' | 'boundary' | 'selection' | 'all';
  currentLineHighlight: boolean;
  bracketPairColorization: boolean;
  projectPath: string;
  onFilesChanged?: (paths: string[]) => void;
}

const themedMarkdownText = {
  headingStrong: 'var(--text-primary)',
  headingSoft: 'color-mix(in srgb, var(--text-primary) 85%, var(--text-secondary) 15%)',
  subtle: 'var(--text-secondary)',
  border: 'var(--surface-overlay-border)',
  surface: 'var(--surface-overlay-soft)',
  surfaceElevated: 'var(--bg-elevated)',
  link: 'var(--text-accent)',
  quoteBorder: 'color-mix(in srgb, var(--border-focus) 50%, transparent)',
};

export function EditorGroupView({
  group,
  openFilesByPath,
  hoveredTabId,
  isFocused,
  isSplit,
  splitDirection,
  onHoverTab,
  onActivateTab,
  onCloseTab,
  isAgentBusy = false,
  onEditorChange,
  onEditorMount,
  onFocusGroup,
  onSplitRight,
  onSplitDown,
  onSingle,
  showLeadingBorder,
  showControls,
  tabSize,
  fontSize,
  wordWrap,
  lineNumbers,
  minimap,
  cursorStyle,
  cursorBlinking,
  themeMode,
  renderWhitespace,
  currentLineHighlight,
  bracketPairColorization,
  projectPath: _projectPath,
  onFilesChanged: _onFilesChanged,
}: EditorGroupViewProps) {
  const t = useTranslation();

  const safeOnEditorMount = typeof onEditorMount === 'function' ? onEditorMount : undefined;
  const { setNodeRef: setTabBarDropRef, isOver: isOverTabBar } = useDroppable({
    id: makeTabBarId(group.id),
  });

  // 用于横向滚动的 ref
  const tabBarScrollRef = useRef<HTMLDivElement | null>(null);

  // 手动绑定非 passive 的 wheel 事件，支持横向滚动标签栏
  useEffect(() => {
    const el = tabBarScrollRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const activeFile = group.activePath ? openFilesByPath[group.activePath] : null;
  const tabIds = group.tabPaths.map((p) => makeTabId(group.id, p));

  // Markdown 渲染/源码切换
  const [mdRendered, setMdRendered] = useState(false);
  const isMarkdownFile = activeFile?.kind === 'text' && /\.md$/i.test(activeFile.name);
  const activeFileModelUri = activeFile?.kind === 'text' ? toMonacoModelUri(activeFile.path) : null;

  useEffect(() => {
    if (!isMarkdownFile) {
      setMdRendered(false);
    }
  }, [activeFile?.path, isMarkdownFile]);

  useEffect(() => {
    if (!activeFile || activeFile.kind !== 'text') return;
    debugLog('editor-group-view', {
      event: 'active-text-file',
      groupId: group.id,
      filePath: activeFile.path,
      fileName: activeFile.name,
      modelUri: activeFileModelUri,
      isMarkdownFile,
      contentLength: activeFile.content.length,
    });
  }, [activeFile, activeFileModelUri, group.id, isMarkdownFile]);

  useEffect(() => {
    if (!activeFile || activeFile.kind !== 'text') return;
    debugLog('editor-group-view', {
      event: 'editor-render-branch',
      groupId: group.id,
      filePath: activeFile.path,
      fileName: activeFile.name,
      modelUri: activeFileModelUri,
      isMarkdownFile,
      mdRendered,
      branch: isMarkdownFile
        ? mdRendered
          ? 'markdown-rendered'
          : activeFileModelUri
            ? 'markdown-wrapper'
            : 'markdown-loading'
        : activeFileModelUri
          ? 'text-wrapper'
          : 'text-loading',
    });
  }, [activeFile, activeFileModelUri, group.id, isMarkdownFile, mdRendered]);

  return (
    <div
      onMouseDown={() => onFocusGroup(group.id)}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderLeft:
          showLeadingBorder && splitDirection === 'row' ? '1px solid var(--border-subtle)' : undefined,
        borderTop:
          showLeadingBorder && splitDirection === 'column' ? '1px solid var(--border-subtle)' : undefined,
      }}
    >
      {/* Tab 栏 */}
      <div
        style={{
          height: 'var(--editor-tab-height)',
          backgroundColor: isFocused ? 'var(--bg-header)' : 'color-mix(in srgb, var(--bg-header) 88%, var(--bg-primary))',
          display: 'flex',
          borderBottom: '1px solid var(--border-subtle)',
          opacity: isFocused ? 1 : 0.92,
          transition: 'opacity var(--transition-fast), background-color var(--transition-fast)',
        }}
      >
        <div
          ref={(el) => {
            tabBarScrollRef.current = el;
            setTabBarDropRef(el);
          }}
          style={{
            flex: 1,
            display: 'flex',
            overflowX: 'auto',
            overflowY: 'hidden',
            backgroundColor: isOverTabBar ? 'var(--surface-accent-soft)' : undefined,
            transition: 'background-color 0.1s',
          }}
          className="no-scrollbar"
        >
          <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
            {group.tabPaths.map((filePath) => {
              const file = openFilesByPath[filePath];
              if (!file) return null;

              const tabId = makeTabId(group.id, filePath);
              return (
                <EditorTab
                  key={tabId}
                  tabId={tabId}
                  file={file}
                  isActive={group.activePath === filePath}
                  isHovered={hoveredTabId === tabId}
                  isCloseDisabled={file.kind === 'agent' && isAgentBusy}
                  closeDisabledTitle={t.editor.agentRunningCannotClose}
                  onHover={onHoverTab}
                  onActivate={() => onActivateTab(group.id, filePath)}
                  onClose={(e) => onCloseTab(e, group.id, filePath)}
                />
              );
            })}
          </SortableContext>
        </div>

        {/* 分屏控制按钮 */}
        {showControls && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              padding: '0 6px',
              flexShrink: 0,
              borderLeft: '1px solid var(--border-subtle)',
            }}
          >
            {isSplit && (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSingle();
                }}
                title={t.editor.singleColumn}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  padding: '0 4px',
                  color: 'var(--text-primary)',
                }}
              >
                ☐
              </button>
            )}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                onSplitRight(group.id);
              }}
              title={isSplit ? t.editor.leftRightLayout : t.editor.splitRight}
              style={{
                background: splitDirection === 'row' && isSplit ? 'var(--bg-hover)' : 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                padding: '0 4px',
                color: 'var(--text-primary)',
                borderRadius: '3px',
              }}
            >
              ⇔
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                onSplitDown(group.id);
              }}
              title={isSplit ? t.editor.topBottomLayout : t.editor.splitDown}
              style={{
                background: splitDirection === 'column' && isSplit ? 'var(--bg-hover)' : 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                padding: '0 4px',
                color: 'var(--text-primary)',
                borderRadius: '3px',
              }}
            >
              ⇕
            </button>
          </div>
        )}
      </div>

      {/* 编辑器内容区域 */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        {/* 文本编辑器 */}
        {activeFile?.kind === 'text' && !isMarkdownFile && activeFileModelUri && (
            <MonacoHost
              modelUri={activeFileModelUri}
              language={getLanguage(activeFile.name)}
              value={activeFile.content}
              groupId={group.id}
              filePath={activeFile.path}
              fontSize={fontSize}
              wordWrap={wordWrap}
              lineNumbers={lineNumbers}
              minimap={minimap}
              cursorStyle={cursorStyle}
              cursorBlinking={cursorBlinking}
              themeMode={themeMode}
              renderWhitespace={renderWhitespace}
              currentLineHighlight={currentLineHighlight}
              bracketPairColorization={bracketPairColorization}
              tabSize={tabSize}
              onChange={(value, ev) => onEditorChange(activeFile.path, value, ev)}
              onMount={(editor) => {
                debugLog('editor-group-view', {
                  event: 'editor-mounted-wrapper',
                  groupId: group.id,
                  filePath: activeFile.path,
                  fileName: activeFile.name,
                  modelUri: activeFileModelUri,
                  isMarkdownFile: false,
                });
                safeOnEditorMount?.(group.id, editor, activeFile.path);
              }}
            />
        )}

        {/* Markdown 文件 */}
        {isMarkdownFile && activeFile?.kind === 'text' && (
          <>
            {/* 浮动切换按钮 */}
            <div style={{
              position: 'absolute',
              top: '8px',
              right: '24px',
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              backgroundColor: 'var(--bg-elevated)',
              backdropFilter: 'blur(8px)',
              padding: '2px',
              borderRadius: '6px',
              border: '1px solid var(--surface-overlay-border)',
              boxShadow: 'var(--shadow-sm)',
            }}>
              <button
                type="button"
                onClick={() => setMdRendered(true)}
                title={t.preview.markdownRendered}
                style={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  height: '24px',
                  padding: '0 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  color: mdRendered ? 'var(--text-primary)' : 'var(--text-secondary)',
                  backgroundColor: mdRendered ? 'var(--bg-hover)' : 'transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                  <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
                  <path d="M9 15v-2l2 2 2-2v2" />
                </svg>
                {t.preview.markdownRendered}
              </button>
              <button
                type="button"
                onClick={() => setMdRendered(false)}
                title={t.preview.markdownSource}
                style={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  height: '24px',
                  padding: '0 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  color: !mdRendered ? 'var(--text-primary)' : 'var(--text-secondary)',
                  backgroundColor: !mdRendered ? 'var(--bg-hover)' : 'transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                {t.preview.markdownSource}
              </button>
            </div>

            {/* 渲染视图 */}
            {mdRendered ? (
              <div style={{
                height: '100%',
                overflowY: 'auto',
                padding: '24px 32px',
                fontSize: '14px',
                lineHeight: '1.7',
                color: 'var(--text-primary)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
              }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code: EditorMdCodeBlock,
                    p: ({ children }) => <div style={{ margin: '6px 0', lineHeight: '1.7' }}>{children}</div>,
                    ul: ({ children }) => <ul style={{ margin: '6px 0', paddingLeft: '20px', listStyleType: 'disc' }}>{children}</ul>,
                    ol: ({ children }) => <ol style={{ margin: '6px 0', paddingLeft: '20px', listStyleType: 'decimal' }}>{children}</ol>,
                    li: ({ children }) => <li style={{ paddingLeft: '2px', marginBottom: '2px' }}>{children}</li>,
                    h1: ({ children }) => <div style={{ fontSize: '1.6em', fontWeight: 700, margin: '16px 0 8px', color: themedMarkdownText.headingStrong, borderBottom: `1px solid ${themedMarkdownText.border}`, paddingBottom: '6px' }}>{children}</div>,
                    h2: ({ children }) => <div style={{ fontSize: '1.35em', fontWeight: 600, margin: '14px 0 6px', color: themedMarkdownText.headingStrong, borderBottom: `1px solid ${themedMarkdownText.border}`, paddingBottom: '4px' }}>{children}</div>,
                    h3: ({ children }) => <div style={{ fontSize: '1.15em', fontWeight: 600, margin: '12px 0 4px', color: themedMarkdownText.headingStrong }}>{children}</div>,
                    h4: ({ children }) => <div style={{ fontSize: '1.05em', fontWeight: 600, margin: '10px 0 4px', color: themedMarkdownText.headingSoft }}>{children}</div>,
                    h5: ({ children }) => <div style={{ fontSize: '0.95em', fontWeight: 600, margin: '8px 0 4px', color: themedMarkdownText.headingSoft }}>{children}</div>,
                    h6: ({ children }) => <div style={{ fontSize: '0.9em', fontWeight: 600, margin: '8px 0 4px', color: themedMarkdownText.subtle }}>{children}</div>,
                    strong: ({ children }) => <strong style={{ fontWeight: 600, color: themedMarkdownText.headingStrong }}>{children}</strong>,
                    blockquote: ({ children }) => <blockquote style={{ margin: '8px 0', paddingLeft: '14px', borderLeft: `3px solid ${themedMarkdownText.quoteBorder}`, color: themedMarkdownText.subtle, fontStyle: 'italic' }}>{children}</blockquote>,
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        style={{ color: themedMarkdownText.link, textDecoration: 'none', cursor: 'pointer' }}
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
                    hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${themedMarkdownText.border}`, margin: '16px 0' }} />,
                    table: ({ children }) => <table style={{ borderCollapse: 'collapse', width: '100%', margin: '10px 0', fontSize: '13px' }}>{children}</table>,
                    thead: ({ children }) => <thead style={{ backgroundColor: themedMarkdownText.surface }}>{children}</thead>,
                    th: ({ children }) => <th style={{ padding: '6px 12px', border: `1px solid ${themedMarkdownText.border}`, textAlign: 'left', fontWeight: 600, color: themedMarkdownText.headingStrong }}>{children}</th>,
                    td: ({ children }) => <td style={{ padding: '6px 12px', border: `1px solid ${themedMarkdownText.border}` }}>{children}</td>,
                    img: ({ src, alt }) => <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: '6px', margin: '8px 0' }} />,
                  }}
                >
                  {activeFile.content || ''}
                </ReactMarkdown>
              </div>
            ) : activeFileModelUri ? (
              <MonacoHost
                modelUri={activeFileModelUri}
                language="markdown"
                value={activeFile.content}
                groupId={group.id}
                filePath={activeFile.path}
                fontSize={fontSize}
                wordWrap={wordWrap}
                lineNumbers={lineNumbers}
                minimap={minimap}
                cursorStyle={cursorStyle}
                cursorBlinking={cursorBlinking}
                themeMode={themeMode}
                renderWhitespace={renderWhitespace}
                currentLineHighlight={currentLineHighlight}
                bracketPairColorization={bracketPairColorization}
                tabSize={tabSize}
                onChange={(value, ev) => onEditorChange(activeFile.path, value, ev)}
                onMount={(editor) => {
                  debugLog('editor-group-view', {
                    event: 'editor-mounted-wrapper',
                    groupId: group.id,
                    filePath: activeFile.path,
                    fileName: activeFile.name,
                    modelUri: activeFileModelUri,
                    isMarkdownFile: true,
                  });
                  safeOnEditorMount?.(group.id, editor, activeFile.path);
                }}
              />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>Loading editor...</div>
            )}
          </>
        )}
        {activeFile?.kind === 'image' && (
          <ImagePreview
            key={`${group.id}:${activeFile.path}`}
            filePath={activeFile.path}
            name={activeFile.name}
            src={activeFile.src}
          />
        )}

        {activeFile?.kind === 'diff' && (
          <EditorDiffPanel
            key={`${group.id}:${activeFile.path}`}
            originalContent={activeFile.originalContent}
            modifiedContent={activeFile.modifiedContent}
            language={activeFile.language}
            leftLabel={activeFile.leftLabel}
            rightLabel={activeFile.rightLabel}
            themeMode={themeMode}
            fontSize={fontSize}
            wordWrap={wordWrap}
            lineNumbers={lineNumbers}
            minimap={minimap}
            tabSize={tabSize}
            renderWhitespace={renderWhitespace}
            currentLineHighlight={currentLineHighlight}
            bracketPairColorization={bracketPairColorization}
          />
        )}

        {/* 设置视图 */}
        {activeFile?.kind === 'settings' && <SettingsView key={`${group.id}:${activeFile.path}`} />}

        {/* AI Agent 面板已移至独立窗口 (AgentApp)，不再内嵌于编辑器 */}

        {/* 浏览器面板 - 始终保持挂载，通过 display 控制可见性 */}
        {(() => {
          const browserFile = group.tabPaths
            .map((p) => openFilesByPath[p])
            .find((f) => f?.kind === 'browser');

          if (!browserFile || browserFile.kind !== 'browser') return null;

          const isBrowserActive = activeFile?.kind === 'browser';

          return (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                display: isBrowserActive ? 'block' : 'none',
              }}
            >
              <BrowserPanel key={`${group.id}:${browserFile.path}`} initialUrl={browserFile.url} />
            </div>
          );
        })()}

        {/* 空状态 */}
        {!activeFile && (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              userSelect: 'none',
            }}
          >
            App Keybindings: Ctrl+S to save
          </div>
        )}
      </div>
    </div>
  );
}
