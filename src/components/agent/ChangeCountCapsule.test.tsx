import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import ChangeCountCapsule from './ChangeCountCapsule';
import type { PendingFileChange } from './utils';

function makeChange(overrides: Partial<PendingFileChange> = {}): PendingFileChange {
  return {
    id: 'change-1',
    agentId: 'agent-1',
    conversationId: 'conv-1',
    filePath: 'src/demo.ts',
    beforeContent: null,
    afterContent: 'line1\nline2\nline3',
    toolName: 'write',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function renderCapsule(pendingChanges: PendingFileChange[], onOpenReview = vi.fn()) {
  render(
    <I18nProvider defaultLocale="zh-CN">
      <ChangeCountCapsule pendingChanges={pendingChanges} onOpenReview={onOpenReview} />
    </I18nProvider>
  );
  return { onOpenReview };
}

afterEach(() => {
  cleanup();
});

describe('ChangeCountCapsule', () => {
  it('renders nothing when there are no pending changes', () => {
    renderCapsule([]);
    expect(screen.queryByTestId('change-count-capsule')).not.toBeInTheDocument();
  });

  it('renders nothing when line stats are zero', () => {
    renderCapsule([
      makeChange({
        beforeContent: 'same',
        afterContent: 'same',
      }),
    ]);
    expect(screen.queryByTestId('change-count-capsule')).not.toBeInTheDocument();
  });

  it('shows aggregated change counts', () => {
    renderCapsule([
      makeChange({
        beforeContent: null,
        afterContent: 'a\nb\nc',
      }),
      makeChange({
        id: 'change-2',
        filePath: 'src/other.ts',
        beforeContent: 'x\ny',
        afterContent: '',
        toolName: 'delete_file',
      }),
    ]);

    expect(screen.getByTestId('change-count-capsule')).toHaveTextContent('变更');
    expect(screen.getByTestId('change-count-capsule')).toHaveTextContent('+3');
    expect(screen.getByTestId('change-count-capsule')).toHaveTextContent('-2');
  });

  it('calls onOpenReview when clicked', () => {
    const { onOpenReview } = renderCapsule([makeChange()]);
    fireEvent.click(screen.getByTestId('change-count-capsule'));
    expect(onOpenReview).toHaveBeenCalledTimes(1);
  });
});
