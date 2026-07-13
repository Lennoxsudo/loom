/**
 * 伪工具调用提取器
 *
 * 从 AI 返回的文本内容中提取模型以非标准格式（XML 或 [Tool:...]）生成的工具调用。
 * 主要用于兼容某些中转 API 或旧版模型，它们在 content 中输出工具调用标记
 * 而不是使用标准的 tool_calls / function_call 字段。
 */

import type { ToolCall } from '../../types/ai';
import { mapClaudeToolName } from '../../utils/subagents/toolMapping';
import { findBestToolMatch } from './toolMatcher';

interface ExtractResult {
  toolCalls: ToolCall[];
  cleanedContent: string;
}

/**
 * 从 content 中提取所有伪工具调用，并返回清理后的内容。
 *
 * 支持格式：
 * 1. [Tool: name(args)]  -- ChatPanel 兼容格式
 * 2. 
 * 3. <function_calls><invoke name="..."><parameter name="...">value</parameter></invoke></function_calls>
 * 4. <function name="..."><parameter name="...">value</parameter></function>
 * 5. <function><name>...</name><arguments>{...}</arguments></function>
 *
 * @param content - 原始 AI 输出文本
 * @param knownToolNames - 已注册工具名称列表，用于验证/修正。空数组表示不验证。
 */
export function extractPseudoToolCallsFromContent(
  content: string,
  knownToolNames: string[]
): ExtractResult {
  if (!content || typeof content !== 'string') {
    return { toolCalls: [], cleanedContent: content || '' };
  }

  const toolCalls: ToolCall[] = [];
  let cleaned = content;

  // 为减少多次替换的相互影响，先收集所有匹配区间，再统一移除
  const ranges: Array<{ start: number; end: number }> = [];

  // -- 1. [Tool:...] 格式 --
  const bracketRegex = /\[Tool:\s*([a-zA-Z0-9_]+)(?:\s*\(([^)]*)\))?\]\s*\n?/g;
  {
    let match: RegExpExecArray | null;
    const tempContent = content;
    while ((match = bracketRegex.exec(tempContent)) != null) {
      let name = match[1];
      const idHint = (match[2] || '').trim();

      const startIndex = bracketRegex.lastIndex;
      const nextMatch = bracketRegex.exec(tempContent);
      const endIndex = nextMatch ? nextMatch.index : tempContent.length;

      const slice = tempContent.slice(startIndex, endIndex).trim();
      let args: Record<string, unknown> = {};
      if (slice) {
        const firstBrace = slice.indexOf('{');
        const lastBrace = slice.lastIndexOf('}');
        const jsonCandidate =
          firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace
            ? slice.slice(firstBrace, lastBrace + 1)
            : slice;
        try {
          const parsed = JSON.parse(jsonCandidate);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          args = {};
        }
      }

      if (knownToolNames.length > 0) {
        const resolved = resolvePseudoToolInvocation(name, args, knownToolNames);
        if (!resolved) {
          continue;
        }
        name = resolved.name;
        args = resolved.args;
      }

      const id =
        idHint && !idHint.includes(' ')
          ? idHint
          : `pseudo-${name}-${Date.now()}-${toolCalls.length}`;
      toolCalls.push({
        id,
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(args),
        },
      });

      ranges.push({ start: match.index, end: endIndex });
      if (nextMatch) {
        bracketRegex.lastIndex = nextMatch.index;
      }
    }
  }

  // -- 2. XML 格式 --
  // 2a. 
  extractXmlBlocks(content, /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/g, knownToolNames, toolCalls, ranges);
  // 2b. <function_calls>...</function_calls>
  extractXmlBlocks(content, /<function_calls\b[^>]*>([\s\S]*?)<\/function_calls>/g, knownToolNames, toolCalls, ranges);
  // 2c. 独立 <function>...</function>（如果前面未覆盖）
  extractXmlBlocks(content, /<function\b[^>]*>([\s\S]*?)<\/function>/g, knownToolNames, toolCalls, ranges);
  // 3. tool_name + JSON 块（常见于部分模型纯文本输出）
  extractMultilineToolCalls(content, knownToolNames, toolCalls, ranges);

  // 按区间位置排序，然后倒序移除，避免下标漂移
  ranges.sort((a, b) => a.start - b.start);
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    cleaned = cleaned.slice(0, r.start) + cleaned.slice(r.end);
  }

  // 清理残留的多余空行
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return { toolCalls, cleanedContent: cleaned };
}

/**
 * 提取 XML 块中的工具调用
 */
