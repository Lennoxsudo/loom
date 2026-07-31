import { describe, expect, it } from 'vitest';
import {
  APP_DISPLAY_NAME,
  buildCoreSystemPrompt,
  buildRuntimeIdentityPrompt,
  CORE_SYSTEM_PROMPT_SECTIONS_FULL,
  CORE_SYSTEM_PROMPT_SECTIONS_PLAN,
} from '../coreSystemPrompt';

describe('buildRuntimeIdentityPrompt', () => {
  it('includes Loom app name and model id', () => {
    const prompt = buildRuntimeIdentityPrompt({
      provider: 'openai',
      model: 'gpt-4o',
    });

    expect(prompt).toContain(APP_DISPLAY_NAME);
    expect(prompt).toContain('You are the active model: gpt-4o.');
    expect(prompt).not.toContain('openai/gpt-4o');
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
    expect(prompt).toContain('## Code graph (prefer over blind search)');
    expect(prompt).toContain('graph_trace');
    expect(prompt).toContain('## Project memory');
    expect(prompt).toContain('`memory`');
    expect(prompt).toContain('action=upsert');
    expect(CORE_SYSTEM_PROMPT_SECTIONS_FULL).toHaveLength(19);
  });

  it('uses read-only file guidance in plan mode', () => {
    const prompt = buildCoreSystemPrompt({ planMode: true });

    expect(prompt).toContain('read-only');
    expect(prompt).toContain('## Code graph (prefer over blind search)');
    expect(prompt).not.toContain('## Using the shell');
    expect(prompt).not.toContain('## Shell execution guidelines');
    expect(CORE_SYSTEM_PROMPT_SECTIONS_PLAN.length).toBeLessThan(
      CORE_SYSTEM_PROMPT_SECTIONS_FULL.length
    );
  });

  it('includes plan mode workflow with exit_plan_mode and update_plan', () => {
    const prompt = buildCoreSystemPrompt({ planMode: true });

    expect(prompt).toContain('## Plan mode workflow');
    expect(prompt).toContain('`update_plan`');
    expect(prompt).toContain('`exit_plan_mode`');
    expect(prompt).toContain('[PLAN]');
  });

  it('omits Agent Memory section when disabled', () => {
    const prompt = buildCoreSystemPrompt({
      enableAgentMemory: false,
      enableAgentSessionSearch: false,
    });
    expect(prompt).not.toContain('## Agent memory');
    expect(prompt).not.toContain('`agent_memory`');
    expect(prompt).not.toContain('`session_search`');
  });

  it('keeps session_search guidance when only search is enabled', () => {
    const prompt = buildCoreSystemPrompt({
      enableAgentMemory: false,
      enableAgentSessionSearch: true,
    });
    expect(prompt).toContain('## Past conversation search');
    expect(prompt).toContain('`session_search`');
    expect(prompt).not.toContain('`agent_memory`');
  });

  it('includes do-not-recite guidance when Agent Memory is enabled', () => {
    const prompt = buildCoreSystemPrompt({ enableAgentMemory: true });
    expect(prompt).toContain('Do **not** recite the full Agent Memory block');
  });
});
