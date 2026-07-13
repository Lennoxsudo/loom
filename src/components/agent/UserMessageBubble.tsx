import { convertFileSrc } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import { useTranslation } from '../../i18n';
import type { ChatMessage } from '../../types/chat';
import styles from './UserMessageBubble.module.css';

export interface UserMessageBubbleProps {
  message: ChatMessage;
  onUserMessageLayout?: (messageId: string, element: HTMLElement | null) => void;
  onResendFromUserMessage?: (messageId: string, newText: string) => void | Promise<void>;
  editDisabled?: boolean;
}

export default function UserMessageBubble({
  message,
  onUserMessageLayout,
  onResendFromUserMessage,
  editDisabled = false,
}: UserMessageBubbleProps) {
  const t = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const [isResending, setIsResending] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const beginEdit = useCallback(() => {
    if (editDisabled || !onResendFromUserMessage) return;
    setDraft(message.text);
    setEditing(true);
  }, [editDisabled, onResendFromUserMessage, message.text]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft(message.text);
    setIsResending(false);
  }, [message.text]);

  const submitEdit = useCallback(async () => {
    if (!onResendFromUserMessage || isResending) return;
    const next = draft.trim();
    if (!next) return;
    setIsResending(true);
    try {
      await onResendFromUserMessage(message.id, next);
      setEditing(false);
    } finally {
      setIsResending(false);
    }
  }, [onResendFromUserMessage, isResending, draft, message.id]);

  useEffect(() => {
    if (!editing) return;
    const focusTimer = window.setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }, 0);

    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) {
        cancelEdit();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelEdit();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [editing, cancelEdit]);

  // Reset local draft when the underlying message text changes (e.g. after resend).
  useEffect(() => {
    if (!editing) setDraft(message.text);
  }, [message.text, editing]);

  const canEdit = !!onResendFromUserMessage && !editDisabled;

  return (
    <div
      id={`msg-${message.id}`}
      ref={(element) => {
        rootRef.current = element;
        onUserMessageLayout?.(message.id, element);
      }}
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'flex-start',
        gap: '6px',
        marginBottom: '8px',
      }}
    >
      <div className={styles.wrap}>
        <div className={`${styles.bubble} ${editing ? styles.bubbleEditing : ''}`}>
          {message.attachments && message.attachments.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                marginBottom: message.text || message.fileAttachments?.length ? '8px' : '0',
              }}
            >
              {message.attachments.map((att) => (
                <img
                  key={att.id}
                  src={convertFileSrc(att.path)}
                  alt="Attachment"
                  style={{
                    maxHeight: '120px',
                    maxWidth: '100%',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    objectFit: 'cover',
                  }}
                />
              ))}
            </div>
          )}
          {message.fileAttachments && message.fileAttachments.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px',
                marginBottom: message.text || editing ? '8px' : 0,
                whiteSpace: 'normal',
              }}
            >
              {message.fileAttachments.map((file) => (
                <div
                  key={file.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 7px',
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '5px',
                    fontSize: '11px',
                    maxWidth: '200px',
                  }}
                >
                  <FileTypeIcon name={file.name} size={12} />
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {file.name}
                  </span>
                </div>
              ))}
            </div>
          )}

          {editing ? (
            <textarea
              ref={textareaRef}
              className={styles.editor}
              value={draft}
              disabled={isResending}
              rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submitEdit();
                }
              }}
              aria-label={t.agent.userMessage.editAria}
              data-testid="user-message-edit-input"
            />
          ) : (
            message.text
          )}
        </div>

        <div className={styles.actions}>
          {editing ? (
            <>
              <span className={styles.editHint}>{t.agent.userMessage.editHint}</span>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={cancelEdit}
                disabled={isResending}
              >
                {t.agent.userMessage.cancelEdit}
              </button>
              <button
                type="button"
                className={styles.sendButton}
                onClick={() => void submitEdit()}
                disabled={isResending || !draft.trim()}
                data-testid="user-message-resend"
              >
                {isResending ? t.agent.userMessage.resending : t.agent.userMessage.resend}
              </button>
            </>
          ) : canEdit ? (
            <button
              type="button"
              className={styles.iconButton}
              onClick={beginEdit}
              title={t.agent.userMessage.edit}
              aria-label={t.agent.userMessage.edit}
              data-testid="user-message-edit"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M11.5 2.5a1.4 1.4 0 0 1 2 2L5.8 12.2 3 13l.8-2.8L11.5 2.5Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
