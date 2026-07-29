import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../i18n';
import AgentContextUsagePopover from './AgentContextUsagePopover';
import type { AgentContextUsage } from './contextUsage';

const usage: AgentContextUsage = {
  maxContextTokens: 200_000,
  availableContextTokens: 191_808,
  messageTokens: 12_000,
  toolTokens: 3_000,
  usedTokens: 15_000,
  usagePercent: 7.8,
  breakdown: {
    system: 1200,
    rules: 400,
    skills: 800,
    tools: 3000,
    messages: 6600,
  },
  compressionThresholdTokens: 150_000,
  messageTokensForCompact: 10_000,
  tokensUntilCompact: 140_000,
};

function renderPopover() {
  return render(
    <I18nProvider defaultLocale="en-US">
      <AgentContextUsagePopover
        usage={usage}
        safeTotalTokens={usage.usedTokens}
        ctxPercent={usage.usagePercent}
        maxContextTokens={usage.availableContextTokens}
      />
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe('AgentContextUsagePopover', () => {
  it('opens breakdown dialog when clicking the token ring', async () => {
    const user = userEvent.setup();
    renderPopover();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('agent-context-usage-trigger'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Context')).toBeInTheDocument();
    expect(screen.getByText('System prompt')).toBeInTheDocument();
    expect(screen.getByText('Tool schemas')).toBeInTheDocument();
    expect(screen.queryByText('Until compact')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimated cost')).not.toBeInTheDocument();
  });

  it('highlights matching segment when hovering a breakdown row', async () => {
    const user = userEvent.setup();
    renderPopover();
    await user.click(screen.getByTestId('agent-context-usage-trigger'));

    const skillsRow = screen.getByTestId('context-usage-row-skills');
    const skillsSegment = screen.getByTestId('context-usage-segment-skills');

    expect(skillsRow).toHaveAttribute('data-highlighted', 'false');
    expect(skillsSegment).toHaveAttribute('data-highlighted', 'false');

    await user.hover(skillsRow);

    expect(skillsRow).toHaveAttribute('data-highlighted', 'true');
    expect(skillsSegment).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('context-usage-segment-messages')).toHaveAttribute(
      'data-highlighted',
      'false'
    );
  });
});
