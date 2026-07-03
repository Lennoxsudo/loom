import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ComposerQuestionAnchor from './ComposerQuestionAnchor';

vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    agentInline: {
      needsConfirmation: '需要您的确认',
      answered: '已回答',
      confirmSelection: '确认选择',
      multiSelectHint: '可多选',
    },
    actions: {
      cancel: '取消',
    },
  }),
}));

afterEach(() => {
  cleanup();
});

describe('ComposerQuestionAnchor', () => {
  it('renders question panel above composer without taking document flow space', () => {
    render(
      <ComposerQuestionAnchor
        questions={[
          {
            header: '测试',
            question: '请选择',
            options: [
              { label: 'A', description: 'Option A' },
              { label: 'B', description: 'Option B' },
            ],
          },
        ]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      >
        <div data-testid="composer-slot">composer</div>
      </ComposerQuestionAnchor>
    );

    const overlay = screen.getByTestId('inline-question-overlay');
    const composer = screen.getByTestId('composer-slot');

    expect(overlay).toBeInTheDocument();
    expect(composer).toBeInTheDocument();
    expect(screen.getByTestId('inline-question-panel')).toBeInTheDocument();
    expect(overlay.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides panel when there are no questions', () => {
    render(
      <ComposerQuestionAnchor questions={undefined} onSubmit={vi.fn()} onCancel={vi.fn()}>
        <div data-testid="composer-slot">composer</div>
      </ComposerQuestionAnchor>
    );

    expect(screen.queryByTestId('inline-question-overlay')).not.toBeInTheDocument();
  });
});
