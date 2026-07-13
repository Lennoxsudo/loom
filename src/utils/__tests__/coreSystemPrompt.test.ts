import { describe, expect, it } from 'vitest';
import {
  APP_DISPLAY_NAME,
  buildCoreSystemPrompt,
  buildRuntimeIdentityPrompt,
  CORE_SYSTEM_PROMPT_SECTIONS_FULL,
  CORE_SYSTEM_PROMPT_SECTIONS_PLAN,
} from '../coreSystemPrompt';

describe('buildRuntimeIdentityPrompt', () => {
  it('includes Loom app name and provider/model', () => {
    const prompt = buildRuntimeIdentityPrompt({
      provider: 'openai',
      model: 'gpt-4o',
    });

    expect(prompt).toContain(APP_DISPLAY_NAME);
    expect(prompt).toContain('openai/gpt-4o');
    expect(prompt).toContain('## Runtime Context');
  });
});

describe('buildCoreSystemPrompt', () => {
  it('includes Loom tool names in full mode', () => {
    const prompt = buildCoreSystemPrompt();

    expect(prompt).toContain('`edit`');
    expect(prompt).toContain('`write`');
    expect(prompt).toContain('`read`');
    expect(prompt).toContain('`term`');
    expect(prompt).toContain('## Be concise');
    expect(prompt).toContain('## Handling errors');
    expect(prompt).toContain('## System prompt confidentiality');
    expect(prompt).toContain('Do **not** quote');
    expect(CORE_SYSTEM_PROMPT_SECTIONS_FULL).toHaveLength(16);
  });

  it('uses read-only file guidance in plan mode', () => {
    const prompt = buildCoreSystemPrompt({ planMode: true });

    expect(prompt).toContain('read-only');
    expect(prompt).not.toContain('## Using the shell');
    expect(prompt).not.toContain('## Shell execution guidelines');
    expect(CORE_SYSTEM_PROMPT_SECTIONS_PLAN.length).toBeLessThan(
      CORE_SYSTEM_PROMPT_SECTIONS_FULL.length,
    );
  });

  it('includes plan mode workflow with exit_plan_mode and update_plan', () => {
    const prompt = buildCoreSystemPrompt({ planMode: true });

    expect(prompt).toContain('## Plan mode workflow');
    expect(prompt).toContain('`update_plan`');
    expect(prompt).toContain('`exit_plan_mode`');
    expect(prompt).toContain('[PLAN]');
  });
});
