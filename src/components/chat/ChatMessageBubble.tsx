import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from '../../i18n';
import ThinkingBlock from '../agent/ThinkingBlock';
import ProviderSwitchNotice from '../agent/ProviderSwitchNotice';
import CompactBoundaryCard from '../shared/CompactBoundaryCard';
import { CopyIcon, CheckIcon } from '../shared/Icons';
import { FileTypeIcon } from '../shared/FileTypeIcon';
import { markdownComponents, cleanupFileTree } from '../shared/MarkdownRenderers';
import { lightMarkdownComponents } from '../shared/LightMarkdownRenderer';
import { normalizeAssistantMarkdown } from '../../utils/assistantMarkdownNormalizer';
import { stripStrayThinkTags } from '../../utils/thinkingExtractor';
import { splitChatUserMessageContent } from './chatUserMessageEdit';
import type { Message } from './types';
import userBubbleStyles from './ChatUserBubble.module.css';

export interface ChatMessageBubbleProps {
  message: Message;
  onUserMessageLayout?: (messageId: string, element: HTMLElement | null) => void;
  onResendFromUserMessage?: (messageId: string, newText: string) => void | Promise<void>;
  editDisabled?: boolean;
}

function MessageBubble({
  message,
  onUserMessageLayout,
  onResendFromUserMessage,
  editDisabled = false,
}: ChatMessageBubbleProps) {
  const t = useTranslation();
  const isUser = message.role === 'user';
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [isResending, setIsResending] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const normalizeBr = (text?: string) => (text || '').replace(/<br\s*\/?\s*>/gi, '\n');
  // Model payload stays in message.content; bubble prefers slash short form for the body.
  const storedContent = message.content || '';
  const displaySeparation = isUser
    ? {
        text: message.slashCommand
          ? (() => {
              const { prefix } = splitChatUserMessageContent(storedContent, t.chat.fileContext);
              return prefix
                ? `${prefix}${message.slashCommand!.displayText}`
                : message.slashCommand!.displayText;
            })()
          : storedContent,
        thinking: '',
      }
    : { text: storedContent, thinking: message.thinking || '' };

  const isActivelyThinking =
    !!message.isStreaming && !message.thinkingEndedAt && !!message.isThinking;

  useEffect(() => {
    if (isActivelyThinking) {
      setIsThinkingExpanded(true);
    } else if (
      (message.thinking || message.isThinking) &&
      (message.thinkingEndedAt || !message.isStreaming)
    ) {
      setIsThinkingExpanded(false);
    }
  }, [
    isActivelyThinking,
    message.thinkingEndedAt,
    message.isStreaming,
    message.thinking,
    message.isThinking,
  ]);

  const rawContent = displaySeparation.text || '';
  const imageAttachments = message.attachments || [];
  const hasFileContext = isUser && rawContent.startsWith(t.chat.fileContext);
  let displayedContent = rawContent;
  const fileNames: string[] = [];

  if (hasFileContext) {
    const splitIndex = rawContent.lastIndexOf('\n---\n\n');
    if (splitIndex !== -1) {
      const contextPart = rawContent.substring(0, splitIndex);
      displayedContent = rawContent.substring(splitIndex + 6);

      const contextNoCode = contextPart.replace(/```[\s\S]*?```/g, '');
      const headingMatches = contextNoCode.matchAll(/## (.+?)\n/g);
      for (const match of headingMatches) {
        fileNames.push(match[1].trim());
      }

      if (fileNames.length === 0) {
        const listMatches = contextNoCode.matchAll(/^- (.+?) \(`[^`]+`\)$/gm);
        for (const match of listMatches) {
          fileNames.push(match[1].trim());
        }
      }
    }
  }

  const editableBody = isUser
    ? (message.slashCommand?.displayText ??
      splitChatUserMessageContent(storedContent, t.chat.fileContext).body)
    : '';

  const beginEdit = useCallback(() => {
    if (editDisabled || !onResendFromUserMessage) return;
    setDraft(editableBody);
    setEditing(true);
  }, [editDisabled, onResendFromUserMessage, editableBody]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft(editableBody);
    setIsResending(false);
  }, [editableBody]);

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

  useEffect(() => {
    if (!editing) setDraft(editableBody);
  }, [editableBody, editing]);

  if (message.uiNotice?.type === 'provider-switch') {
    return (
      <div style={{ marginBottom: '4px', display: 'flex', justifyContent: 'center' }}>
        <ProviderSwitchNotice notice={message.uiNotice} variant="compact" />
      </div>
    );
  }

  if (message.compactBoundary && message.compactMetadata) {
    return <CompactBoundaryCard metadata={message.compactMetadata} />;
  }

  if (message.compactSummary) {
    return (
      <CompactBoundaryCard
        metadata={{
          compactedAt: message.timestamp,
          compactType: 'auto',
          headMessageId: message.id,
          anchorMessageId: message.id,
          tailMessageId: message.id,
          originalMessageIds: [],
          summaryMessageId: message.id,
        }}
        summaryText={message.content}
        variant="summary"
      />
    );
  }

  const canEdit = isUser && !!onResendFromUserMessage && !editDisabled;

  const normalizedContent = normalizeBr(displayedContent);
  const normalizedThinking = stripStrayThinkTags(normalizeBr(displaySeparation.thinking));
  const hasThinking = !isUser && (isActivelyThinking || normalizedThinking.trim().length > 0);
  const cleanedNormalizedContent = isUser
    ? normalizedContent
    : stripStrayThinkTags(normalizedContent).trimStart();
  const markdownReadyContent = isUser
    ? cleanedNormalizedContent
    : message.isStreaming
      ? cleanedNormalizedContent
      : normalizeAssistantMarkdown(cleanedNormalizedContent);
  const hasTextContent = cleanedNormalizedContent.trim().length > 0;
  const showContent =
    hasTextContent ||
    imageAttachments.length > 0 ||
    (hasFileContext && fileNames.length > 0) ||
    editing;

  if (
    !editing &&
    !hasThinking &&
    !imageAttachments.length &&
    !(hasFileContext && fileNames.length > 0) &&
    cleanedNormalizedContent.trim().length === 0
  ) {
    return null;
  }

  const handleCopy = () => {
    const text = cleanedNormalizedContent;
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        maxWidth: '100%',
        width: '100%',
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          maxWidth: '100%',
          minWidth: 0,
          width: '100%',
        }}
      >
        {hasThinking && (
          <ThinkingBlock
            thinking={normalizedThinking}
            isThinking={isActivelyThinking}
            thinkingStartedAt={
              message.thinkingStartedAt ?? message.firstChunkTime ?? message.startTime
            }
            thinkingEndedAt={message.thinkingEndedAt ?? message.firstContentTime ?? message.endTime}
            createdAt={message.startTime ?? message.timestamp}
            isExpanded={isThinkingExpanded}
            onToggle={() => setIsThinkingExpanded(!isThinkingExpanded)}
          />
        )}

        {showContent && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              flexDirection: 'row',
              justifyContent: 'flex-start',
              width: '100%',
              position: 'relative',
            }}
          >
            <div
              id={isUser ? `msg-${message.id}` : undefined}
              ref={
                isUser
                  ? (element) => {
                      rootRef.current = element;
                      onUserMessageLayout?.(message.id, element);
                    }
                  : undefined
              }
              className={
                isUser
                  ? editing
                    ? userBubbleStyles.editPanel
                    : userBubbleStyles.bubble
                  : undefined
              }
              style={
                isUser
                  ? {
                      width: '100%',
                      maxWidth: '100%',
                    }
                  : {
                      // Cursor-like assistant: content only, no bubble chrome
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: 0,
                      background: 'transparent',
                      borderRadius: 0,
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                      lineHeight: '1.65',
                      wordWrap: 'break-word',
                      border: 'none',
                      boxShadow: 'none',
                    }
              }
            >
              {imageAttachments.length > 0 && (
                <div
                  style={{
                    marginBottom:
                      cleanedNormalizedContent ||
                      (hasFileContext && fileNames.length > 0) ||
                      editing
                        ? '8px'
                        : '0',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
                    gap: '6px',
                    minWidth: '144px',
                    padding: editing ? '10px 14px 0' : undefined,
                  }}
                >
                  {imageAttachments.map((attachment, idx) => {
                    const name =
                      attachment.fileName ||
                      attachment.path.split(/[\\/]/).pop() ||
                      `image-${idx + 1}`;
                    return (
                      <div
                        key={`${attachment.id}-${idx}`}
                        style={{
                          borderRadius: '6px',
                          overflow: 'hidden',
                          border: '1px solid var(--surface-overlay-border)',
                          backgroundColor: 'var(--surface-overlay-soft)',
                        }}
                        title={`${name}${attachment.width > 0 && attachment.height > 0 ? ` (${attachment.width}x${attachment.height})` : ''}`}
                      >
                        <img
                          src={convertFileSrc(attachment.path)}
                          alt={name}
                          style={{
                            width: '100%',
                            height: '56px',
                            objectFit: 'cover',
                            display: 'block',
                          }}
                          draggable={false}
                        />
                        <div
                          style={{
                            padding: '2px 5px',
                            fontSize: '10px',
                            color: 'var(--text-secondary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {name}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {hasFileContext && fileNames.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px',
                    marginBottom: cleanedNormalizedContent.trim().length > 0 || editing ? '6px' : 0,
                    whiteSpace: 'normal',
                    padding: editing ? '0 14px' : undefined,
                  }}
                >
                  {fileNames.map((name, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        padding: '2px 6px',
                        backgroundColor: 'var(--surface-overlay-soft)',
                        border: '1px solid var(--surface-overlay-border)',
                        borderRadius: '4px',
                        fontSize: '10px',
                        maxWidth: '160px',
                      }}
                    >
                      <FileTypeIcon name={name} size={10} />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {name}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {editing ? (
                <>
                  <textarea
                    ref={textareaRef}
                    className={userBubbleStyles.editor}
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
                  <div className={userBubbleStyles.editFooter}>
                    <p className={userBubbleStyles.editHint}>{t.agent.userMessage.editHint}</p>
                    <div className={userBubbleStyles.editActions}>
                      <button
                        type="button"
                        className={userBubbleStyles.cancelButton}
                        onClick={cancelEdit}
                        disabled={isResending}
                      >
                        {t.agent.userMessage.cancelEdit}
                      </button>
                      <button
                        type="button"
                        className={`${userBubbleStyles.sendButton} ${
                          isResending || !draft.trim() ? userBubbleStyles.sendButtonDisabled : ''
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
                <div style={{ fontSize: '13px', lineHeight: '1.5' }}>
                  {hasTextContent ? (
                    isUser ? (
                      <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {cleanedNormalizedContent}
                      </span>
                    ) : message.isStreaming ? (
                      <ReactMarkdown
                        key={`md-${message.id}-streaming`}
                        remarkPlugins={[remarkGfm]}
                        components={lightMarkdownComponents}
                      >
                        {cleanupFileTree(cleanedNormalizedContent)}
                      </ReactMarkdown>
                    ) : (
                      <ReactMarkdown
                        key={`md-${message.id}-done`}
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {markdownReadyContent}
                      </ReactMarkdown>
                    )
                  ) : (
                    ''
                  )}
                </div>
              )}
            </div>

            {isUser && !editing && (
              <div
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  opacity: isHovering || isCopied ? 1 : 0,
                  transition: 'opacity 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  zIndex: 1,
                }}
              >
                {canEdit ? (
                  <button
                    type="button"
                    className={userBubbleStyles.iconButton}
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
                <button
                  onClick={handleCopy}
                  className={`${userBubbleStyles.copyButton} ${isCopied ? userBubbleStyles.copyButtonCopied : ''}`}
                  title="复制内容"
                >
                  {isCopied ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function messageBubblePropsEqual(
  prev: ChatMessageBubbleProps,
  next: ChatMessageBubbleProps
): boolean {
  const a = prev.message;
  const b = next.message;
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.content === b.content &&
    a.thinking === b.thinking &&
    a.isStreaming === b.isStreaming &&
    a.isThinking === b.isThinking &&
    a.timestamp === b.timestamp &&
    a.thinkingStartedAt === b.thinkingStartedAt &&
    a.thinkingEndedAt === b.thinkingEndedAt &&
    (a.attachments?.length ?? 0) === (b.attachments?.length ?? 0) &&
    prev.editDisabled === next.editDisabled &&
    prev.onResendFromUserMessage === next.onResendFromUserMessage
  );
}

export default memo(MessageBubble, messageBubblePropsEqual);
