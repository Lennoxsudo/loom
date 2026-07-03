/**
 * 上下文压缩模块
 *
 * 将即将被裁剪掉的旧消息压缩为一条结构化摘要，
 * 替代当前 `[Earlier messages were truncated]` 的零信息占位。
 *
 * 策略：规则式提取，不调 AI，零延迟。
 * 从消息中提取：用户意图、工具调用摘要、文件变更列表、关键结论。
 *
 * @module contextCompressor
 */

import { estimateTokens, estimateMessageTokens } from './contextBudget';

// ==================== 类型 ====================

/** 消息的通用类型（与 contextBudget.ts 保持一致） */
type MessageLike = { role: string; content: unknown };

export interface CompressedSummary {
  /** 摘要唯一标识 */
  id: string;
  /** 摘要覆盖的消息索引范围（原始消息数组中的 from..to） */
  coverFromIndex: number;
  coverToIndex: number;
  /** 摘要文本 */
  summary: string;
  /** 创建时间 */
  createdAt: number;
  /** 原始消息总 token 数 */
  originalTokens: number;
  /** 摘要 token 数 */
  summaryTokens: number;
}

interface CompressResult {
  /** 压缩后的消息数组（摘要替代被移除的消息） */
  messages: MessageLike[];
  /** 是否执行了压缩 */
  compressed: boolean;
  /** 生成的摘要（如有） */
  summary: CompressedSummary | null;
  /** 压缩前 token 数 */
  originalTokens: number;
  /** 压缩后 token 数 */
  compressedTokens: number;
}

// ==================== 常量 ====================

/** 摘要硬上限 token 数 */
const SUMMARY_TOKEN_BUDGET = 1500;

/** 摘要硬上限字符数（兜底） */
const SUMMARY_CHAR_BUDGET = 6000;

// ==================== 提取逻辑 ====================

/**
 * 从一条消息中提取结构化信息片段
 */
function extractMessageFragments(
  msg: MessageLike & Record<string, unknown>
): { userIntents: string[]; toolCalls: string[]; fileChanges: string[]; conclusions: string[] } {
  const result = { userIntents: [] as string[], toolCalls: [] as string[], fileChanges: [] as string[], conclusions: [] as string[] };
  const content = msg.content;

  if (msg.role === 'user') {
    const text = extractText(content);
    if (text) {
      result.userIntents.push(text.slice(0, 120));
    }
  }

  if (msg.role === 'assistant') {
    const text = extractText(content);

    // 提取工具调用信息
    const toolCallsMatch = msg.tool_calls;
    if (Array.isArray(toolCallsMatch)) {
      for (const tc of toolCallsMatch) {
        const func = (tc as Record<string, unknown>)?.function;
        if (func && typeof func === 'object') {
          const name = (func as Record<string, unknown>).name;
          if (typeof name === 'string') {
            result.toolCalls.push(name);
          }
        }
      }
    }

    // 提取文件变更信息（从输出文本中匹配路径）
    if (text) {
      const filePatterns = [
        /(?:wrote|written|created|saved|modified|edited|updated)\s+(?:to\s+)?[`"']?([^\s'"`\n,]+\.\w+)/gi,
        /(?:file|path)\s*[:：]\s*[`"']?([^\s'"`\n,]+\.\w+)/gi,
      ];
      for (const pattern of filePatterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
          const filePath = match[1];
          if (filePath && filePath.length > 2 && filePath.length < 260) {
            result.fileChanges.push(filePath);
          }
        }
      }

      // assistant 结论取尾 80 字
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        result.conclusions.push(trimmed.slice(-80));
      }
    }
  }

  if (msg.role === 'tool') {
    const text = extractText(content);
    if (text) {
      // 工具结果中提取文件路径
      const fileLinePattern = /^([^\s\n:]+\.\w+)$/gm;
      let match: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((match = fileLinePattern.exec(text)) !== null) {
        const p = match[1];
        if (p && p.length > 2 && p.length < 260 && !seen.has(p)) {
          seen.add(p);
          result.fileChanges.push(p);
        }
      }
    }
  }

  return result;
}

/**
 * 从 content 字段提取纯文本
 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          parts.push(b.text);
        } else if (b.type === 'tool_result' && typeof b.content === 'string') {
          parts.push(b.content);
        }
      }
    }
    return parts.join('\n');
  }
  if (content != null) {
    try {
      return JSON.stringify(content);
    } catch {
      return '';
    }
  }
  return '';
}

// ==================== 摘要构建 ====================

/**
 * 将一批消息压缩为一条结构化摘要（规则式，无 LLM）
 */
