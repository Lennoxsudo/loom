/**
 * Unit tests for useRulesStore
 *
 * Tests core CRUD operations, validation, and persistence calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import type { RulesConfig } from '../../types/rules';

// Mock rulesPersistence
vi.mock('../../utils/rulesPersistence', () => ({
  loadRulesConfig: vi.fn(),
  saveRulesConfig: vi.fn(),
}));

// Mock crypto.randomUUID
const mockUUID = vi.fn(() => 'test-uuid-1234');
vi.stubGlobal('crypto', { randomUUID: mockUUID });

import { useRulesStore } from '../useRulesStore';
import { loadRulesConfig, saveRulesConfig } from '../../utils/rulesPersistence';

const mockedLoad = vi.mocked(loadRulesConfig);
const mockedSave = vi.mocked(saveRulesConfig);

function resetStore() {
  useRulesStore.setState({ chatRules: [], rulesTemplates: [], loaded: false });
}

describe('useRulesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    mockedSave.mockResolvedValue(undefined);
  });

  describe('loadRules', () => {
    it('should load rules from persistence and set loaded flag', async () => {
      const config: RulesConfig = {
        chatRules: [
          {
            id: '1',
            name: 'Rule 1',
            content: 'Content 1',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        rulesTemplates: [
          {
            id: '2',
            name: 'Template 1',
            content: 'Template Content',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      };
      mockedLoad.mockResolvedValue(config);

      await act(async () => {
        await useRulesStore.getState().loadRules();
      });

      const state = useRulesStore.getState();
      expect(state.chatRules).toEqual(config.chatRules);
      expect(state.rulesTemplates).toEqual(config.rulesTemplates);
      expect(state.loaded).toBe(true);
    });
  });

  describe('addChatRule', () => {
    it('should add a chat rule and persist', async () => {
      await act(async () => {
        await useRulesStore.getState().addChatRule('My Rule', 'My Content');
      });

      const state = useRulesStore.getState();
      expect(state.chatRules).toHaveLength(1);
      expect(state.chatRules[0].name).toBe('My Rule');
      expect(state.chatRules[0].content).toBe('My Content');
      expect(state.chatRules[0].id).toBe('test-uuid-1234');
      expect(mockedSave).toHaveBeenCalledTimes(1);
    });

    it('should reject empty name', async () => {
      await expect(useRulesStore.getState().addChatRule('', 'Content')).rejects.toThrow(
        'Name and content must not be empty'
      );
      expect(useRulesStore.getState().chatRules).toHaveLength(0);
      expect(mockedSave).not.toHaveBeenCalled();
    });

    it('should reject whitespace-only content', async () => {
      await expect(useRulesStore.getState().addChatRule('Name', '   ')).rejects.toThrow(
        'Name and content must not be empty'
      );
      expect(useRulesStore.getState().chatRules).toHaveLength(0);
      expect(mockedSave).not.toHaveBeenCalled();
    });
  });

  describe('updateChatRule', () => {
    it('should update an existing chat rule and persist', async () => {
      // Seed a rule
      useRulesStore.setState({
        chatRules: [
          {
            id: 'r1',
            name: 'Old',
            content: 'Old Content',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      });

      await act(async () => {
        await useRulesStore.getState().updateChatRule('r1', 'New', 'New Content');
      });

      const rule = useRulesStore.getState().chatRules[0];
      expect(rule.name).toBe('New');
      expect(rule.content).toBe('New Content');
      expect(rule.createdAt).toBe('2024-01-01T00:00:00.000Z'); // unchanged
      expect(rule.updatedAt).not.toBe('2024-01-01T00:00:00.000Z'); // updated
      expect(mockedSave).toHaveBeenCalledTimes(1);
    });

    it('should reject empty name on update', async () => {
      useRulesStore.setState({
        chatRules: [
          {
            id: 'r1',
            name: 'Old',
            content: 'Old Content',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      });

      await expect(useRulesStore.getState().updateChatRule('r1', '  ', 'Content')).rejects.toThrow(
        'Name and content must not be empty'
      );
      expect(mockedSave).not.toHaveBeenCalled();
    });
  });

  describe('deleteChatRule', () => {
    it('should remove a chat rule and persist', async () => {
      useRulesStore.setState({
        chatRules: [
          {
            id: 'r1',
            name: 'Rule 1',
            content: 'C1',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'r2',
            name: 'Rule 2',
            content: 'C2',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      });

      await act(async () => {
        await useRulesStore.getState().deleteChatRule('r1');
      });

      const state = useRulesStore.getState();
      expect(state.chatRules).toHaveLength(1);
      expect(state.chatRules[0].id).toBe('r2');
      expect(mockedSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('addTemplate', () => {
    it('should add a template and persist', async () => {
      await act(async () => {
        await useRulesStore.getState().addTemplate('Tmpl', 'Tmpl Content');
      });

      const state = useRulesStore.getState();
      expect(state.rulesTemplates).toHaveLength(1);
      expect(state.rulesTemplates[0].name).toBe('Tmpl');
      expect(mockedSave).toHaveBeenCalledTimes(1);
    });

    it('should reject empty content', async () => {
      await expect(useRulesStore.getState().addTemplate('Name', '')).rejects.toThrow(
        'Name and content must not be empty'
      );
      expect(useRulesStore.getState().rulesTemplates).toHaveLength(0);
    });
  });

  describe('updateTemplate', () => {
    it('should update an existing template and persist', async () => {
      useRulesStore.setState({
        rulesTemplates: [
          {
            id: 't1',
            name: 'Old Tmpl',
            content: 'Old',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      });

      await act(async () => {
        await useRulesStore.getState().updateTemplate('t1', 'New Tmpl', 'New');
      });

      const tmpl = useRulesStore.getState().rulesTemplates[0];
      expect(tmpl.name).toBe('New Tmpl');
      expect(tmpl.content).toBe('New');
      expect(mockedSave).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteTemplate', () => {
    it('should remove a template and persist', async () => {
      useRulesStore.setState({
        rulesTemplates: [
          {
            id: 't1',
            name: 'T1',
            content: 'C1',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      });

      await act(async () => {
        await useRulesStore.getState().deleteTemplate('t1');
      });

      expect(useRulesStore.getState().rulesTemplates).toHaveLength(0);
      expect(mockedSave).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Property-based tests for useRulesStore input validation
 *
 * Feature: agent-rules, Property 8: 空输入验证拒绝
 * Validates: Requirements 2.7
 */
