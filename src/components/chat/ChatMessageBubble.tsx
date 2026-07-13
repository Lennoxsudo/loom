import { useState, useEffect, memo } from 'react';
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
import type { Message } from './types';
import userBubbleStyles from './ChatUserBubble.module.css';

function MessageBubble({
  message,
  onUserMessageLayout,
}: {
  message: Message;
  onUserMessageLayout?: (messageId: string, element: HTMLElement | null) => void;
}) {
  const t = useTranslation();
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

  const isUser = message.role === 'user';
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const normalizeBr = (text?: string) => (text || '').replace(/<br\s*\/?\s*>/gi, '\n');
  const displaySeparation = isUser
    ? { text: message.content || '', thinking: '' }
    : { text: message.content || '', thinking: message.thinking || '' };

  const isActivelyThinking =
    !!message.isStreaming && !message.thinkingEndedAt && !!message.isThinking;

  useEffect(() => {
    if (isActivelyThinking) {
      setIsThinkingExpanded(true);
    } else if ((message.thinking || message.isThinking) && (message.thinkingEndedAt || !message.isStreaming)) {
      setIsThinkingExpanded(false);
    }
  }, [isActivelyThinking, message.thinkingEndedAt, message.isStreaming, message.thinking, message.isThinking]);

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

  const normalizedContent = normalizeBr(displayedContent);
  const normalizedThinking = stripStrayThinkTags(normalizeBr(displaySeparation.thinking));
  const hasThinking =
    !isUser &&
    (isActivelyThinking || normalizedThinking.trim().length > 0);
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
    (hasFileContext && fileNames.length > 0);

  if (!hasThinking && !imageAttachments.length && !(hasFileContext && fileNames.length > 0) && cleanedNormalizedContent.trim().length === 0) {
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
            thinkingStartedAt={message.thinkingStartedAt ?? message.firstChunkTime ?? message.startTime}
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
              ref={isUser ? (element) => onUserMessageLayout?.(message.id, element) : undefined}
              className={isUser ? userBubbleStyles.bubble : undefined}
              style={
                isUser
                  ? {
                      width: '100%',
                      maxWidth: '100%',
                    }
                  : {
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '6px 10px',
                      background: 'var(--bg-sidebar)',
                      borderRadius: '4px 14px 14px 14px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                      lineHeight: '1.55',
                      wordWrap: 'break-word',
                      border: '1px solid var(--border-primary)',
                      boxShadow: 'var(--shadow-sm)',
                    }
              }
            >
            {imageAttachments.length > 0 && (
              <div
                style={{
                  marginBottom:
                    cleanedNormalizedContent || (hasFileContext && fileNames.length > 0) ? '8px' : '0',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
                  gap: '6px',
                  minWidth: '144px',
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
                  marginBottom: cleanedNormalizedContent.trim().length > 0 ? '6px' : 0,
                  whiteSpace: 'normal',
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

            <div style={{ fontSize: '13px', lineHeight: '1.5' }}>
              {hasTextContent ? (
                isUser ? (
                  <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {cleanedNormalizedContent}
                  </span>
                ) : message.isStreaming ? (
                  // 流式时使用轻量级 Markdown 渲染器（无语法高亮，性能更优）
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

          </div>

            {isUser && (
              <div
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  opacity: isHovering || isCopied ? 1 : 0,
                  transition: 'opacity 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  zIndex: 1,
                }}
              >
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
  prev: { message: Message },
  next: { message: Message }
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
    (a.attachments?.length ?? 0) === (b.attachments?.length ?? 0)
  );
}

export default memo(MessageBubble, messageBubblePropsEqual);
