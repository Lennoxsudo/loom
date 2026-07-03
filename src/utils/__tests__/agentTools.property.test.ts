/**
 * Property-Based Tests for agentTools
 *
 * Feature: agent-capability-permissions
 *
 * Property 1: normalizeCapabilities 默认值完整性
 * Validates: Requirements 1.2, 8.1
 *
 * Property 2: 工具拦截与能力标志的一致性
 * Validates: Requirements 2.1, 2.2, 3.1, 3.2, 6.1, 6.2, 6.3, 8.3
 *
 * Property 3: MCP 工具前缀拦截
 * Validates: Requirements 4.1, 4.2
 */

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  normalizeCapabilities,
  DEFAULT_AGENT_CAPABILITIES,
  getToolBlockedByCapability,
  BROWSER_TOOLS,
  GIT_TOOLS,
} from '../agentTools';
import type { AgentCapabilities } from '../agentPersistence';

/** All capability field names in AgentCapabilities */
const ALL_CAPABILITY_FIELDS: (keyof AgentCapabilities)[] = [
  'canExecuteCommands',
  'canAccessBrowser',
  'canUseGit',
  'canUseMcp',
];

const EXECUTE_TOOLS = new Set([
  'create_terminal',
  'close_terminal',
  'run_command',
]);

/**
 * Arbitrary that generates a random Partial<AgentCapabilities> object.
 * Each field is independently included or omitted, and when included
 * it takes a random boolean value.
 */
const partialCapabilitiesArb: fc.Arbitrary<Partial<AgentCapabilities>> = fc
  .record(
    {
      canExecuteCommands: fc.boolean(),
      canAccessBrowser: fc.boolean(),
      canUseGit: fc.boolean(),
      canUseMcp: fc.boolean(),
    },
    { requiredKeys: [] }
  );

/**
 * Arbitrary that generates a random complete AgentCapabilities object.
 * Each boolean field is independently randomized.
 */
const fullCapabilitiesArb: fc.Arbitrary<AgentCapabilities> = fc.record({
  canExecuteCommands: fc.boolean(),
  canAccessBrowser: fc.boolean(),
  canUseGit: fc.boolean(),
  canUseMcp: fc.boolean(),
});

// ============================================================================
// Property 1: normalizeCapabilities 默认值完整性
// ============================================================================

