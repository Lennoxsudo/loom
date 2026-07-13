import type { ToolDefinition } from '../../types/ai';

export const GRAPH_TOOLS = new Set(['graph_index', 'graph_query', 'graph_trace']);

type DynamicFilterContext = {
  isGitRepo?: boolean;
  hasBrowserCapability?: boolean;
  enableCodeGraph?: boolean;
};

const GIT_TOOLS = new Set(['git', 'get_git_diff', 'undo_changes']);
const BROWSER_TOOLS = new Set(['browser', 'fetch', 'web_search', 'control_browser', 'fetch_web_content']);

export function filterToolsByContext(
  tools: ToolDefinition[],
  context: DynamicFilterContext
): ToolDefinition[] {
  let filtered = tools;

  if (!context.isGitRepo) {
    filtered = filtered.filter((t) => !GIT_TOOLS.has(t.name));
  }

  if (!context.hasBrowserCapability) {
    filtered = filtered.filter((t) => !BROWSER_TOOLS.has(t.name));
  }

  if (context.enableCodeGraph === false) {
    filtered = filtered.filter((t) => !GRAPH_TOOLS.has(t.name));
  }

  return filtered;
}

// ==================== 按对话阶段裁剪 ====================

type MessageWithToolCalls = {
  role: string;
  content: unknown;
  tool_calls?: unknown;
};

/**
 * 从消息历史中提取最近使用过的工具名称。
 *
 * 兼容两种格式：
 * - OpenAI: `assistant.tool_calls[].function.name`
 * - Anthropic: `content[]` 中 `type: 'tool_use'` 的 `name` 字段
 *
 * @param messages 消息数组
 * @param lookbackCount 只检查最近多少条消息（默认 10）
 */
export function extractRecentlyUsedToolNames(
  messages: MessageWithToolCalls[],
  lookbackCount = 10,
): Set<string> {
  const names = new Set<string>();
  const tail = messages.slice(-lookbackCount);

  for (const msg of tail) {
    // OpenAI 格式：assistant.tool_calls
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (typeof tc === 'object' && tc !== null) {
          const func = (tc as Record<string, unknown>).function;
          if (func && typeof func === 'object') {
            const name = (func as Record<string, unknown>).name;
            if (typeof name === 'string' && name.trim()) {
              names.add(name.trim());
            }
          }
        }
      }
    }

    // Anthropic 格式：content 数组中的 tool_use block
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === 'object' && block !== null) {
          const b = block as Record<string, unknown>;
          if (b.type === 'tool_use' && typeof b.name === 'string' && b.name.trim()) {
            names.add(b.name.trim());
          }
        }
      }
    }
  }

  return names;
}

/**
 * 从 provider 格式的工具定义中提取工具名称（用于已转换格式的日志/调试）。
 * 兼容 OpenAI / Anthropic / Gemini 三种格式。
 */
export function extractToolNameFromProviderTool(tool: unknown): string | null {
  if (typeof tool !== 'object' || tool === null) return null;
  const t = tool as Record<string, unknown>;

  // OpenAI: { function: { name: '...' } }
  if (t.function && typeof t.function === 'object') {
    const name = (t.function as Record<string, unknown>).name;
    if (typeof name === 'string') return name;
  }

  // Anthropic: { name: '...' }
  if (typeof t.name === 'string') return t.name;

  // Gemini: { functionDeclarations: [{ name: '...' }] }
  if (Array.isArray(t.functionDeclarations)) {
    const first = t.functionDeclarations[0];
    if (first && typeof first === 'object' && typeof first.name === 'string') {
      return first.name;
    }
  }

  return null;
}
