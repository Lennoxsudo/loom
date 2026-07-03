import { memo, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { getUserMessagePreviewText } from './messageScrollUtils';
import type { ChatMessage } from '../../types/chat';
import styles from './UserMessageStickyBar.module.css';
import userBubbleStyles from '../chat/ChatUserBubble.module.css';

interface UserMessageStickyBarProps {
  message?: ChatMessage;
  previewText?: string;
  variant?: 'agent' | 'chat';
  onJump: () => void;
}

const UserMessageStickyBar = memo(function UserMessageStickyBar({
  message,
  previewText: previewTextProp,
  variant = 'agent',
  onJump,
}: UserMessageStickyBarProps) {
  const t = useTranslation();

  const previewText =
    previewTextProp ??
    (message ? getUserMessagePreviewText(message, t.agent.userMessageAttachmentOnly) : '');
  const handleClick = useCallback(() => {
    onJump();
  }, [onJump]);

  if (!previewText) return null;

  return (
    <button
      type="button"
      className={variant === 'chat' ? userBubbleStyles.bubbleButton : styles.root}
      onClick={handleClick}
      aria-label={t.agent.scrollToUserMessage}
      title={t.agent.scrollToUserMessage}
    >
      <span className={variant === 'chat' ? userBubbleStyles.bubbleTextClamped : styles.text}>
        {previewText}
      </span>
    </button>
  );
});

export default UserMessageStickyBar;
