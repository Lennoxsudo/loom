import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { loadChangeBlastRadius } from '../../utils/changeBlastRadius';
import ChangeReviewPanel from './ChangeReviewPanel';
import type { PendingFileChange } from './utils';

vi.mock('./ChangeReviewFilePreview', () => ({
  default: ({ change }: { change: PendingFileChange }) => (
    <div data-testid="change-review-file-preview">{change.filePath}</div>
  ),
}));

vi.mock('./CheckpointFilePreview', () => ({
  default: ({ file }: { file: { path: string } }) => (
    <div data-testid="checkpoint-file-preview">{file.path}</div>
  ),
}));

vi.mock('../../utils/changeBlastRadius', async () => {
  const actual = await vi.importActual<typeof import('../../utils/changeBlastRadius')>(
    '../../utils/changeBlastRadius'
  );
  return {
    ...actual,
    loadChangeBlastRadius: vi.fn(),
  };
});

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
        cbmReady={true}
        {...overrides}
      />
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.mocked(loadChangeBlastRadius).mockReset();
  vi.mocked(loadChangeBlastRadius).mockResolvedValue({
    filePath: pendingChange.filePath,
    empty: false,
    fileImporters: [{ name: 'OtherView', file: 'src/OtherView.vue', kind: 'imports' }],
    symbols: [
      {
        symbol: 'demo',
        highRisk: true,
        callers: [
          { name: 'a', file: 'src/a.ts', line: 1 },
          { name: 'b', file: 'src/b.ts', line: 2 },
          { name: 'c', file: 'src/c.ts', line: 3 },
          { name: 'd', file: 'src/d.ts', line: 4 },
          { name: 'e', file: 'src/e.ts', line: 5 },
        ],
      },
    ],
  });
});

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

  it('shows view impact button and disables it when CBM is not ready', () => {
    renderPanel({ cbmReady: false });

    const button = screen.getByTestId('review-view-impact');
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      'title',
      expect.stringMatching(/code graph not ready/i)
    );
  });

  it('loads blast radius into the impact preview when clicking view impact', async () => {
    const user = userEvent.setup();
    renderPanel({ cbmReady: true });

    await user.click(screen.getByTestId('review-view-impact'));

    expect(loadChangeBlastRadius).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'src/demo.ts',
      })
    );
    expect(await screen.findByTestId('change-review-impact')).toBeInTheDocument();
    expect(screen.getByTestId('blast-radius-panel')).toBeInTheDocument();
    expect(screen.getByText('High risk')).toBeInTheDocument();
    expect(screen.getByText('demo')).toBeInTheDocument();
  });

  it('opens checkpoint diff preview when selecting a checkpoint file', async () => {
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
    await user.click(screen.getByText('write · demo.ts'));

    expect(screen.getByTestId('checkpoint-detail-preview')).toBeInTheDocument();
    expect(screen.getByText('Checkpoint preview')).toBeInTheDocument();
    expect(screen.getByTestId('checkpoint-file-preview')).toHaveTextContent('src/demo.ts');
  });
});
