import { memo } from 'react';
import ScrollToBottomButton from '../shared/ScrollToBottomButton';

export interface ChatScrollToBottomButtonProps {
  onClick: () => void;
  bottomOffset?: number;
}

function ChatScrollToBottomButton({ onClick, bottomOffset = 16 }: ChatScrollToBottomButtonProps) {
  return <ScrollToBottomButton onClick={onClick} style={{ bottom: bottomOffset }} />;
}

export default memo(ChatScrollToBottomButton);
