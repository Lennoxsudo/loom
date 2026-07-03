import type { ToolCall } from '../../types/ai';
import { finalizeMainStreamToolCalls } from './finalizeMainStreamToolCalls';

export interface StreamCompletionToolResolution {
  toolCalls?: ToolCall[];
  cleanedText?: string;
}

/** 从 provider 格式化后的 tools 列表提取工具名（OpenAI / Anthropic / Gemini） */
export function extractKnownToolNamesFromProviderTools(tools: unknown[]): string[] {
  const names: string[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const record = tool as Record<string, unknown>;
    if (typeof record.name === 'string' && record.name.trim()) {
      names.push(record.name.trim());
      continue;
    }
    const fn = record.function;
    if (fn && typeof fn === 'object') {
      const fnName = (fn as { name?: string }).name;
      if (typeof fnName === 'string' && fnName.trim()) {
        names.push(fnName.trim());
      }
    }
    if (Array.isArray(record.functionDeclarations)) {
      for (const decl of record.functionDeclarations) {
        if (!decl || typeof decl !== 'object') continue;
        const declName = (decl as { name?: string }).name;
        if (typeof declName === 'string' && declName.trim()) {
          names.push(declName.trim());
        }
      }
    }
  }
  return names;
}

/**
 * 解析流式完成后的工具调用。
 */
export function resolveStreamCompletionToolCalls(
  backendToolCalls: ToolCall[] | undefined,
  messageText: string,
  knownToolNames: string[]
): StreamCompletionToolResolution {
  if (backendToolCalls && backendToolCalls.length > 0) {
    return { toolCalls: backendToolCalls };
  }

  const trimmed = messageText.trim();
  if (!trimmed) {
    return {};
  }

  const { toolCalls, cleanedText } = finalizeMainStreamToolCalls(
    messageText,
    backendToolCalls,
    knownToolNames
  );
  if (toolCalls.length > 0) {
    return {
      toolCalls,
      cleanedText,
    };
  }

  return {};
}