export function buildRuleBasedSummary(
  messages: MessageLike[],
  coverFromIndex: number,
  coverToIndex: number
): CompressedSummary {
  const fragments = {
    userIntents: [] as string[],
    toolCalls: [] as string[],
    fileChanges: [] as string[],
    conclusions: [] as string[],
  };

  let originalTokens = 0;

  for (const msg of messages) {
    originalTokens += estimateMessageTokens(msg);
    const frag = extractMessageFragments(msg as MessageLike & Record<string, unknown>);
    fragments.userIntents.push(...frag.userIntents);
    fragments.toolCalls.push(...frag.toolCalls);
    fragments.fileChanges.push(...frag.fileChanges);
    fragments.conclusions.push(...frag.conclusions);
  }

  // 去重 & 截断
  const toolCallCounts = new Map<string, number>();
  for (const name of fragments.toolCalls) {
    toolCallCounts.set(name, (toolCallCounts.get(name) || 0) + 1);
  }
  const uniqueFileChanges = [...new Set(fragments.fileChanges)].slice(0, 40);
  const userIntents = fragments.userIntents.slice(0, 8);
  const conclusions = fragments.conclusions.slice(0, 5);

  // 组装摘要文本
  const lines: string[] = [
    '[Context Compressed — summary of earlier conversation]',
    `Messages ${coverFromIndex + 1}–${coverToIndex + 1} compressed (${originalTokens} tokens)`,
  ];

  if (userIntents.length > 0) {
    lines.push('');
    lines.push('## User Intents');
    for (const intent of userIntents) {
      lines.push(`- ${intent.length > 120 ? intent.slice(0, 117) + '...' : intent}`);
    }
  }

  if (toolCallCounts.size > 0) {
    lines.push('');
    lines.push('## Tools Called');
    const toolLines = [...toolCallCounts.entries()]
      .map(([name, count]) => (count > 1 ? `${name} (×${count})` : name))
      .slice(0, 30);
    lines.push(toolLines.join(', '));
  }

  if (uniqueFileChanges.length > 0) {
    lines.push('');
    lines.push('## Files Involved');
    lines.push(uniqueFileChanges.join('\n'));
  }

  if (conclusions.length > 0) {
    lines.push('');
    lines.push('## Key Conclusions');
    for (const c of conclusions) {
      lines.push(`- ${c.length > 80 ? c.slice(0, 77) + '...' : c}`);
    }
  }

  let summaryText = lines.join('\n');

  // 硬截断到 token 预算
  const st = estimateTokens(summaryText);
  if (st > SUMMARY_TOKEN_BUDGET || summaryText.length > SUMMARY_CHAR_BUDGET) {
    const maxChars = Math.min(SUMMARY_CHAR_BUDGET, SUMMARY_TOKEN_BUDGET * 3);
    if (summaryText.length > maxChars) {
      summaryText = summaryText.slice(0, maxChars) + '\n... [summary truncated]';
    }
  }

  return {
    id: `summary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    coverFromIndex,
    coverToIndex,
    summary: summaryText,
    createdAt: Date.now(),
    originalTokens,
    summaryTokens: estimateTokens(summaryText),
  };
}

// ==================== 压缩+裁剪串联 ====================

/**
 * 对消息列表应用压缩+裁剪策略。
 *
 * 1. 如果总 token 超过预算，先对将被移除的消息生成摘要
 * 2. 用摘要替代被移除的消息
 * 3. 如果压缩后仍超预算，再由 trimMessagesToFit 兜底裁剪
 *
 * @param messages 待处理的消息数组
 * @param budgetTokens 可用 token 预算
 * @param keepLastRounds 始终保留最后几轮对话（默认 2）
 * @param existingSummary 已有摘要（合并到新摘要中）
 */
/**
 * @deprecated Use compactConversation from utils/compact instead.
 */
export function compressAndTrim(
  messages: MessageLike[],
  budgetTokens: number,
  keepLastRounds = 2,
  existingSummary?: CompressedSummary | null
): CompressResult {
  if (messages.length === 0) {
    return { messages, compressed: false, summary: null, originalTokens: 0, compressedTokens: 0 };
  }

  // 估算总量
  let totalTokens = 0;
  for (const m of messages) {
    totalTokens += estimateMessageTokens(m);
  }

  if (totalTokens <= budgetTokens) {
    return { messages, compressed: false, summary: null, originalTokens: totalTokens, compressedTokens: totalTokens };
  }

  // 计算保护区
  const keepLastCount = Math.min(keepLastRounds * 2, messages.length - 1);
  const protectedTailThreshold = messages.length - keepLastCount;

  // 标记可移除的消息（从索引 1 开始，跳过第一条 system）
  const removableIndices: number[] = [];
  for (let i = 1; i < protectedTailThreshold; i++) {
    if (messages[i].role === 'system') continue;
    removableIndices.push(i);
  }

  if (removableIndices.length === 0) {
    return { messages, compressed: false, summary: null, originalTokens: totalTokens, compressedTokens: totalTokens };
  }

  // 计算可移除的 token 数
  let removableTokens = 0;
  for (const idx of removableIndices) {
    removableTokens += estimateMessageTokens(messages[idx]);
  }

  // 如果移除区全部移除后仍超预算，不需要压缩——直接走裁剪
  const afterRemoval = totalTokens - removableTokens;
  if (afterRemoval > budgetTokens) {
    return { messages, compressed: false, summary: null, originalTokens: totalTokens, compressedTokens: totalTokens };
  }

  // 需要压缩——生成摘要
  const removableMessages = removableIndices.map((idx) => messages[idx]);
  const coverFrom = removableIndices[0];
  const coverTo = removableIndices[removableIndices.length - 1];

  let summary = buildRuleBasedSummary(removableMessages, coverFrom, coverTo);

  if (existingSummary) {
    const mergedSummaryText = [
      existingSummary.summary,
      '',
      '--- Merged with newer context ---',
      '',
      summary.summary,
    ].join('\n');

    const mergedTokens = estimateTokens(mergedSummaryText);
    if (mergedTokens <= SUMMARY_TOKEN_BUDGET * 1.5) {
      summary = {
        ...summary,
        id: existingSummary.id,
        coverFromIndex: existingSummary.coverFromIndex,
        summary: mergedSummaryText,
        summaryTokens: mergedTokens,
      };
    }
  }

  // 方法 9：摘要追加到 system prompt 末尾，而非作为独立 user 消息插入。
  // 这样 system 前缀保持稳定，缓存命中不被破坏。
  // - 如果 messages[0] 是 system 消息，将摘要追加到其 content 末尾
  // - 如果没有 system 消息，则创建一条新的 system 消息放在最前面
  const result: MessageLike[] = [];
  const removableSet = new Set(removableIndices);

  // 检查第一条消息是否为 system
  const firstMsg = messages[0];
  const isFirstSystem = firstMsg.role === 'system';

  // 构建摘要 system 消息（如果需要追加到现有 system）
  const summaryPrefix = '\n\n[Context Summary]\n';
  const summaryText = summary.summary;

  if (isFirstSystem) {
    // 将摘要追加到现有 system 消息的 content 末尾
    const firstContent = typeof firstMsg.content === 'string'
      ? firstMsg.content
      : Array.isArray(firstMsg.content)
        ? firstMsg.content
        : String(firstMsg.content ?? '');

    if (typeof firstContent === 'string') {
      result.push({
        ...firstMsg,
        content: firstContent + summaryPrefix + summaryText,
      });
    } else if (Array.isArray(firstContent)) {
      // Anthropic 格式：content 是 block 数组
      result.push({
        ...firstMsg,
        content: [
          ...firstContent,
          { type: 'text', text: summaryPrefix + summaryText },
        ],
      });
    } else {
      // 兜底：直接替换为字符串
      result.push({
        ...firstMsg,
        content: String(firstContent) + summaryPrefix + summaryText,
      });
    }
  } else {
    // 没有 system 消息，创建一条新的 system 消息
    result.push({
      role: 'system',
      content: `[Context Summary]\n${summaryText}`,
    });
    result.push(firstMsg);
  }

  // 添加其余非移除的消息
  for (let i = 1; i < messages.length; i++) {
    if (removableSet.has(i)) {
      continue;
    }
    result.push(messages[i]);
  }

  let compressedTokens = 0;
  for (const m of result) {
    compressedTokens += estimateMessageTokens(m);
  }

  return {
    messages: result,
    compressed: true,
    summary,
    originalTokens: totalTokens,
    compressedTokens,
  };
}
