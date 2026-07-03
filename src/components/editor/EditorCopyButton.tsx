import { useState, type CSSProperties } from 'react';
import { useTranslation } from '../../i18n';
import { CheckIcon, CopyIcon } from '../shared/Icons';
import { copyEditorContent } from '../../utils/editorClipboard';
import type { MonacoEditor } from '../../types/monaco';

interface EditorCopyButtonProps {
  editor: MonacoEditor | null;
  style?: CSSProperties;
}

export function EditorCopyButton({ editor, style }: EditorCopyButtonProps) {
  const t = useTranslation();
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    if (!editor) {
      return;
    }

    const copied = await copyEditorContent(editor);
    if (!copied) {
      return;
    }

    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={isCopied ? t.editor.copiedCode : t.editor.copyCode}
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
        cursor: editor ? 'pointer' : 'not-allowed',
        opacity: editor ? 1 : 0.5,
        color: isCopied ? 'var(--success-color, #4caf50)' : 'var(--text-secondary)',
        backgroundColor: 'var(--bg-elevated)',
        backdropFilter: 'blur(8px)',
        border: '1px solid var(--surface-overlay-border)',
        boxShadow: 'var(--shadow-sm)',
        transition: 'all 0.15s ease',
        ...style,
      }}
    >
      {isCopied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      {isCopied ? t.editor.copiedCode : t.editor.copyCode}
    </button>
  );
}
