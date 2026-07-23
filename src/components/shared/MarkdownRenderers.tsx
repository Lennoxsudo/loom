/**
 * 共享 Markdown 渲染组件
 *
 * 被 ChatPanel 和 AgentPanel 共享使用
 */

import { useState, type ReactNode } from 'react';

// ==================== File Tree Cleanup ====================

/**
 * Clean up file-tree text that AI models produce with broken hierarchy.
 *
 * AI models often output file trees where blank lines appear between the
 * vertical connector `│` and child items `├──`/`└──`, and child items
 * lack the proper `│` indentation prefix. This function:
 *
 * 1. Removes blank lines inside the tree
 * 2. Detects orphaned connector lines (`│   `) and remembers their indent
 * 3. Prepends the correct `│` prefix to child items that are missing it
 *
 * This is used both in code blocks (CodeBlockRenderer) and in streaming
 * `<pre>` rendering (ChatMessageBubble, AgentMessageRow).
 */
export function cleanupFileTree(text: string): string {
  if (!/[│├└─]/.test(text)) return text;

  const treeLines = text.split('\n');
  const cleaned: string[] = [];
  let pendingIndent = '';

  for (const line of treeLines) {
    const trimmed = line.trimEnd();

    // Skip completely blank lines inside the tree
    if (trimmed === '') {
      continue;
    }

    // Detect "connector-only" lines like "│   " or "│" — these indicate
    // a parent branch whose children will follow. Remember the indent
    // prefix so we can fix orphaned children.
    if (/^[│\s]+$/.test(trimmed) && !/[├└─]/.test(trimmed)) {
      const indentMatch = trimmed.match(/^(\s*│\s*)/);
      if (indentMatch) {
        pendingIndent = indentMatch[1];
      }
      continue;
    }

    // If this line starts with ├── or └── but is missing the │ prefix
    // that should precede it (orphaned child), prepend the pending indent.
    if (pendingIndent && (/^\s*├──/.test(line) || /^\s*└──/.test(line))) {
      const currentLeadingSpaces = line.match(/^(\s*)/)?.[1] ?? '';
      // Only fix if the line has less indentation than expected
      if (currentLeadingSpaces.length < pendingIndent.length) {
        cleaned.push(pendingIndent + line.trimStart());
        pendingIndent = '';
        continue;
      }
    }

    // Normal line — keep as-is
    pendingIndent = '';
    cleaned.push(line);
  }
  return cleaned.join('\n');
}
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from '../../i18n';
import { CheckIcon } from './Icons';

// ==================== Code Block Renderer ====================

interface CodeBlockProps {
  children?: ReactNode;
  className?: string;
  node?: unknown;
  ref?: unknown;
}

const CodeBlockRenderer = ({
  children,
  className,
  node: _node,
  ref: _ref,
  ...rest
}: CodeBlockProps) => {
  const t = useTranslation();
  const match = /language-(\w+)/.exec(className || '');
  let language = match ? match[1] : '';
  let codeText = String(children);

  if (!language) {
    const lines = codeText.split('\n');
    let firstContentIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== '') {
        firstContentIndex = i;
        break;
      }
    }

    if (firstContentIndex !== -1) {
      const firstLine = lines[firstContentIndex].trim().toLowerCase();
      if (
        [
          'bash',
          'shell',
          'sh',
          'javascript',
          'typescript',
          'js',
          'ts',
          'json',
          'html',
          'css',
          'python',
          'rust',
          'go',
          'java',
          'c',
          'cpp',
          'yml',
          'yaml',
          'xml',
          'sql',
          'text',
          'plaintext',
          'txt',
        ].includes(firstLine)
      ) {
        language = firstLine;
        codeText = lines
          .slice(firstContentIndex + 1)
          .join('\n')
          .replace(/^\s*\n/, '');
      }
    }
  }

  // Clean up file-tree formatting (broken hierarchy from AI output)
  codeText = cleanupFileTree(codeText);

  const isInline = !match && !codeText.includes('\n') && !language;
  const [isCopied, setIsCopied] = useState(false);

  if (isInline) {
    return (
      <code
        {...rest}
        style={{
          backgroundColor: 'var(--surface-overlay-soft)',
          padding: '2px 4px',
          borderRadius: '4px',
          fontFamily: 'monospace',
          fontSize: '0.9em',
        }}
      >
        {children}
      </code>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(codeText.replace(/\n$/, ''));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div
      style={{
        margin: '8px 0',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid var(--surface-overlay-border)',
        backgroundColor: 'var(--bg-muted)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 12px',
          backgroundColor: 'var(--surface-overlay-soft)',
          borderBottom: '1px solid var(--surface-overlay-border)',
          color: 'var(--text-secondary)',
          fontSize: '12px',
        }}
      >
        <span style={{ fontWeight: 600 }}>{language}</span>
        <button
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            color: isCopied ? 'color-mix(in srgb, #2f7d57 78%, var(--text-primary))' : 'inherit',
            cursor: 'pointer',
            opacity: isCopied ? 1 : 0.7,
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            transition: 'all 0.2s',
          }}
        >
          {isCopied ? <CheckIcon size={12} /> : null}
          {isCopied ? t.agent.copied : t.agent.copy}
        </button>
      </div>
      <SyntaxHighlighter
        {...rest}
        PreTag="div"
        children={codeText.replace(/\n$/, '')}
        language={language || undefined}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '12px',
          fontSize: '12px',
          backgroundColor: 'transparent',
          fontFamily:
            "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', 'Consolas', 'Liberation Mono', 'Menlo', monospace",
          lineHeight: '1.5',
          letterSpacing: '0',
        }}
        codeTagProps={{
          style: {
            fontFamily:
              "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', 'Consolas', 'Liberation Mono', 'Menlo', monospace",
            letterSpacing: '0',
          },
        }}
      />
    </div>
  );
};