function extractXmlBlocks(
  content: string,
  blockRegex: RegExp,
  knownToolNames: string[],
  toolCalls: ToolCall[],
  ranges: Array<{ start: number; end: number }>
): void {
  let match: RegExpExecArray | null;
  // 使用副本避免修改全局 lastIndex 导致外层循环混乱
  const regex = new RegExp(blockRegex.source, blockRegex.flags);

  while ((match = regex.exec(content)) != null) {
    const blockStart = match.index;
    const blockEnd = match.index + match[0].length;
    const inner = match[1] || '';

    // 尝试解析 function 名称和参数
    const parsed = parseXmlFunctionBlock(inner, knownToolNames);
    if (!parsed) continue;

    const id = `pseudo-${parsed.name}-${Date.now()}-${toolCalls.length}`;
    toolCalls.push({
      id,
      type: 'function',
      function: {
        name: parsed.name,
        arguments: JSON.stringify(parsed.args),
      },
    });

    ranges.push({ start: blockStart, end: blockEnd });
  }
}

/**
 * 解析 XML function 块内部，提取工具名和参数
 */
function expandPseudoToolAlias(
  name: string,
  args: Record<string, unknown>,
  knownToolNames: string[]
): { name: string; args: Record<string, unknown> } | null {
  const lower = name.toLowerCase();

  if (
    (lower === 'list_directory' || lower === 'list_dir' || lower === 'ls') &&
    knownToolNames.includes('finfo')
  ) {
    return {
      name: 'finfo',
      args: { action: 'list', path: args.path, dirs_only: args.dirs_only },
    };
  }

  if (
    (lower === 'get_file_tree' || lower === 'file_tree') &&
    knownToolNames.includes('finfo')
  ) {
    return {
      name: 'finfo',
      args: {
        action: 'tree',
        path: args.path ?? args.root_path,
        root_path: args.root_path ?? args.path,
        depth: args.depth ?? args.max_depth,
        dirs_only: args.dirs_only,
      },
    };
  }

  if (
    (lower === 'get_file_info' || lower === 'stat') &&
    knownToolNames.includes('finfo')
  ) {
    return {
      name: 'finfo',
      args: { action: 'info', path: args.path ?? args.file_path },
    };
  }

  if ((lower === 'read_file' || lower === 'view_file') && knownToolNames.includes('read')) {
    return { name: 'read', args };
  }

  if (lower === 'glob' && knownToolNames.includes('search')) {
    return {
      name: 'search',
      args: {
        type: 'files',
        pattern: args.pattern ?? args.query ?? '*',
        dir: args.dir ?? args.path ?? args.folder_path,
      },
    };
  }

  if (lower === 'grep' && knownToolNames.includes('search')) {
    return {
      name: 'search',
      args: {
        type: 'content',
        query: args.query ?? args.pattern,
        dir: args.dir ?? args.path ?? args.folder_path,
      },
    };
  }

  return null;
}

export function resolveToolInvocation(
  rawName: string,
  args: Record<string, unknown>,
  knownToolNames: string[]
): { name: string; args: Record<string, unknown> } | null {
  return resolvePseudoToolInvocation(rawName, args, knownToolNames);
}

function resolvePseudoToolInvocation(
  rawName: string,
  args: Record<string, unknown>,
  knownToolNames: string[]
): { name: string; args: Record<string, unknown> } | null {
  let name = mapClaudeToolName(rawName);
  if (name === rawName) {
    const capitalized = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    name = mapClaudeToolName(capitalized);
  }

  if (knownToolNames.length === 0 || knownToolNames.includes(name)) {
    return { name, args };
  }

  const alias = expandPseudoToolAlias(name, args, knownToolNames);
  if (alias) {
    return alias;
  }

  const best = findBestToolMatch(name, knownToolNames);
  if (best) {
    return { name: best, args };
  }

  return null;
}

function extractMultilineToolCalls(
  content: string,
  knownToolNames: string[],
  toolCalls: ToolCall[],
  ranges: Array<{ start: number; end: number }>
): void {
  const regex =
    /(?:^|\n)\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\r?\n+\s*(\{[\s\S]*?\})\s*(?=\r?\n(?:\r?\n|$)|\r?\n[a-zA-Z_][a-zA-Z0-9_]*\s*\r?\n|$)/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) != null) {
    const rawName = match[1].trim();
    const jsonText = match[2].trim();
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }

    const resolved = resolvePseudoToolInvocation(rawName, args, knownToolNames);
    if (!resolved) continue;

    const blockStart = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const blockEnd = match.index + match[0].length;

    toolCalls.push({
      id: `pseudo-${resolved.name}-${Date.now()}-${toolCalls.length}`,
      type: 'function',
      function: {
        name: resolved.name,
        arguments: JSON.stringify(resolved.args),
      },
    });
    ranges.push({ start: blockStart, end: blockEnd });
  }
}

