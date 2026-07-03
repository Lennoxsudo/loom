import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GenerateImageToolCard } from './GenerateImageToolCard';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('../../contexts/NotificationContext', () => ({
  useNotification: () => ({ showWarning: vi.fn() }),
}));

vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    agentInternal: {
      generateImagePending: 'Generating image',
      generateImageHint: 'Please wait',
      generateImageRunning: 'Rendering',
      generateImageFileMissing: 'Image file missing',
      generateImageOpenHint: 'Click to open in editor',
    },
    common: {
      completed: 'Completed',
      failed: 'Failed',
    },
  }),
}));

describe('GenerateImageToolCard', () => {
  it('renders glass layer while pending', () => {
    const { container } = render(
      <GenerateImageToolCard
        isPending
        prompt="A cute cat"
        size="2752x1536"
      />
    );

    expect(screen.getByText(/Generating image/i)).toBeTruthy();
    expect(container.querySelector('[data-testid="image-glass-viewport"]')).toBeTruthy();
  });

  it('renders multiple glass viewports when imageCount > 1', () => {
    const { container } = render(
      <GenerateImageToolCard
        isPending
        prompt="Two icons"
        size="1024x1024"
        imageCount={2}
      />
    );

    expect(container.querySelectorAll('[data-testid="image-glass-viewport"]').length).toBe(2);
  });

  it('shows error text when failed', () => {
    render(
      <GenerateImageToolCard
        isPending={false}
        isError
        errorText="Image generation failed"
      />
    );

    expect(screen.getByText('Image generation failed')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
  });
});