describe('Feature: agent-capability-permissions, Property 1: normalizeCapabilities 默认值完整性', () => {
  // Property 1: normalizeCapabilities 默认值完整性
  // Validates: Requirements 1.2, 8.1
  it('should return an object with all six fields present as booleans for any partial input', () => {
    fc.assert(
      fc.property(partialCapabilitiesArb, (partial) => {
        const result = normalizeCapabilities(partial);

        for (const field of ALL_CAPABILITY_FIELDS) {
          expect(result).toHaveProperty(field);
          expect(typeof result[field]).toBe('boolean');
        }
      }),
      { numRuns: 100 }
    );
  });

  // Validates: Requirements 1.2, 8.1
  it('should default missing fields to DEFAULT_AGENT_CAPABILITIES values', () => {
    fc.assert(
      fc.property(partialCapabilitiesArb, (partial) => {
        const result = normalizeCapabilities(partial);

        for (const field of ALL_CAPABILITY_FIELDS) {
          if (partial[field] === undefined) {
            expect(result[field]).toBe(DEFAULT_AGENT_CAPABILITIES[field]);
          } else {
            expect(result[field]).toBe(partial[field]);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Validates: Requirements 1.2, 8.1
  it('should return full defaults for null and undefined inputs', () => {
    const fromNull = normalizeCapabilities(null);
    const fromUndefined = normalizeCapabilities(undefined);

    for (const field of ALL_CAPABILITY_FIELDS) {
      expect(fromNull[field]).toBe(DEFAULT_AGENT_CAPABILITIES[field]);
      expect(fromUndefined[field]).toBe(DEFAULT_AGENT_CAPABILITIES[field]);
    }
  });

  // Validates: Requirements 1.2, 8.1
  it('should return an object with exactly six capability fields', () => {
    fc.assert(
      fc.property(partialCapabilitiesArb, (partial) => {
        const result = normalizeCapabilities(partial);
        const resultKeys = Object.keys(result);

        expect(resultKeys).toHaveLength(ALL_CAPABILITY_FIELDS.length);
        expect(resultKeys.sort()).toEqual([...ALL_CAPABILITY_FIELDS].sort());
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 2: 工具拦截与能力标志的一致性
// ============================================================================

describe('Feature: agent-capability-permissions, Property 2: 工具拦截与能力标志的一致性', () => {
  // Property 2: EXECUTE_TOOLS blocked ⟺ canExecuteCommands === false
  // **Validates: Requirements 8.3**
  it('should block EXECUTE_TOOLS if and only if canExecuteCommands is false', () => {
    const executeToolArb = fc.constantFrom(...EXECUTE_TOOLS);

    fc.assert(
      fc.property(fullCapabilitiesArb, executeToolArb, (caps, tool) => {
        const result = getToolBlockedByCapability(tool, caps);
        if (!caps.canExecuteCommands) {
          expect(result).toBe('execute');
        } else {
          expect(result).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });

  // Property 2: BROWSER_TOOLS blocked ⟺ canAccessBrowser === false
  // **Validates: Requirements 2.1, 2.2**
  it('should block BROWSER_TOOLS if and only if canAccessBrowser is false', () => {
    const browserToolArb = fc.constantFrom(...BROWSER_TOOLS);

    fc.assert(
      fc.property(fullCapabilitiesArb, browserToolArb, (caps, tool) => {
        const result = getToolBlockedByCapability(tool, caps);
        if (!caps.canAccessBrowser) {
          expect(result).toBe('browser');
        } else {
          expect(result).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });

  // Property 2: GIT_TOOLS blocked ⟺ canUseGit === false
  // **Validates: Requirements 3.1, 3.2**
  it('should block GIT_TOOLS if and only if canUseGit is false', () => {
    const gitToolArb = fc.constantFrom(...GIT_TOOLS);

    fc.assert(
      fc.property(fullCapabilitiesArb, gitToolArb, (caps, tool) => {
        const result = getToolBlockedByCapability(tool, caps);
        if (!caps.canUseGit) {
          expect(result).toBe('git');
        } else {
          expect(result).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should not block symbol lookup when canUseGit is false', () => {
    const caps = { canUseGit: false } as const;
    expect(getToolBlockedByCapability('sym', caps)).toBeNull();
    expect(getToolBlockedByCapability('get_symbol_definition', caps)).toBeNull();
  });

});


// ============================================================================
// Property 3: MCP 工具前缀拦截
// ============================================================================

/**
 * Arbitrary that generates a random MCP tool name in the format:
 * mcp_<serverId>__<toolName>
 * where serverId and toolName are non-empty alphanumeric strings.
 */
const mcpToolNameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z0-9]+$/).filter((s) => s.length > 0),
    fc.stringMatching(/^[a-zA-Z0-9]+$/).filter((s) => s.length > 0)
  )
  .map(([serverId, toolName]) => `mcp_${serverId}__${toolName}`);

describe('Feature: agent-capability-permissions, Property 3: MCP 工具前缀拦截', () => {
  // Property 3: MCP 工具前缀拦截
  // **Validates: Requirements 4.1, 4.2**
  it('should return "mcp" block type for any mcp_ prefixed tool when canUseMcp is false', () => {
    fc.assert(
      fc.property(fullCapabilitiesArb, mcpToolNameArb, (caps, tool) => {
        const capsWithMcpDisabled = { ...caps, canUseMcp: false };
        const result = getToolBlockedByCapability(tool, capsWithMcpDisabled);
        expect(result).toBe('mcp');
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.1, 4.2**
  it('should return null (not blocked) for any mcp_ prefixed tool when canUseMcp is true', () => {
    fc.assert(
      fc.property(fullCapabilitiesArb, mcpToolNameArb, (caps, tool) => {
        const capsWithMcpEnabled = { ...caps, canUseMcp: true };
        const result = getToolBlockedByCapability(tool, capsWithMcpEnabled);
        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.1, 4.2**
  it('should block mcp_ tools if and only if canUseMcp is false, for any random capabilities', () => {
    fc.assert(
      fc.property(fullCapabilitiesArb, mcpToolNameArb, (caps, tool) => {
        const result = getToolBlockedByCapability(tool, caps);
        if (!caps.canUseMcp) {
          expect(result).toBe('mcp');
        } else {
          expect(result).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });
});