function parseXmlFunctionBlock(
  inner: string,
  knownToolNames: string[]
): { name: string; args: Record<string, unknown> } | null {
  const trimmedInner = inner.trim();

  // {"name":"read","arguments":{...}}
  if (trimmedInner.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmedInner) as {
        name?: string;
        tool?: string;
        arguments?: Record<string, unknown>;
        args?: Record<string, unknown>;
      };
      const rawName = parsed.name || parsed.tool;
      if (rawName && typeof rawName === 'string') {
        const args =
          parsed.arguments && typeof parsed.arguments === 'object'
            ? parsed.arguments
            : parsed.args && typeof parsed.args === 'object'
              ? parsed.args
              : {};
        return resolvePseudoToolInvocation(rawName.trim(), args, knownToolNames);
      }
    } catch {
      // fall through to XML parsing
    }
  }

  // tool_name\n{...} 内嵌在 XML 块中
  const multilineInBlock = /^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\r?\n+\s*(\{[\s\S]*\})\s*$/;
  const multilineMatch = trimmedInner.match(multilineInBlock);
  if (multilineMatch) {
    try {
      const parsedArgs = JSON.parse(multilineMatch[2].trim());
      if (parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)) {
        const resolved = resolvePseudoToolInvocation(
          multilineMatch[1].trim(),
          parsedArgs as Record<string, unknown>,
          knownToolNames
        );
        if (resolved) {
          return resolved;
        }
      }
    } catch {
      // fall through
    }
  }

  // 尝试提取函数名
  let name: string | null = null;

  // <function name="xxx">
  const fnNameAttr = inner.match(/<function\b[^>]*?\s+name\s*=\s*["']([^"']+)["']/);
  if (fnNameAttr) {
    name = fnNameAttr[1].trim();
  }

  // <function=bash>
  if (!name) {
    const fnEqualsAttr = inner.match(/<function\s*=\s*([^>\s/]+)/);
    if (fnEqualsAttr) {
      name = fnEqualsAttr[1].trim();
    }
  }

  // <invoke name="xxx">
  if (!name) {
    const invokeNameAttr = inner.match(/<invoke\b[^>]*?\s+name\s*=\s*["']([^"']+)["']/);
    if (invokeNameAttr) {
      name = invokeNameAttr[1].trim();
    }
  }

  // <function><name>xxx</name>
  if (!name) {
    const nameTag = inner.match(/<name\b[^>]*>([^<]*)<\/name>/);
    if (nameTag) {
      name = nameTag[1].trim();
    }
  }

  if (!name) return null;

  const args: Record<string, unknown> = {};

  const paramRegex = /<parameter\b[^>]*?\s+name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/parameter>/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = paramRegex.exec(inner)) != null) {
    const key = pMatch[1].trim();
    const rawValue = pMatch[2].trim();
    args[key] = parseParamValue(rawValue);
  }

  const paramEqualsRegex = /<parameter\s*=\s*([^>\s/]+)[^>]*>([\s\S]*?)<\/parameter>/g;
  let peMatch: RegExpExecArray | null;
  while ((peMatch = paramEqualsRegex.exec(inner)) != null) {
    const key = peMatch[1].trim();
    const rawValue = peMatch[2].trim();
    args[key] = parseParamValue(rawValue);
  }

  const argRegex = /<arg\b[^>]*?\s+name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/arg>/g;
  let aMatch: RegExpExecArray | null;
  while ((aMatch = argRegex.exec(inner)) != null) {
    const key = aMatch[1].trim();
    const rawValue = aMatch[2].trim();
    args[key] = parseParamValue(rawValue);
  }

  const argsJsonMatch = inner.match(/<(?:arguments|args)\b[^>]*>([\s\S]*?)<\/(?:arguments|args)>/);
  if (argsJsonMatch) {
    try {
      const parsed = JSON.parse(argsJsonMatch[1].trim());
      if (parsed && typeof parsed === 'object') {
        Object.assign(args, parsed);
      }
    } catch {
      // ignore
    }
  }

  if (Object.keys(args).length === 0) {
    const jsonMatch = inner.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed && typeof parsed === 'object') {
          Object.assign(args, parsed);
        }
      } catch {
        // ignore
      }
    }
  }

  const resolved = resolvePseudoToolInvocation(name, args, knownToolNames);
  if (!resolved) return null;

  return resolved;
}

function parseParamValue(raw: string): unknown {
  // 尝试 JSON 解析（数字、布尔、数组、对象）
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    // 不是 JSON，返回原始字符串
    return raw;
  }
}
