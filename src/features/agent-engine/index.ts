/**
 * Agent engine public API (formerly `utils/aiTools`).
 *
 * UI hosts should import from `features/agent-engine` and inject host callbacks
 * via {@link ToolContext} / {@link EngineHostCallbacks}. Prefer path containment
 * helpers from `shared/lib/pathUtils`.
 *
 * @module features/agent-engine
 */

export type { ToolCall, ToolResult } from '../../types/ai';
export type { ToolContext, ToolHandler } from './types';
export type { EngineHostCallbacks, AgentEngineEventMap } from './events';
export { agentEngineEvents } from './events';
export { AI_TOOLS } from './definitions';
export {
  parseToolArguments,
  resolvePathWithBaseDir,
  sanitizeMessagesForIpc,
  sanitizeStringForIpc,
} from './argsParser';
export { toAnthropicTools, toOpenAITools } from './converters';
export { executeToolCall, isKnownToolName, getAvailableToolNames } from './toolExecutor';
export { normalizeToolArgs } from './paramNormalizer';
export { filterToolsByContext } from './dynamicToolFilter';
export { resolveUnderlyingToolName } from './toolRouter';
export { findBestToolMatch } from './toolMatcher';
export { getAIToolsWithBrowserConfig, dedupeToolsByName } from './browserConfig';
