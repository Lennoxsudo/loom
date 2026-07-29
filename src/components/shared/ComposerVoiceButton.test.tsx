import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ComposerVoiceButton } from './ComposerVoiceButton';

describe('ComposerVoiceButton', () => {
  test('shows waveform while transcribing and ignores clicks', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = render(
      <ComposerVoiceButton state="transcribing" title="Transcribing…" onClick={onClick} />
    );

    expect(screen.getByRole('button', { name: 'Transcribing…' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(3);

    await user.click(screen.getByRole('button', { name: 'Transcribing…' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  test('recording shows mic and fires click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ComposerVoiceButton state="recording" title="Stop recording" onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Stop recording' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
