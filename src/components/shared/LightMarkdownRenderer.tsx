/**
 * 轻量级 Markdown 渲染器 - 用于流式输出
 * 
 * 特点：
 * - 使用 react-markdown 解析，但组件更轻量
 * - 无语法高亮（避免 Prism 的解析开销）
 * - 代码块使用纯 CSS 样式，无 SyntaxHighlighter
 * - 支持基础 Markdown 语法（标题、列表、链接、表格等）
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';

// ==================== 样式常量 ====================

const headingSizes: Record<number, string> = {
  1: '1.4em',
  2: '1.25em',
  3: '1.1em',
  4: '1em',
  5: '0.9em',
  6: '0.85em',
};

const codeBlockWrapperStyle = {
  margin: '8px 0',
  borderRadius: '6px',
  overflow: 'hidden',
  border: '1px solid var(--surface-overlay-border)',
  backgroundColor: 'var(--bg-muted)',
};

const codeBlockHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '4px 10px',
  backgroundColor: 'var(--surface-overlay-soft)',
  borderBottom: '1px solid var(--surface-overlay-border)',
  color: 'var(--text-secondary)',
  fontSize: '11px',
};

const codeBlockPreStyle = {
  margin: 0,
  padding: '10px 12px',
  fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', Consolas, monospace",
  fontSize: '12px',
  lineHeight: '1.5',
  backgroundColor: 'transparent',
  overflow: 'auto',
};

const inlineCodeStyle = {
  backgroundColor: 'var(--surface-overlay-soft)',
  padding: '2px 4px',
  borderRadius: '4px',
  fontFamily: 'monospace',
  fontSize: '0.9em',
};

const linkStyle = {
  color: 'var(--text-accent)',
  textDecoration: 'underline',
  cursor: 'pointer',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse' as const,
  margin: '8px 0',
  fontSize: '12px',
};

const tableCellStyle = {
  padding: '6px 10px',
  border: '1px solid var(--border-subtle)',
  textAlign: 'left',
};

const blockquoteStyle = {
  margin: '8px 0',
  paddingLeft: '12px',
  borderLeft: '3px solid var(--border-primary)',
  color: 'var(--text-secondary)',
};

const hrStyle = {
  border: 'none',
  borderTop: '1px solid var(--border-subtle)',
  margin: '12px 0',
};

// ==================== 组件 ====================

function LightCodeBlock({
  language,
  children,
}: {
  language?: string;
  children?: string;
}) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    if (children) {
      navigator.clipboard.writeText(children.replace(/\n$/, ''));
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  return (
    <div style={codeBlockWrapperStyle}>
      <div style={codeBlockHeaderStyle}>
        <span style={{ fontWeight: 500 }}>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            color: isCopied ? '#2f7d57' : 'inherit',
            cursor: 'pointer',
            opacity: isCopied ? 1 : 0.7,
            fontSize: '10px',
            padding: '2px 6px',
          }}
        >
          {isCopied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre style={codeBlockPreStyle}>
        <code>{children}</code>
      </pre>
    </div>
  );
}

function LightInlineCode({ children }: { children?: ReactNode }) {
  return <code style={inlineCodeStyle}>{children}</code>;
}

function LightLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (href) {
      try {
        await openUrl(href);
      } catch (err) {
        console.error('Failed to open URL:', err);
      }
    }
  };
  return (
    <a href={href} onClick={handleClick} style={linkStyle}>
      {children}
    </a>
  );
}

// ==================== 轻量级组件集 ====================

/**
 * 轻量级 Markdown 组件集 - 用于流式渲染
 * 
 * 与完整版 markdownComponents 的区别：
 * - 代码块使用纯 CSS，无 SyntaxHighlighter
 * - 无复杂的代码块语言检测逻辑
 * - 简化样式，减少 CSS-in-JS 开销
 * - 保留完整 Markdown 语法支持（标题、列表、链接、表格、引用等）
 */
