import { memo, useMemo, useState, useCallback } from 'react';
import type { ChatMessage } from '../../types/chat';
import { scrollToMessage, type UserMessageLayoutCache } from './messageScrollUtils';
import styles from './MessageAnchorRail.module.css';

interface MessageAnchorRailProps {
  messages: ChatMessage[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  getLayoutCache: () => UserMessageLayoutCache;
  activeMessageId?: string | null;
}

interface HoveredAnchor {
  text: string;
  top: number;
  left: number;
}

/** 提取用户消息的纯文本预览（截断过长内容） */
function getMessagePreview(text: string, maxLength = 500): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength) + '…';
}

const MessageAnchorRail = memo(function MessageAnchorRail({
  messages,
  scrollContainerRef,
  getLayoutCache,
  activeMessageId,
}: MessageAnchorRailProps) {
  const [hovered, setHovered] = useState<HoveredAnchor | null>(null);

  const userMessages = useMemo(
    () => messages.filter((m) => m.role === 'user' && m.text.trim().length > 0),
    [messages],
  );

  const handleClick = useCallback(
    (messageId: string) => {
      const container = scrollContainerRef.current;
      if (!container) return;
      scrollToMessage(container, messageId, 'smooth', getLayoutCache());
    },
    [scrollContainerRef, getLayoutCache],
  );

  if (userMessages.length === 0) return null;

  return (
    <div className={styles.rail}>
      <div className={styles.anchorStack}>
        {userMessages.map((msg) => (
          <div
            key={msg.id}
            className={`${styles.anchor} ${msg.id === activeMessageId ? styles.anchorActive : ''}`}
            onClick={() => handleClick(msg.id)}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setHovered({
                text: msg.text,
                top: rect.top + rect.height / 2,
                left: rect.right + 10,
              });
            }}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
      </div>
      {hovered && (
        <div
          className={styles.previewWindow}
          style={{ top: hovered.top, left: hovered.left }}
        >
          {getMessagePreview(hovered.text)}
        </div>
      )}
    </div>
  );
});

export default MessageAnchorRail;
