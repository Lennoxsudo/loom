import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import UserMessageBubble from './UserMessageBubble';
import type { ChatMessage } from '../../types/chat';

const userMessage: ChatMessage = {
  id: 'u-1',
  role: 'user',
  text: 'original task',
  createdAt: 1,
};

function renderBubble(overrides: Partial<React.ComponentProps<typeof UserMessageBubble>> = {}) {
  return render(
    <I18nProvider defaultLocale="en-US">
      <UserMessageBubble message={userMessage} {...overrides} />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('UserMessageBubble', () => {
  it('shows edit button and enters edit mode', async () => {
    const user = userEvent.setup();
    const onResend = vi.fn();
    renderBubble({ onResendFromUserMessage: onResend });

    expect(screen.getByText('original task')).toBeInTheDocument();
    await user.click(screen.getByTestId('user-message-edit'));
    expect(screen.getByTestId('user-message-edit-input')).toBeInTheDocument();
    expect(screen.getByTestId('user-message-resend')).toBeInTheDocument();
  });

  it('cancels edit when clicking outside', async () => {
    const user = userEvent.setup();
    renderBubble({ onResendFromUserMessage: vi.fn() });

    await user.click(screen.getByTestId('user-message-edit'));
    expect(screen.getByTestId('user-message-edit-input')).toBeInTheDocument();

    await user.click(document.body);
    expect(screen.queryByTestId('user-message-edit-input')).not.toBeInTheDocument();
    expect(screen.getByText('original task')).toBeInTheDocument();
  });

  it('resends edited text', async () => {
    const user = userEvent.setup();
    const onResend = vi.fn().mockResolvedValue(undefined);
    renderBubble({ onResendFromUserMessage: onResend });

    await user.click(screen.getByTestId('user-message-edit'));
    const input = screen.getByTestId('user-message-edit-input');
    await user.clear(input);
    await user.type(input, 'revised task');
    await user.click(screen.getByTestId('user-message-resend'));

    expect(onResend).toHaveBeenCalledWith('u-1', 'revised task');
  });
});
