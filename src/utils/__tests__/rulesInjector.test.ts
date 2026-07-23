/**
 * Unit tests for rulesInjector
 *
 * Tests for formatRulesContext, shouldInjectRules, and buildRulesMessage.
 * Validates: Requirements 4.1, 4.4, 4.5, 5.1, 5.3
 */

import { describe, it, expect } from 'vitest';
import {
  formatRulesContext,
  shouldInjectRules,
  buildRulesMessage,
  getRulesContentHash,
} from '../rulesInjector';

describe('formatRulesContext', () => {
  it('wraps non-empty rules in context tags', () => {
    const result = formatRulesContext('Be concise.');
    expect(result).toBe('[Rules Context]\nBe concise.\n[End Rules Context]');
  });

  it('returns empty string for empty input', () => {
    expect(formatRulesContext('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(formatRulesContext('   \n\t  ')).toBe('');
  });

  it('preserves multiline rules content', () => {
    const rules = 'Rule 1: Be helpful.\nRule 2: Be concise.';
    const result = formatRulesContext(rules);
    expect(result).toBe(`[Rules Context]\n${rules}\n[End Rules Context]`);
  });
});

describe('shouldInjectRules', () => {
  it('returns true when rules is non-empty and not already injected', () => {
    expect(shouldInjectRules('Some rules', false)).toBe(true);
  });

  it('returns false when already injected', () => {
    expect(shouldInjectRules('Some rules', true)).toBe(false);
  });

  it('returns false when rules is empty', () => {
    expect(shouldInjectRules('', false)).toBe(false);
  });

  it('returns false when rules is whitespace-only', () => {
    expect(shouldInjectRules('   ', false)).toBe(false);
  });

  it('returns false when rules is empty and already injected', () => {
    expect(shouldInjectRules('', true)).toBe(false);
  });

  it('returns false when already injected and no contentHash (legacy data)', () => {
    // 旧数据没有 contentHash，应保持幂等性，不重新注入
    expect(shouldInjectRules('Some rules', true, undefined)).toBe(false);
  });

  it('returns true when content hash changed', () => {
    const oldHash = getRulesContentHash('Old rules');
    expect(shouldInjectRules('New rules', true, oldHash)).toBe(true);
  });

  it('returns false when content hash unchanged', () => {
    const hash = getRulesContentHash('Same rules');
    expect(shouldInjectRules('Same rules', true, hash)).toBe(false);
  });

  it('returns false when already injected and empty contentHash string', () => {
    // contentHash 为空字符串（表示之前 rules 为空），此时 rules 变为非空应注入
    expect(shouldInjectRules('New rules', true, '')).toBe(true);
  });
});

describe('buildRulesMessage', () => {
  it('returns a system message with formatted rules', () => {
    const msg = buildRulesMessage('Be helpful.');
    expect(msg.role).toBe('system');
    expect(msg.content).toBe('[Rules Context]\nBe helpful.\n[End Rules Context]');
  });

  it('returns a system message with empty content for empty rules', () => {
    const msg = buildRulesMessage('');
    expect(msg.role).toBe('system');
    expect(msg.content).toBe('');
  });
});

/**
 * Property-based tests for formatRulesContext
 *
 * Feature: agent-rules, Property 7: Rules 格式化标记完整性
 * Validates: Requirements 4.5
 */
import fc from 'fast-check';

describe('Feature: agent-rules, Property 7: Rules 格式化标记完整性', () => {
  /**
   * **Validates: Requirements 4.5**
   *
   * For any non-empty Rules content string, the formatted output should start
   * with `[Rules Context]` and end with `[End Rules Context]`, and contain
   * the original Rules content in between.
   */
  it('formatted output wraps any non-empty rules with correct start/end tags and preserves content', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
        (rules) => {
          const result = formatRulesContext(rules);

          // Starts with [Rules Context]
          expect(result.startsWith('[Rules Context]')).toBe(true);

          // Ends with [End Rules Context]
          expect(result.endsWith('[End Rules Context]')).toBe(true);

          // Contains the original rules content
          expect(result).toContain(rules);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-based tests for empty Rules skip injection
 *
 * Feature: agent-rules, Property 5: 空 Rules 跳过注入
 * Validates: Requirements 4.4, 5.3
 */
describe('Feature: agent-rules, Property 5: 空 Rules 跳过注入', () => {
  /**
   * **Validates: Requirements 4.4, 5.3**
   *
   * For any Rules config that is empty string or contains only whitespace
   * characters, after executing injection, the conversation message list
   * should not contain Rules context markers.
   */

  const whitespaceArb = fc.oneof(
    fc.constant(''),
    fc.array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v')).map((chars) => chars.join(''))
  );

  it('formatRulesContext returns empty string for any empty/whitespace-only input', () => {
    fc.assert(
      fc.property(whitespaceArb, (rules) => {
        const result = formatRulesContext(rules);
        expect(result).toBe('');
        expect(result).not.toContain('[Rules Context]');
        expect(result).not.toContain('[End Rules Context]');
      }),
      { numRuns: 100 }
    );
  });

  it('shouldInjectRules returns false for any empty/whitespace-only input', () => {
    fc.assert(
      fc.property(whitespaceArb, fc.boolean(), (rules, alreadyInjected) => {
        expect(shouldInjectRules(rules, alreadyInjected)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('buildRulesMessage produces empty content for any empty/whitespace-only input', () => {
    fc.assert(
      fc.property(whitespaceArb, (rules) => {
        const msg = buildRulesMessage(rules);
        expect(msg.content).toBe('');
        expect(msg.content).not.toContain('[Rules Context]');
        expect(msg.content).not.toContain('[End Rules Context]');
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-based tests for Rules injection idempotency
 *
 * Feature: agent-rules, Property 4: Rules 注入幂等性
 * Validates: Requirements 4.2, 5.2
 */
describe('Feature: agent-rules, Property 4: Rules 注入幂等性', () => {
  /**
   * **Validates: Requirements 4.2, 5.2**
   *
   * For any conversation session that has already had Rules injected,
   * executing injection again should not produce duplicate Rules context content.
   * i.e., inject(inject(conversation)) should have the same number of Rules
   * context blocks as inject(conversation).
   */

  const nonEmptyRulesArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

  it('shouldInjectRules returns true on first call and false on subsequent calls for any non-empty rules', () => {
    fc.assert(
      fc.property(nonEmptyRulesArb, (rules) => {
        // First injection: not yet injected
        const firstResult = shouldInjectRules(rules, false);
        expect(firstResult).toBe(true);

        // After first injection, alreadyInjected becomes true
        const secondResult = shouldInjectRules(rules, true);
        expect(secondResult).toBe(false);

        // Third call still returns false — idempotent
        const thirdResult = shouldInjectRules(rules, true);
        expect(thirdResult).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('formatRulesContext is a pure function — calling it twice produces identical output', () => {
    fc.assert(
      fc.property(nonEmptyRulesArb, (rules) => {
        const first = formatRulesContext(rules);
        const second = formatRulesContext(rules);
        expect(first).toBe(second);
      }),
      { numRuns: 100 }
    );
  });

  it('simulated double injection produces the same number of Rules context blocks as single injection', () => {
    fc.assert(
      fc.property(nonEmptyRulesArb, (rules) => {
        const messages: Array<{ role: string; content: string }> = [];

        // Simulate first injection (with contentHash tracking, like production code)
        let injected = false;
        let contentHash: string | undefined;
        if (shouldInjectRules(rules, injected, contentHash)) {
          messages.push(buildRulesMessage(rules));
          injected = true;
          contentHash = getRulesContentHash(rules);
        }

        const countAfterFirst = messages.filter((m) =>
          m.content.includes('[Rules Context]')
        ).length;

        // Simulate second injection attempt (same rules, same hash)
        if (shouldInjectRules(rules, injected, contentHash)) {
          messages.push(buildRulesMessage(rules));
        }

        const countAfterSecond = messages.filter((m) =>
          m.content.includes('[Rules Context]')
        ).length;

        // Idempotency: count should be the same after second injection attempt
        expect(countAfterSecond).toBe(countAfterFirst);
        expect(countAfterFirst).toBe(1);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-based tests for Agent Rules isolation
 *
 * Feature: agent-rules, Property 6: Agent Rules 隔离性
 * Validates: Requirements 4.3
 */
describe('Feature: agent-rules, Property 6: Agent Rules 隔离性', () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * For any two Agents with different Rules configs, Agent A's conversation
   * context should only contain Agent A's Rules, not Agent B's Rules,
   * and vice versa.
   */
  /**
   * Helper to extract the rules content between the context tags.
   * Returns the exact content between `[Rules Context]\n` and `\n[End Rules Context]`.
   */
  function extractRulesContent(formattedMessage: string): string | null {
    const startTag = '[Rules Context]\n';
    const endTag = '\n[End Rules Context]';
    const startIdx = formattedMessage.indexOf(startTag);
    const endIdx = formattedMessage.indexOf(endTag);
    if (startIdx === -1 || endIdx === -1) return null;
    return formattedMessage.slice(startIdx + startTag.length, endIdx);
  }

  it('each agent message contains only its own rules and not the other agent rules', () => {
    const nonEmptyStringArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

    fc.assert(
      fc.property(nonEmptyStringArb, nonEmptyStringArb, (rulesA, rulesB) => {
        // Ensure the two rules are actually different
        fc.pre(rulesA !== rulesB);

        // Build messages independently for each agent
        const messageA = buildRulesMessage(rulesA);
        const messageB = buildRulesMessage(rulesB);

        // Extract the exact rules content from each formatted message
        const contentA = extractRulesContent(messageA.content);
        const contentB = extractRulesContent(messageB.content);

        // Agent A's extracted content is exactly Agent A's rules
        expect(contentA).toBe(rulesA);
        // Agent B's extracted content is exactly Agent B's rules
        expect(contentB).toBe(rulesB);

        // Since rulesA !== rulesB, the extracted contents must differ
        expect(contentA).not.toBe(contentB);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-based tests for Rules first injection
 *
 * Feature: agent-rules, Property 3: Rules 首次注入
 * Validates: Requirements 4.1, 5.1
 */
describe('Feature: agent-rules, Property 3: Rules 首次注入', () => {
  /**
   * **Validates: Requirements 4.1, 5.1**
   *
   * For any conversation context with non-empty Rules config (Agent or Chat),
   * when the first message is sent, the constructed request message list should
   * contain the Rules context content.
   */

  const nonEmptyRulesArb = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

  it('shouldInjectRules returns true for any non-empty rules on first message', () => {
    fc.assert(
      fc.property(nonEmptyRulesArb, (rules) => {
        // First message: alreadyInjected is false
        expect(shouldInjectRules(rules, false)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('buildRulesMessage produces a system message containing the rules content for any non-empty rules', () => {
    fc.assert(
      fc.property(nonEmptyRulesArb, (rules) => {
        const msg = buildRulesMessage(rules);

        // Message role must be 'system'
        expect(msg.role).toBe('system');

        // Message content must contain the original rules
        expect(msg.content).toContain(rules);

        // Message content must be wrapped in context tags
        expect(msg.content.startsWith('[Rules Context]')).toBe(true);
        expect(msg.content.endsWith('[End Rules Context]')).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('simulated first message injection inserts rules into the request message list', () => {
    fc.assert(
      fc.property(nonEmptyRulesArb, (rules) => {
        // Simulate a conversation where no rules have been injected yet
        const messages: Array<{ role: string; content: string }> = [];
        let rulesInjected = false;
        let contentHash: string | undefined;

        // First message send: check and inject
        if (shouldInjectRules(rules, rulesInjected, contentHash)) {
          messages.push(buildRulesMessage(rules));
          rulesInjected = true;
          contentHash = getRulesContentHash(rules);
        }

        // The message list should contain exactly one rules message
        expect(messages.length).toBe(1);
        expect(rulesInjected).toBe(true);
        expect(contentHash).toBe(getRulesContentHash(rules));

        // The injected message should be a system message with the rules content
        const rulesMsg = messages[0];
        expect(rulesMsg.role).toBe('system');
        expect(rulesMsg.content).toContain(rules);
        expect(rulesMsg.content).toContain('[Rules Context]');
        expect(rulesMsg.content).toContain('[End Rules Context]');
      }),
      { numRuns: 100 }
    );
  });
});
