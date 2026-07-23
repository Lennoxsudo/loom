import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import ExecCommandCard from './ExecCommandCard';
import type { ParsedCommandExec } from '../../utils/parseCommandExecOutput';

vi.mock('../../utils/notification', () => ({
  showSuccess: vi.fn(),
}));

const baseParsed: ParsedCommandExec = {
  command: 'echo hello',
  output: 'hello',
  exitCode: 0,
  durationMs: 42,
  timedOut: false,
  isBackgroundStart: false,
};

function renderCard(
  parsed: ParsedCommandExec = baseParsed,
  options?: { isRunning?: boolean; isError?: boolean }
) {
  render(
    <I18nProvider defaultLocale="en-US">
      <ExecCommandCard
        parsed={parsed}
        isRunning={options?.isRunning ?? false}
        isError={options?.isError ?? false}
      />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('ExecCommandCard', () => {
  test('renders command and inline meta when collapsed', () => {
    renderCard();
    expect(screen.getByText('echo hello')).toBeInTheDocument();
    // exit code + duration are visible in header without expanding
    // body stays mounted for expand animation, so meta may appear twice in DOM
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('42ms').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1 ln').length).toBeGreaterThanOrEqual(1);
  });

  test('shows exit code and duration in rail when expanded', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    // header + rail both show exit / duration
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('42ms').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Copy output')).toBeInTheDocument();
  });

  test('shows running state', () => {
    renderCard(
      { ...baseParsed, output: '', exitCode: null, durationMs: null },
      { isRunning: true }
    );
    expect(screen.getAllByText('Running…').length).toBeGreaterThan(0);
    expect(screen.getByText('run')).toBeInTheDocument();
  });

  test('shows output while running and collapses when finished', () => {
    const output = 'terminal output line';
    const { rerender } = render(
      <I18nProvider defaultLocale="en-US">
        <ExecCommandCard
          parsed={{ ...baseParsed, output, exitCode: null, durationMs: null }}
          isRunning
          isError={false}
        />
      </I18nProvider>
    );
    expect(screen.getByText(output)).toBeInTheDocument();
    expect(screen.getByTestId('exec-command-body')).toHaveAttribute('aria-hidden', 'false');

    rerender(
      <I18nProvider defaultLocale="en-US">
        <ExecCommandCard parsed={{ ...baseParsed, output }} isRunning={false} isError={false} />
      </I18nProvider>
    );
    // body stays mounted for collapse animation; collapsed via grid-template-rows 0fr
    expect(screen.getByText(output)).toBeInTheDocument();
    expect(screen.getByTestId('exec-command-body')).toHaveAttribute('aria-hidden', 'true');
  });

  test('hides output by default and expands on header click', async () => {
    const user = userEvent.setup();
    renderCard({ ...baseParsed, output: 'terminal output line' });

    expect(screen.getByTestId('exec-command-body')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('terminal output line')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByTestId('exec-command-body')).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByText('terminal output line')).toBeInTheDocument();
  });

  test('collapses long output and expands on click', async () => {
    const user = userEvent.setup();
    const longOutput = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n');
    renderCard({ ...baseParsed, output: longOutput });

    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    const innerExpand = screen.getByText('Expand all');
    await user.click(innerExpand);
    expect(screen.getByText('Collapse')).toBeInTheDocument();
  });

  test('copy button is present', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
  });
});