// ==================== Paragraph Renderer ====================

const ParagraphRenderer = ({ children }: { children?: ReactNode }) => {
  return <div style={{ margin: '4px 0', lineHeight: '1.6' }}>{children}</div>;
};

// ==================== List Renderers ====================

const UnorderedListRenderer = ({ children }: { children?: ReactNode }) => {
  return (
    <ul style={{ margin: '4px 0', paddingLeft: '18px', listStyleType: 'disc' }}>{children}</ul>
  );
};

const OrderedListRenderer = ({ children }: { children?: ReactNode }) => {
  return (
    <ol style={{ margin: '4px 0', paddingLeft: '18px', listStyleType: 'decimal' }}>{children}</ol>
  );
};

const ListItemRenderer = ({ children }: { children?: ReactNode }) => {
  return <li style={{ paddingLeft: '2px' }}>{children}</li>;
};

// ==================== Strong Renderer ====================

const StrongRenderer = ({ children }: { children?: ReactNode }) => {
  return <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{children}</strong>;
};

// ==================== Link Renderer ====================

/**
 * 清洗 autolink 产生的 href：截断到合法 URL 字符边界。
 * remark-gfm autolink 会把中文标号（如 ）。，）也吞进 URL，
 * 例如 "http://localhost:5173）已被终止。" 会被整体识别为链接。
 * 此函数在第一个非法 URL 字符处截断，返回 [cleanedHref, trailingText]。
 */
function cleanAutolinkHref(href: string): [string, string] {
  // 合法 URL 字符集（RFC 3986 unreserved + reserved + percent-encoded）
  // 中文标号（全角括号、句号、逗号等）不属于合法 URL 字符
  const URL_CHARS = new Set(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:/?#[]@!$&'()*+,;=._~%-"
  );
  for (let i = 0; i < href.length; i++) {
    const ch = href[i];
    // 百分号编码 %XX 是合法的
    if (ch === '%' && i + 2 < href.length) {
      const hex1 = href.charCodeAt(i + 1);
      const hex2 = href.charCodeAt(i + 2);
      const isHex1 =
        (hex1 >= 48 && hex1 <= 57) || (hex1 >= 65 && hex1 <= 70) || (hex1 >= 97 && hex1 <= 102);
      const isHex2 =
        (hex2 >= 48 && hex2 <= 57) || (hex2 >= 65 && hex2 <= 70) || (hex2 >= 97 && hex2 <= 102);
      if (isHex1 && isHex2) continue;
    }
    if (!URL_CHARS.has(ch)) {
      return [href.slice(0, i), href.slice(i)];
    }
  }
  return [href, ''];
}

