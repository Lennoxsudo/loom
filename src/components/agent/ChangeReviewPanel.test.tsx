import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import ChangeReviewPanel from './ChangeReviewPanel';
import type { PendingFileChange } from './utils';

vi.mock('./ChangeReviewFilePreview', () => ({
  default: ({ change }: { change: PendingFileChange }) => (
    <div data-testid="change-review-file-preview">{change.filePath}</div>
  ),
}));

const pendingChange: PendingFileChange = {
  id: 'pc-1',
  agentId: 'agent-1',
  conversationId: 'conv-1',
  filePath: 'src/demo.ts',
  beforeContent: 'const x = 1;',
  afterContent: 'const x = 2;',
  toolName: 'write_file',
  createdAt: 1,
  updatedAt: 1,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof ChangeReviewPanel>> = {}) {
  render(
    <I18nProvider defaultLocale="en-US">
      <ChangeReviewPanel
        projectPath="D:\\project"
        pendingChanges={[pendingChange]}
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        onAccept={vi.fn()}
        onDiscard={vi.fn().mockResolvedValue(undefined)}
        onAcceptAll={vi.fn()}
        onDiscardAll={vi.fn().mockResolvedValue(undefined)}
        {...overrides}
      />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('ChangeReviewPanel', () => {
  it('shows review list without preview until a file is selected', () => {
    renderPanel();

    expect(screen.getByTestId('change-review-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('change-review-preview')).not.toBeInTheDocument();
    expect(screen.getByText('Change review (1)')).toBeInTheDocument();
    expect(screen.getByTestId('change-review-tab-files')).toBeInTheDocument();
    expect(screen.getByTestId('change-review-tab-timeline')).toBeInTheDocument();
    expect(screen.queryByText('Change preview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('change-review-file-preview')).not.toBeInTheDocument();
  });

  it('switches to checkpoint timeline tab', async () => {
    const user = userEvent.setup();
    const checkpoints = [
      {
        id: 'cp-1',
        sessionKey: 's',
        projectPath: 'D:\\project',
        toolName: 'write',
        label: 'write · demo.ts',
        createdAt: Date.now(),
        files: [
          {
            path: 'src/demo.ts',
            existed: true,
            isBinary: false,
            byteLen: 10,
            blob: 'x',
          },
        ],
      },
    ];
    renderPanel({ checkpoints });

    await user.click(screen.getByTestId('change-review-tab-timeline'));

    expect(screen.getByTestId('checkpoint-timeline')).toBeInTheDocument();
    expect(screen.getByText('write · demo.ts')).toBeInTheDocument();
    expect(screen.getByTestId('checkpoint-restore')).toBeInTheDocument();
  });

  it('opens preview when clicking a file name', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId('review-file-name'));

    expect(screen.getByTestId('change-review-preview')).toBeInTheDocument();
    expect(screen.getByText('Change preview')).toBeInTheDocument();
    expect(screen.getByTestId('change-review-file-preview')).toHaveTextContent('src/demo.ts');
  });

  it('closes preview when clicking the close button', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId('review-file-name'));
    expect(screen.getByTestId('change-review-preview')).toBeInTheDocument();

    await user.click(screen.getByTestId('change-review-close-preview'));

    expect(screen.queryByTestId('change-review-preview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('change-review-file-preview')).not.toBeInTheDocument();
  });

  it('switches preview when clicking another file name', async () => {
    const user = userEvent.setup();
    const secondChange: PendingFileChange = {
      ...pendingChange,
      id: 'pc-2',
      filePath: 'src/other.ts',
    };

    renderPanel({ pendingChanges: [pendingChange, secondChange] });

    await user.click(screen.getAllByTestId('review-file-name')[1]);

    expect(screen.getByTestId('change-review-file-preview')).toHaveTextContent('src/other.ts');
  });
});