import fc from 'fast-check';

/**
 * Arbitrary generator for empty or whitespace-only strings.
 * Produces: empty string, spaces, tabs, newlines, and combinations.
 */
const emptyOrWhitespaceArb = fc.oneof(
  fc.constant(''),
  fc
    .array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 20 })
    .map((arr) => arr.join(''))
);

/** Arbitrary for a non-empty, non-whitespace string (valid input). */
const validStringArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

describe('Feature: agent-rules, Property 8: 空输入验证拒绝', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    mockedSave.mockResolvedValue(undefined);
  });

  /**
   * **Validates: Requirements 2.7**
   *
   * For any name or content that is empty string or whitespace-only,
   * the Rules_Manager should reject the submission, and the store's
   * Rules list should remain unchanged.
   */
  it('addChatRule rejects when name is empty/whitespace', async () => {
    await fc.assert(
      fc.asyncProperty(emptyOrWhitespaceArb, validStringArb, async (emptyName, validContent) => {
        resetStore();
        vi.clearAllMocks();

        const before = useRulesStore.getState().chatRules.length;
        await expect(useRulesStore.getState().addChatRule(emptyName, validContent)).rejects.toThrow(
          'Name and content must not be empty'
        );

        expect(useRulesStore.getState().chatRules.length).toBe(before);
        expect(mockedSave).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('addChatRule rejects when content is empty/whitespace', async () => {
    await fc.assert(
      fc.asyncProperty(validStringArb, emptyOrWhitespaceArb, async (validName, emptyContent) => {
        resetStore();
        vi.clearAllMocks();

        const before = useRulesStore.getState().chatRules.length;
        await expect(useRulesStore.getState().addChatRule(validName, emptyContent)).rejects.toThrow(
          'Name and content must not be empty'
        );

        expect(useRulesStore.getState().chatRules.length).toBe(before);
        expect(mockedSave).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('addTemplate rejects when name is empty/whitespace', async () => {
    await fc.assert(
      fc.asyncProperty(emptyOrWhitespaceArb, validStringArb, async (emptyName, validContent) => {
        resetStore();
        vi.clearAllMocks();

        const before = useRulesStore.getState().rulesTemplates.length;
        await expect(useRulesStore.getState().addTemplate(emptyName, validContent)).rejects.toThrow(
          'Name and content must not be empty'
        );

        expect(useRulesStore.getState().rulesTemplates.length).toBe(before);
        expect(mockedSave).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('addTemplate rejects when content is empty/whitespace', async () => {
    await fc.assert(
      fc.asyncProperty(validStringArb, emptyOrWhitespaceArb, async (validName, emptyContent) => {
        resetStore();
        vi.clearAllMocks();

        const before = useRulesStore.getState().rulesTemplates.length;
        await expect(useRulesStore.getState().addTemplate(validName, emptyContent)).rejects.toThrow(
          'Name and content must not be empty'
        );

        expect(useRulesStore.getState().rulesTemplates.length).toBe(before);
        expect(mockedSave).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('updateChatRule rejects when name is empty/whitespace and state unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(emptyOrWhitespaceArb, validStringArb, async (emptyName, validContent) => {
        const seedRule = {
          id: 'r1',
          name: 'Original',
          content: 'Original Content',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        };
        useRulesStore.setState({ chatRules: [seedRule], rulesTemplates: [], loaded: true });
        vi.clearAllMocks();

        await expect(
          useRulesStore.getState().updateChatRule('r1', emptyName, validContent)
        ).rejects.toThrow('Name and content must not be empty');

        const rule = useRulesStore.getState().chatRules[0];
        expect(rule.name).toBe('Original');
        expect(rule.content).toBe('Original Content');
        expect(mockedSave).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('updateTemplate rejects when content is empty/whitespace and state unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(validStringArb, emptyOrWhitespaceArb, async (validName, emptyContent) => {
        const seedTemplate = {
          id: 't1',
          name: 'Original Tmpl',
          content: 'Original Tmpl Content',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        };
        useRulesStore.setState({ chatRules: [], rulesTemplates: [seedTemplate], loaded: true });
        vi.clearAllMocks();

        await expect(
          useRulesStore.getState().updateTemplate('t1', validName, emptyContent)
        ).rejects.toThrow('Name and content must not be empty');

        const tmpl = useRulesStore.getState().rulesTemplates[0];
        expect(tmpl.name).toBe('Original Tmpl');
        expect(tmpl.content).toBe('Original Tmpl Content');
        expect(mockedSave).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-based tests for useRulesStore delete operations
 *
 * Feature: agent-rules, Property 9: 删除操作移除 Rule
 * Validates: Requirements 2.6
 */

/** Arbitrary generator for a valid RuleItem. */
const ruleItemArb = fc.record({
  id: fc.uuid(),
  name: validStringArb,
  content: validStringArb,
  createdAt: fc.constant('2024-01-01T00:00:00.000Z'),
  updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
});

/**
 * Arbitrary that produces a non-empty array of RuleItems with unique ids,
 * paired with a valid index into that array.
 */
const rulesWithIndexArb = fc.array(ruleItemArb, { minLength: 1, maxLength: 20 }).chain((rules) => {
  // Ensure unique ids by appending index suffix
  const uniqueRules = rules.map((r, i) => ({ ...r, id: `${r.id}-${i}` }));
  return fc.tuple(fc.constant(uniqueRules), fc.integer({ min: 0, max: uniqueRules.length - 1 }));
});

describe('Feature: agent-rules, Property 9: 删除操作移除 Rule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    mockedSave.mockResolvedValue(undefined);
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * For any Rule that exists in the store, after executing a delete operation,
   * that Rule's id should no longer appear in the store's Rules list,
   * and the list length should decrease by 1.
   */
  it('deleteChatRule removes the rule and decreases list length by 1', async () => {
    await fc.assert(
      fc.asyncProperty(rulesWithIndexArb, async ([rules, index]) => {
        resetStore();
        vi.clearAllMocks();
        mockedSave.mockResolvedValue(undefined);

        useRulesStore.setState({ chatRules: [...rules], rulesTemplates: [], loaded: true });

        const targetId = rules[index].id;
        const lengthBefore = rules.length;

        await useRulesStore.getState().deleteChatRule(targetId);

        const after = useRulesStore.getState().chatRules;

        // The deleted rule's id no longer appears in the list
        expect(after.find((r) => r.id === targetId)).toBeUndefined();
        // The list length decreased by exactly 1
        expect(after.length).toBe(lengthBefore - 1);
        // saveRulesConfig was called
        expect(mockedSave).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 }
    );
  });

  it('deleteTemplate removes the template and decreases list length by 1', async () => {
    await fc.assert(
      fc.asyncProperty(rulesWithIndexArb, async ([templates, index]) => {
        resetStore();
        vi.clearAllMocks();
        mockedSave.mockResolvedValue(undefined);

        useRulesStore.setState({ chatRules: [], rulesTemplates: [...templates], loaded: true });

        const targetId = templates[index].id;
        const lengthBefore = templates.length;

        await useRulesStore.getState().deleteTemplate(targetId);

        const after = useRulesStore.getState().rulesTemplates;

        // The deleted template's id no longer appears in the list
        expect(after.find((r) => r.id === targetId)).toBeUndefined();
        // The list length decreased by exactly 1
        expect(after.length).toBe(lengthBefore - 1);
        // saveRulesConfig was called
        expect(mockedSave).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 }
    );
  });
});
