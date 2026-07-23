/**
 * Property-based tests for rulesPersistence
 *
 * Feature: agent-rules, Property 1: RulesConfig 持久化往返一致性
 * Validates: Requirements 1.2, 1.3, 3.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { invoke } from '@tauri-apps/api/core';
import type { RulesConfig, RuleItem } from '../../types/rules';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

/**
 * Arbitrary generator for a valid ISO timestamp string.
 * Uses integer range to avoid invalid date issues.
 */
const isoDateArb = fc
  .integer({ min: 946684800000, max: 4102444800000 }) // 2000-01-01 to 2099-12-31
  .map((ts) => new Date(ts).toISOString());

/**
 * Arbitrary generator for a valid RuleItem.
 * Uses printable unicode strings to ensure JSON round-trip safety.
 */
const ruleItemArb: fc.Arbitrary<RuleItem> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 0, maxLength: 100 }),
  content: fc.string({ minLength: 0, maxLength: 500 }),
  createdAt: isoDateArb,
  updatedAt: isoDateArb,
});

/**
 * Arbitrary generator for a valid RulesConfig.
 */
const rulesConfigArb: fc.Arbitrary<RulesConfig> = fc.record({
  chatRules: fc.array(ruleItemArb, { minLength: 0, maxLength: 10 }),
  rulesTemplates: fc.array(ruleItemArb, { minLength: 0, maxLength: 10 }),
});

describe('Feature: agent-rules, Property 1: RulesConfig 持久化往返一致性', () => {
  let fileStore: Map<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    fileStore = new Map();

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      const params = args as Record<string, unknown> | undefined;
      if (cmd === 'get_app_data_path') {
        return '/mock/app/data';
      }
      if (cmd === 'write_file_content') {
        const { filePath, content } = params as { filePath: string; content: string };
        fileStore.set(filePath, content);
        return undefined;
      }
      if (cmd === 'read_file_content') {
        const { filePath } = params as { filePath: string };
        const stored = fileStore.get(filePath);
        if (stored === undefined) {
          throw new Error('File not found');
        }
        return stored;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  /**
   * **Validates: Requirements 1.2, 1.3, 3.5**
   *
   * For any valid RulesConfig (containing any number of chatRules and rulesTemplates),
   * serializing and saving to file system then loading should produce a RulesConfig
   * equivalent to the original.
   */
  it('save then load should produce equivalent RulesConfig', async () => {
    await fc.assert(
      fc.asyncProperty(rulesConfigArb, async (config) => {
        // Need fresh module to reset cached _appDataPath
        const { saveRulesConfig, loadRulesConfig } = await import('../rulesPersistence');

        // Save the config
        await saveRulesConfig(config);

        // Load it back
        const loaded = await loadRulesConfig();

        // Verify round-trip equivalence
        expect(loaded.chatRules).toEqual(config.chatRules);
        expect(loaded.rulesTemplates).toEqual(config.rulesTemplates);
      }),
      { numRuns: 100 }
    );
  });
});
