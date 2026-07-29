import { convertFileSrc } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import { useTranslation } from '../../i18n';
import type { ChatMessage } from '../../types/chat';
import {
  extractAnnotationLabelsFromPrefix,
  splitPrefixedUserMessageContent,
} from '../../utils/contextAnnotations';
import styles from './UserMessageBubble.module.css';

export interface UserMessageBubbleProps {
  message: ChatMessage;
  onUserMessageLayout?: (messageId: string, element: HTMLElement | null) => void;
  onResendFromUserMessage?: (messageId: string, newText: string) => void | Promise<void>;
  onForkFromUserMessage?: (messageId: string) => void | Promise<void>;
  editDisabled?: boolean;
  forkDisabled?: boolean;
}

export default function UserMessageBubble({
  message,
  onUserMessageLayout,
  onResendFromUserMessage,
  onForkFromUserMessage,
  editDisabled = false,
  forkDisabled = false,
}: UserMessageBubbleProps) {
  const t = useTranslation();
  const markers = [t.chat.contextAnnotation, t.chat.fileContext];
  const { prefix, body } = splitPrefixedUserMessageContent(message.text || '', markers);
  const annotationLabels = extractAnnotationLabelsFromPrefix(prefix);
  const displayText = message.slashCommand?.displayText ?? body;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayText);
  const [isResending, setIsResending] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasBody = Boolean(displayText || editing);

  const handleCopy = useCallback(() => {
    const textToCopy = displayText || message.text || '';
    if (!textToCopy) return;
    void navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [displayText, message.text]);

  const beginEdit = useCallback(() => {
    if (editDisabled || !onResendFromUserMessage) return;
    setDraft(displayText);
    setEditing(true);
  }, [editDisabled, onResendFromUserMessage, displayText]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft(displayText);
    setIsResending(false);
  }, [displayText]);

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
    if (!editing) setDraft(displayText);
  }, [displayText, editing]);

  const canEdit = !!onResendFromUserMessage && !editDisabled;
  const canFork = !!onForkFromUserMessage && !forkDisabled;

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
        <div className={editing ? styles.editPanel : styles.bubble}>
          {message.attachments && message.attachments.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                marginBottom:
                  hasBody || message.fileAttachments?.length || annotationLabels.length
                    ? '8px'
                    : '0',
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
          {(annotationLabels.length > 0 ||
            (message.fileAttachments && message.fileAttachments.length > 0)) && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px',
                marginBottom: hasBody ? '8px' : 0,
                whiteSpace: 'normal',
              }}
            >
              {annotationLabels.map((label) => (
                <div
                  key={label}
                  title={label}
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
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </span>
                </div>
              ))}
              {message.fileAttachments?.map((file) => (
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
            <>
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
              <div className={styles.editFooter}>
                <p className={styles.editHint}>{t.agent.userMessage.editHint}</p>
                <div className={styles.editActions}>
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
                    className={`${styles.sendButton} ${
                      isResending || !draft.trim() ? styles.sendButtonDisabled : ''
                    }`}
                    onClick={() => void submitEdit()}
                    disabled={isResending || !draft.trim()}
                    data-testid="user-message-resend"
                  >
                    {isResending ? t.agent.userMessage.resending : t.agent.userMessage.resend}
                  </button>
                </div>
              </div>
            </>
          ) : (
            displayText
          )}
        </div>

        {!editing && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={handleCopy}
              title={copied ? (t.common?.copied || '已复制') : (t.common?.copy || '复制')}
              aria-label={copied ? (t.common?.copied || '已复制') : (t.common?.copy || '复制')}
              data-testid="user-message-copy"
            >
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M13.5 4.5L6.5 11.5L3 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <rect
                    x="5.5"
                    y="5.5"
                    width="7"
                    height="7"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                  <path
                    d="M3.5 10.5V4A1.5 1.5 0 0 1 5 2.5h6.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>

            {canEdit && (
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
            )}

            {canFork && (
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => void onForkFromUserMessage?.(message.id)}
                title={t.agent.threads.forkFromHere}
                aria-label={t.agent.threads.forkFromHere}
                data-testid="user-message-fork"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <circle cx="5" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2" />
                  <circle cx="11" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2" />
                  <path
                    d="M6.5 4h3M5 5.5v5a2 2 0 0 0 2 2h2"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M11 5.5v5"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