const LinkRenderer = ({ href, children }: { href?: string; children?: ReactNode }) => {
  // 清洗 href：截断 autolink 误吞的中文标号等非法字符
  const [cleanedHref, trailingText] = href ? cleanAutolinkHref(href) : ['', ''];
  const effectiveHref = cleanedHref || href;

  // 如果 children 是纯文本且与 href 一致，也需要截断以避免重复显示
  let effectiveChildren = children;
  if (trailingText && typeof children === 'string' && children === href) {
    effectiveChildren = cleanedHref;
  }

  return (
    <>
      <a
        href={effectiveHref}
        onClick={async (e) => {
          e.preventDefault();
          if (effectiveHref) {
            try {
              await openUrl(effectiveHref);
            } catch (err) {
              console.error('Failed to open URL:', err);
            }
          }
        }}
        style={{ color: 'var(--text-accent)', textDecoration: 'underline', cursor: 'pointer' }}
      >
        {effectiveChildren}
      </a>
      {trailingText && <span>{trailingText}</span>}
    </>
  );
};

// ==================== Header Renderer ====================

const HeaderRenderer = ({ level, children }: { level: number; children?: ReactNode }) => {
  const sizes: Record<number, string> = {
    1: '1.5em',
    2: '1.3em',
    3: '1.15em',
    4: '1em',
    5: '0.9em',
    6: '0.85em',
  };

  // 使用 div 和 aria-level 来避免 JSX.IntrinsicElements 问题
  return (
    <div
      role="heading"
      aria-level={level}
      style={{
        fontSize: sizes[level] || '1em',
        fontWeight: 600,
        margin: '4px 0 4px 0',
        color: 'var(--text-primary)',
      }}
    >
      {children}
    </div>
  );
};

// ==================== Table Renderers ====================

const TableRenderer = ({ children }: { children?: ReactNode }) => {
  return (
    <div style={{ overflowX: 'auto', margin: '12px 0', maxWidth: '100%' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '12.5px',
          lineHeight: '1.5',
          border: '1px solid var(--border-subtle, rgba(80, 80, 80, 0.2))',
          borderRadius: '8px',
        }}
      >
        {children}
      </table>
    </div>
  );
};

const TableHeaderRenderer = ({ children }: { children?: ReactNode }) => {
  return (
    <thead
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderBottom: '2px solid var(--border-subtle, rgba(80, 80, 80, 0.3))',
        fontWeight: 600,
      }}
    >
      {children}
    </thead>
  );
};

const TableRowRenderer = ({ children }: { children?: ReactNode }) => {
  return (
    <tr
      style={{
        borderBottom: '1px solid var(--border-subtle, rgba(80, 80, 80, 0.15))',
        transition: 'background-color 0.15s ease',
      }}
    >
      {children}
    </tr>
  );
};

const TableCellRenderer = ({ children, style }: { children?: ReactNode; style?: any }) => {
  return (
    <td
      style={{
        padding: '8px 12px',
        textAlign: style?.textAlign || 'left',
        wordBreak: 'break-word',
      }}
    >
      {children}
    </td>
  );
};

const TableHeaderCellRenderer = ({ children, style }: { children?: ReactNode; style?: any }) => {
  return (
    <th
      style={{
        padding: '8px 12px',
        textAlign: style?.textAlign || 'left',
        fontWeight: 600,
        color: 'var(--text-primary)',
      }}
    >
      {children}
    </th>
  );
};

// ==================== Markdown Components ====================

export const markdownComponents = {
  code: CodeBlockRenderer,
  p: ParagraphRenderer,
  ul: UnorderedListRenderer,
  ol: OrderedListRenderer,
  li: ListItemRenderer,
  strong: StrongRenderer,
  a: LinkRenderer,
  h1: (props: { children?: ReactNode }) => <HeaderRenderer level={1} {...props} />,
  h2: (props: { children?: ReactNode }) => <HeaderRenderer level={2} {...props} />,
  h3: (props: { children?: ReactNode }) => <HeaderRenderer level={3} {...props} />,
  h4: (props: { children?: ReactNode }) => <HeaderRenderer level={4} {...props} />,
  h5: (props: { children?: ReactNode }) => <HeaderRenderer level={5} {...props} />,
  h6: (props: { children?: ReactNode }) => <HeaderRenderer level={6} {...props} />,
  table: TableRenderer,
  thead: TableHeaderRenderer,
  tr: TableRowRenderer,
  td: TableCellRenderer,
  th: TableHeaderCellRenderer,
};
