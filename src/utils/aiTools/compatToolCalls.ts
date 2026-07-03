import type { ToolCall } from '../../types/ai';
import { resolveToolInvocation } from './pseudoToolExtractor';

interface CompatExtractResult {
  toolCalls: ToolCall[];
  cleanedContent: string;
}

interface TextRange {
  start: number;
  end: number;
}

const MARKDOWN_FENCE_REGEX = /```(?:json)?\s*\n?([\s\S]*?)\n?```/gi;

/** 检测正文是否仍含疑似伪工具调用 JSON（用于自纠偏，不执行工具） */
export function looksLikePseudoToolCall(text: string): boolean {
  if (!text || !text.trim()) {
    return false;
  }
  const hasNameField = /"(?:name|tool)"\s*:\s*"(?:[^"\\]|\\.)+"/.test(text);
  const hasArgsField = /"(?:arguments|args)"\s*:\s*\{/.test(text);
  if (hasNameField && hasArgsField) {
    return true;
  }
  return /```(?:json)?\s*[\s\S]*?"(?:name|tool)"\s*:/i.test(text);
}

function rangesOverlap(a: TextRange, b: TextRange): boolean {
  return a.start < b.end && a.end > b.start;
}

function rangeOverlapsAny(range: TextRange, ranges: TextRange[]): boolean {
  return ranges.some((existing) => rangesOverlap(range, existing));
}

function parseToolJsonObject(
  value: unknown
): { name: string; args: Record<string, unknown> } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const parsed = value as Record<string, unknown>;
  const rawName = parsed.name ?? parsed.tool;
  if (typeof rawName !== 'string' || !rawName.trim()) {
    return null;
  }
  const rawArgs = parsed.arguments ?? parsed.args;
  const args =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  return { name: rawName.trim(), args };
}

function pushResolvedToolCall(
  toolCalls: ToolCall[],
  ranges: TextRange[],
  rawName: string,
  args: Record<string, unknown>,
  knownToolNames: string[],
  range: TextRange
): boolean {
  const resolved = resolveToolInvocation(rawName, args, knownToolNames);
  if (!resolved) {
    return false;
  }
  toolCalls.push({
    id: `compat-${resolved.name}-${Date.now()}-${toolCalls.length}`,
    type: 'function',
    function: {
      name: resolved.name,
      arguments: JSON.stringify(resolved.args),
    },
  });
  ranges.push(range);
  return true;
}

function tryExtractToolJsonObject(
  jsonText: string,
  toolCalls: ToolCall[],
  ranges: TextRange[],
  knownToolNames: string[],
  range: TextRange
): boolean {
  try {
    const parsed = JSON.parse(jsonText);
    const invocation = parseToolJsonObject(parsed);
    if (!invocation) {
      return false;
    }
    return pushResolvedToolCall(
      toolCalls,
      ranges,
      invocation.name,
      invocation.args,
      knownToolNames,
      range
    );
  } catch {
    return false;
  }
}

/** 在正文中按花括号平衡扫描 {"name"|"tool", "arguments"|"args"} 结构 */
function extractInlineToolJsonObjects(
  content: string,
  toolCalls: ToolCall[],
  ranges: TextRange[],
  knownToolNames: string[]
): void {
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '{') {
      continue;
    }

    let depth = 0;
    let end = -1;
    for (let j = i; j < content.length; j++) {
      const ch = content[j];
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    if (end === -1) {
      continue;
    }

    const candidate = content.slice(i, end + 1);
    const range: TextRange = { start: i, end: end + 1 };
    if (rangeOverlapsAny(range, ranges)) {
      continue;
    }

    tryExtractToolJsonObject(candidate, toolCalls, ranges, knownToolNames, range);
  }
}

/**
 * Extract tool calls from assistant text when the provider returns JSON in content
 * instead of native tool_calls (common with some OpenAI-compatible relays).
 */
export function extractCompatToolCallsFromContent(
  content: string,
  knownToolNames: string[]
): CompatExtractResult {
  if (!content || typeof content !== 'string') {
    return { toolCalls: [], cleanedContent: content || '' };
  }

  const toolCalls: ToolCall[] = [];
  const ranges: TextRange[] = [];
  const trimmed = content.trim();

  if (trimmed.startsWith('{')) {
    const start = content.indexOf(trimmed);
    const range: TextRange = { start, end: start + trimmed.length };
    if (tryExtractToolJsonObject(trimmed, toolCalls, ranges, knownToolNames, range)) {
      return { toolCalls, cleanedContent: '' };
    }
  }

  let fenceMatch: RegExpExecArray | null;
  const fenceRegex = new RegExp(MARKDOWN_FENCE_REGEX.source, MARKDOWN_FENCE_REGEX.flags);
  while ((fenceMatch = fenceRegex.exec(content)) != null) {
    const range: TextRange = {
      start: fenceMatch.index,
      end: fenceMatch.index + fenceMatch[0].length,
    };
    if (rangeOverlapsAny(range, ranges)) {
      continue;
    }
    const inner = fenceMatch[1].trim();
    if (!inner) {
      continue;
    }
    tryExtractToolJsonObject(inner, toolCalls, ranges, knownToolNames, range);
  }

  const multilineRegex =
    /(?:^|\n)\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\r?\n+\s*(\{[\s\S]*?\})\s*(?=\r?\n(?:\r?\n|$)|\r?\n[a-zA-Z_][a-zA-Z0-9_]*\s*\r?\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = multilineRegex.exec(content)) != null) {
    try {
      const parsed = JSON.parse(match[2].trim());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }
      const blockStart = match.index + (match[0].startsWith('\n') ? 1 : 0);
      const blockEnd = match.index + match[0].length;
      const range: TextRange = { start: blockStart, end: blockEnd };
      if (rangeOverlapsAny(range, ranges)) {
        continue;
      }
      pushResolvedToolCall(
        toolCalls,
        ranges,
        match[1].trim(),
        parsed as Record<string, unknown>,
        knownToolNames,
        range
      );
    } catch {
      // ignore invalid JSON block
    }
  }

  extractInlineToolJsonObjects(content, toolCalls, ranges, knownToolNames);

  let cleaned = content;
  ranges.sort((a, b) => a.start - b.start);
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i];
    cleaned = cleaned.slice(0, range.start) + cleaned.slice(range.end);
  }
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return { toolCalls, cleanedContent: cleaned };
}

function parseToolCallArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function normalizeToolCallsForSubagent(
  toolCalls: ToolCall[],
  knownToolNames: string[]
): ToolCall[] {
  const normalized: ToolCall[] = [];
  for (const toolCall of toolCalls) {
    const args = parseToolCallArgs(toolCall.function.arguments);
    const resolved = resolveToolInvocation(toolCall.function.name, args, knownToolNames);
    if (!resolved) {
      continue;
    }
    normalized.push({
      ...toolCall,
      function: {
        ...toolCall.function,
        name: resolved.name,
        arguments: JSON.stringify(resolved.args),
      },
    });
  }
  return normalized;
}
