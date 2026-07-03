import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import UserMessageStickyBar from './UserMessageStickyBar';
import type { ChatMessage } from '../../types/chat';

vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    agent: {
      scrollToUserMessage: 'Jump to user message',
      userMessageAttachmentOnly: '(Contains attachments)',
    },
  }),
}));

describe('UserMessageStickyBar', () => {
  it('renders preview text and triggers jump callback', () => {
    const onJump = vi.fn();
    const message: ChatMessage = {
      id: 'u1',
      role: 'user',
      text: 'Optimize the todo dropdown lag issue',
      createdAt: Date.now(),
    };

    render(<UserMessageStickyBar message={message} onJump={onJump} />);

    expect(screen.getByText('Optimize the todo dropdown lag issue')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Jump to user message' }));
    expect(onJump).toHaveBeenCalledTimes(1);
  });
});
