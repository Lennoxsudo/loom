import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ComposerVoiceLevelMeter } from './ComposerVoiceLevelMeter';

describe('ComposerVoiceLevelMeter', () => {
  test('renders one bar per level while active', () => {
    const { container } = render(
      <ComposerVoiceLevelMeter active levels={[0.2, 0.8, 0.4]} label="Recording" />
    );
    expect(screen.getByRole('img', { name: 'Recording' })).toBeInTheDocument();
    expect(container.querySelectorAll('[class*="bar"]').length).toBe(3);
  });

  test('hides when inactive', () => {
    const { container } = render(
      <ComposerVoiceLevelMeter active={false} levels={[0.5, 0.5]} label="Recording" />
    );
    expect(container.firstChild).toBeNull();
  });
});