export const lightMarkdownComponents = {
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';
    const code = String(children ?? '').replace(/\n$/, '');

    // 有语言标识或包含换行符，使用代码块渲染
    if (match || (code.includes('\n') && !className)) {
      return <LightCodeBlock language={language}>{code}</LightCodeBlock>;
    }
    // 内联代码
    return <LightInlineCode>{children}</LightInlineCode>;
  },

  pre: ({ children }: { children?: ReactNode }) => <>{children}</>,

  p: ({ children }: { children?: ReactNode }) => (
    <div style={{ margin: '4px 0', lineHeight: '1.6' }}>{children}</div>
  ),

  h1: (props: { children?: ReactNode }) => (
    <div
      role="heading"
      aria-level={1}
      style={{ fontSize: headingSizes[1], fontWeight: 600, margin: '10px 0 6px 0', color: 'var(--text-primary)' }}
    >
      {props.children}
    </div>
  ),

  h2: (props: { children?: ReactNode }) => (
    <div
      role="heading"
      aria-level={2}
      style={{ fontSize: headingSizes[2], fontWeight: 600, margin: '8px 0 4px 0', color: 'var(--text-primary)' }}
    >
      {props.children}
    </div>
  ),

  h3: (props: { children?: ReactNode }) => (
    <div
      role="heading"
      aria-level={3}
      style={{ fontSize: headingSizes[3], fontWeight: 600, margin: '6px 0 4px 0', color: 'var(--text-primary)' }}
    >
      {props.children}
    </div>
  ),

  h4: (props: { children?: ReactNode }) => (
    <div
      role="heading"
      aria-level={4}
      style={{ fontSize: headingSizes[4], fontWeight: 600, margin: '4px 0 2px 0', color: 'var(--text-primary)' }}
    >
      {props.children}
    </div>
  ),

  h5: (props: { children?: ReactNode }) => (
    <div
      role="heading"
      aria-level={5}
      style={{ fontSize: headingSizes[5], fontWeight: 600, margin: '4px 0 2px 0', color: 'var(--text-primary)' }}
    >
      {props.children}
    </div>
  ),

  h6: (props: { children?: ReactNode }) => (
    <div
      role="heading"
      aria-level={6}
      style={{ fontSize: headingSizes[6], fontWeight: 600, margin: '4px 0 2px 0', color: 'var(--text-primary)' }}
    >
      {props.children}
    </div>
  ),

  a: LightLink,

  ul: ({ children }: { children?: ReactNode }) => (
    <ul style={{ margin: '4px 0', paddingLeft: '18px', listStyleType: 'disc' }}>
      {children}
    </ul>
  ),

  ol: ({ children }: { children?: ReactNode }) => (
    <ol style={{ margin: '4px 0', paddingLeft: '18px', listStyleType: 'decimal' }}>
      {children}
    </ol>
  ),

  li: ({ children }: { children?: ReactNode }) => (
    <li style={{ paddingLeft: '2px' }}>{children}</li>
  ),

  strong: ({ children }: { children?: ReactNode }) => (
    <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
      {children}
    </strong>
  ),

  em: ({ children }: { children?: ReactNode }) => (
    <em style={{ fontStyle: 'italic' }}>{children}</em>
  ),

  table: ({ children }: { children?: ReactNode }) => (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={tableStyle}>{children}</table>
    </div>
  ),

  thead: ({ children }: { children?: ReactNode }) => (
    <thead
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderBottom: '2px solid var(--border-subtle)',
        fontWeight: 600,
      }}
    >
      {children}
    </thead>
  ),

  tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,

  tr: ({ children }: { children?: ReactNode }) => (
    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>{children}</tr>
  ),

  td: ({ children, style }: { children?: ReactNode; style?: { textAlign?: string } }) => (
    <td style={{ ...tableCellStyle, textAlign: (style?.textAlign || 'left') as any }}>
      {children}
    </td>
  ),

  th: ({ children, style }: { children?: ReactNode; style?: { textAlign?: string } }) => (
    <th
      style={{
        ...tableCellStyle,
        textAlign: (style?.textAlign || 'left') as any,
        fontWeight: 600,
        color: 'var(--text-primary)',
      }}
    >
      {children}
    </th>
  ),

  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote style={blockquoteStyle}>{children}</blockquote>
  ),

  hr: () => <hr style={hrStyle} />,

  // 特殊处理：处理嵌套的 inline 代码（来自 remark-gfm）
  inlineCode: LightInlineCode,
};
