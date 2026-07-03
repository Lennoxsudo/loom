/**
 * 上下文预算管理模块
 *
 * 参考 Claude Code CLI 的策略：在发送 API 请求前估算 token 用量，
 * 自动截断旧消息以确保不超过模型上下文窗口限制。
 *
 * @module contextBudget
 */

import type { CompressedSummary } from './contextCompressor';

export { agePersistedProviderToolMessages } from './toolResultAging';

// ==================== Token 估算 ====================

/** CJK 字符范围正则（模块级常量，避免每次调用重新编译） */
const CJK_REGEX = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;

/**
 * 方法 11：Token 估算校准状态。
 *
 * 维护一个全局的校准系数，用 API 返回的实际 usage 数据校准 estimateTokens 的估算。
 * 使用 EMA（指数移动平均）平滑更新，避免单次偏差导致剧烈波动。
 *
 * 默认值：CJK 1.5x，非 CJK /3.5（偏保守）
 * 校准后：根据 actual/estimated 比率调整系数
 */
interface CalibrationState {
  /** CJK 字符的 token 系数（每个 CJK 字符算多少 token） */
  cjkFactor: number;
  /** 非 CJK 字符的 token 除数（每 N 个字符算 1 token） */
  nonCjkDivisor: number;
  /** 校准样本数（用于判断是否已校准） */
  sampleCount: number;
}

const calibrationState: CalibrationState = {
  cjkFactor: 1.5,
  nonCjkDivisor: 3.5,
  sampleCount: 0,
};

/** EMA 平滑系数（0~1，越小越平滑） */
const CALIBRATION_EMA_ALPHA = 0.3;

/** 最大校准系数范围（防止极端值） */
const MIN_CJK_FACTOR = 0.8;
const MAX_CJK_FACTOR = 3.0;
const MIN_NON_CJK_DIVISOR = 2.0;
const MAX_NON_CJK_DIVISOR = 6.0;

/**
 * 方法 11：用 API 返回的实际 token 数校准估算系数。
 *
 * @param estimated 前端估算的 token 数
 * @param actual API 返回的实际 input_tokens
 */
export function calibrateTokenEstimation(estimated: number, actual: number): void {
  if (estimated <= 0 || actual <= 0) return;

  const ratio = actual / estimated;
  // 限制单次校准的幅度，避免异常值导致系数剧烈跳变
  const clampedRatio = Math.max(0.5, Math.min(2.0, ratio));

  // 按比例调整两个系数
  const newCjkFactor = calibrationState.cjkFactor * clampedRatio;
  const newNonCjkDivisor = calibrationState.nonCjkDivisor / clampedRatio;

  // EMA 平滑
  if (calibrationState.sampleCount === 0) {
    // 首次校准直接使用新值
    calibrationState.cjkFactor = newCjkFactor;
    calibrationState.nonCjkDivisor = newNonCjkDivisor;
  } else {
    calibrationState.cjkFactor =
      calibrationState.cjkFactor * (1 - CALIBRATION_EMA_ALPHA) + newCjkFactor * CALIBRATION_EMA_ALPHA;
    calibrationState.nonCjkDivisor =
      calibrationState.nonCjkDivisor * (1 - CALIBRATION_EMA_ALPHA) +
      newNonCjkDivisor * CALIBRATION_EMA_ALPHA;
  }

  // 钳制到安全范围
  calibrationState.cjkFactor = Math.max(MIN_CJK_FACTOR, Math.min(MAX_CJK_FACTOR, calibrationState.cjkFactor));
  calibrationState.nonCjkDivisor = Math.max(MIN_NON_CJK_DIVISOR, Math.min(MAX_NON_CJK_DIVISOR, calibrationState.nonCjkDivisor));

  calibrationState.sampleCount++;
}

/**
 * 获取当前校准状态（用于调试/UI 显示）
 */
export function getCalibrationState(): Readonly<CalibrationState> {
  return { ...calibrationState };
}

/**
 * 粗略估算文本 token 数。
 * - 中文/日文/韩文: ~1.5 token/字（可通过方法 11 校准）
 * - 英文/代码: ~0.25 token/word ≈ 1 token/4 chars（可通过方法 11 校准）
 *
 * 估算偏高以留安全余量。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let tokens = 0;
  // CJK 字符: 每个算 cjkFactor token
  const textWithoutCjk = text.replace(CJK_REGEX, '');
  const cjkCount = text.length - textWithoutCjk.length;
  tokens += cjkCount * calibrationState.cjkFactor;

  // 非 CJK 部分: 每 nonCjkDivisor 字符算 1 token
  const nonCjkLength = textWithoutCjk.length;
  tokens += nonCjkLength / calibrationState.nonCjkDivisor;

  return Math.ceil(tokens);
}

/**
 * 估算单条消息的 token 数（含 role/metadata 开销）
 *
 * 方法 15：图片 token 按 provider 估算，而非固定 300。
 * 使用 `estimateMessageTokensWithProvider` 可获得更精确的图片 token 估算。
 */
export function estimateMessageTokens(message: { role: string; content: unknown }): number {
  const overhead = 4; // role + separators
  let contentTokens = 0;

  if (typeof message.content === 'string') {
    contentTokens = estimateTokens(message.content);
  } else if (Array.isArray(message.content)) {
    // Anthropic 格式: content 是 array of blocks
    for (const block of message.content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          contentTokens += estimateTokens(b.text);
        } else if (b.type === 'tool_use') {
          contentTokens += estimateTokens(JSON.stringify(b.input ?? {})) + 20;
        } else if (b.type === 'tool_result') {
          contentTokens += estimateTokens(typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? ''));
        } else if (b.type === 'image' || b.type === 'image_url') {
          // 方法 15：使用通用估算（300），provider 特定估算见 estimateMessageTokensWithProvider
          contentTokens += DEFAULT_IMAGE_TOKENS;
        } else {
          contentTokens += estimateTokens(JSON.stringify(b));
        }
      }
    }
  } else if (message.content != null) {
    contentTokens = estimateTokens(JSON.stringify(message.content));
  }

  return overhead + contentTokens;
}

// ==================== 方法 15：图片附件上下文管理 ====================

/** 默认图片 token 估算（保守通用值） */
export const DEFAULT_IMAGE_TOKENS = 300;

/**
 * 按 provider 估算图片 token 数。
 *
 * 不同 provider 的图片 token 消耗差异巨大：
 * - OpenAI GPT-4o: 低分辨率 ~85，高分辨率可达 1105
 * - Anthropic Claude: ~1600
 * - Gemini: ~258
 * - Ollama: ~300（本地模型，取决于实现）
 */
const IMAGE_TOKEN_BY_PROVIDER: Record<string, number> = {
  openai: 85,    // GPT-4o 低分辨率保守值
  anthropic: 1600,
  gemini: 258,
  ollama: 300,
};

/**
 * 获取指定 provider 的图片 token 估算值。
 *
 * @param provider AI provider 名称
 * @returns 单张图片的 token 估算值
 */
export function getImageTokenEstimate(provider?: string): number {
  if (!provider) return DEFAULT_IMAGE_TOKENS;
  return IMAGE_TOKEN_BY_PROVIDER[provider] ?? DEFAULT_IMAGE_TOKENS;
}

/**
 * 按 provider 估算单条消息的 token 数（含 role/metadata 开销）。
 *
 * 方法 15：图片 block 使用 provider 特定的 token 估算，而非固定 300。
 * 这使得图片密集对话的预算估算更准确。
 *
 * @param message 消息对象
 * @param provider AI provider 名称（可选，不传则用默认值 300）
 */
export function estimateMessageTokensWithProvider(
  message: { role: string; content: unknown },
  provider?: string,
): number {
  const overhead = 4;
  let contentTokens = 0;
  const imageTokens = getImageTokenEstimate(provider);

  if (typeof message.content === 'string') {
    contentTokens = estimateTokens(message.content);
  } else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          contentTokens += estimateTokens(b.text);
        } else if (b.type === 'tool_use') {
          contentTokens += estimateTokens(JSON.stringify(b.input ?? {})) + 20;
        } else if (b.type === 'tool_result') {
          contentTokens += estimateTokens(typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? ''));
        } else if (b.type === 'image' || b.type === 'image_url') {
          contentTokens += imageTokens;
        } else {
          contentTokens += estimateTokens(JSON.stringify(b));
        }
      }
    }
  } else if (message.content != null) {
    contentTokens = estimateTokens(JSON.stringify(message.content));
  }

  return overhead + contentTokens;
}

/** 旧图片自动移除的轮数阈值（超过此数量的较早图片会被移除） */
const IMAGE_AGING_KEEP_COUNT = 3;

/**
 * 方法 15：移除较早的图片内容块，保留文字描述。
 *
 * 超过 N 条的较早图片消息中，图片 block 会被替换为文字占位符。
 * 最近 N 条图片消息保持原文不变。
 *
 * @param messages 待处理的消息数组
 * @param keepCount 保留最近几条含图片的消息原文（默认 3）
 */
export function ageOldImageAttachments<T extends { role: string; content: unknown }>(
  messages: T[],
  keepCount = IMAGE_AGING_KEEP_COUNT,
): T[] {
  if (messages.length === 0) return messages;

  // 收集所有含图片的消息索引
  const imageMessageIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const content = messages[i].content;
    if (Array.isArray(content)) {
      const hasImage = content.some(
        (block) =>
          typeof block === 'object' &&
          block !== null &&
          ((block as Record<string, unknown>).type === 'image' ||
            (block as Record<string, unknown>).type === 'image_url'),
      );
      if (hasImage) {
        imageMessageIndices.push(i);
      }
    }
  }

  // 图片消息数量不超过保留阈值，无需处理
  if (imageMessageIndices.length <= keepCount) {
    return messages;
  }

  // 需要处理的索引（较早的图片消息，保留最后 keepCount 条原文）
  const agedCount = imageMessageIndices.length - keepCount;
  const agedIndices = new Set(imageMessageIndices.slice(0, agedCount));

  const IMAGE_PLACEHOLDER = '[Image removed to save context — was attached earlier in conversation]';

  const result = messages.map((msg, i) => {
    if (!agedIndices.has(i)) return msg;
    if (!Array.isArray(msg.content)) return msg;

    let modified = false;
    const newContent = msg.content.map((block) => {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === 'image' || b.type === 'image_url') {
          modified = true;
          return { type: 'text', text: IMAGE_PLACEHOLDER };
        }
      }
      return block;
    });

    if (modified) {
      return { ...msg, content: newContent };
    }
    return msg;
  });

  return result;
}

/**
 * 将文本截断到不超过 maxTokens（含 suffix），与 estimateTokens 使用同一套估算。
 * 通过二分查找保证 CJK / ASCII / 混合文本均与预算估算自洽。
 */
export function truncateTextToTokenBudget(
  text: string,
  maxTokens: number,
  suffix = '',
): string {
  const suffixTokens = estimateTokens(suffix);
  const bodyBudget = maxTokens - suffixTokens;

  if (bodyBudget <= 0) {
    return suffix;
  }

  if (!text || estimateTokens(text) <= bodyBudget) {
    return text + suffix;
  }

  let low = 0;
  let high = text.length;
  let bestLen = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (estimateTokens(text.slice(0, mid)) <= bodyBudget) {
      bestLen = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return text.slice(0, bestLen) + suffix;
}

/**
 * 估算工具定义集合的 token 消耗（结果按引用缓存，避免重复序列化）
 */
const _toolsTokenCache = new WeakMap<object, number>();

export function estimateToolsTokens(tools: unknown): number {
  if (!tools) return 0;
  if (typeof tools === 'object' && tools !== null) {
    const cached = _toolsTokenCache.get(tools as object);
    if (cached !== undefined) return cached;
  }
  const json = JSON.stringify(tools);
  // 工具定义中 JSON 关键字/结构符占比高，1 token ≈ 3 chars
  const result = Math.ceil(json.length / 3);
  if (typeof tools === 'object' && tools !== null) {
    _toolsTokenCache.set(tools as object, result);
  }
  return result;
}

// ==================== 模型上下文窗口 ====================

/** 默认上下文窗口大小 (200K tokens) */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

// ==================== 消息裁剪 ====================

/** 占位消息，替代被截断的历史 */
export const TRIM_PLACEHOLDER = '[Earlier messages were truncated to fit context window]';

/** 硬截断后缀（计入 token 预算） */
export const HARD_TRUNC_SUFFIX = '... [HARD TRUNCATED]';

/** estimateMessageTokens 的 role/metadata 固定开销 */
const MESSAGE_TOKEN_OVERHEAD = 4;

/** 硬截断循环上限，防止多消息连续超标时死循环 */
const MAX_HARD_TRUNC_PASSES = 8;

/** 从单条消息提取已声明的 tool_use / tool_call id */
function extractDeclaredToolUseIds(msg: Record<string, unknown>): string[] {
  const ids: string[] = [];

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (typeof tc === 'object' && tc !== null) {
        const id = (tc as { id?: string }).id;
        if (typeof id === 'string' && id.trim()) {
          ids.push(id.trim());
        }
      }
    }
  }

  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === 'tool_use' && typeof b.id === 'string' && b.id.trim()) {
          ids.push(b.id.trim());
        }
      }
    }
  }

  return ids;
}

/** 从单条消息提取 tool_result / tool role 引用的 id */
function extractToolResultIds(msg: Record<string, unknown>): string[] {
  if (msg.role === 'tool' && typeof msg.tool_call_id === 'string' && msg.tool_call_id.trim()) {
    return [msg.tool_call_id.trim()];
  }

  if (!Array.isArray(msg.content)) return [];

  const ids: string[] = [];
  for (const block of msg.content) {
    if (typeof block === 'object' && block !== null) {
      const b = block as Record<string, unknown>;
      if (b.type === 'tool_result' && typeof b.tool_use_id === 'string' && b.tool_use_id.trim()) {
        ids.push(b.tool_use_id.trim());
      }
    }
  }
  return ids;
}

/** 收集 messages[0..upToIndex] 内声明的全部 tool_use id */
function collectToolUseIdsUpTo<T extends { role: string; content: unknown }>(
  messages: T[],
  upToIndex: number,
): Set<string> {
  const ids = new Set<string>();
  const end = Math.min(upToIndex, messages.length - 1);
  for (let i = 0; i <= end; i++) {
    for (const id of extractDeclaredToolUseIds(messages[i] as Record<string, unknown>)) {
      ids.add(id);
    }
  }
  return ids;
}

/** 消息是否仅含无前驱的 tool_result（裁剪后常见的非法尾部） */
function isOrphanToolResultOnly(msg: Record<string, unknown>, knownToolUseIds: Set<string>): boolean {
  const resultIds = extractToolResultIds(msg);
  if (resultIds.length === 0) return false;
  return resultIds.every((id) => !knownToolUseIds.has(id));
}

/**
 * 从尾部向前查找可安全保留的消息索引，跳过孤立 tool_result。
 * 返回 -1 表示除首条外没有可保留的尾部。
 */
function findSafeLastIndex<T extends { role: string; content: unknown }>(messages: T[]): number {
  for (let i = messages.length - 1; i >= 1; i--) {
    const knownIds = collectToolUseIdsUpTo(messages, i - 1);
    if (!isOrphanToolResultOnly(messages[i] as Record<string, unknown>, knownIds)) {
      return i;
    }
  }
  return -1;
}

function buildMissingToolResultPlaceholder<T>(
  missingIds: string[],
  anthropicStyle: boolean,
): T {
  if (anthropicStyle) {
    return {
      role: 'user',
      content: missingIds.map((id) => ({
        type: 'tool_result',
        tool_use_id: id,
        content: '操作已取消',
      })),
    } as unknown as T;
  }

  // OpenAI 路径一次只补一条；调用方按 id 逐条插入
  return {
    role: 'tool',
    content: '操作已取消',
    tool_call_id: missingIds[0],
  } as unknown as T;
}

/**
 * 修复裁剪后的 tool_use / tool_result 配对。
 * - 丢弃无前驱的 tool_result（含 Anthropic content block 与 OpenAI tool 角色）
 * - 为仍保留的 assistant tool_use 补充缺失的 tool_result 占位
 * - 确保序列末尾不是孤立 tool_result
 */
export function repairTrimmedToolChain<T extends { role: string; content: unknown }>(
  messages: T[],
): T[] {
  if (messages.length === 0) return messages;

  const knownToolUseIds = new Set<string>();
  const seenToolResultIds = new Set<string>();
  const filtered: T[] = [];

  for (const msg of messages) {
    const msgRec = msg as Record<string, unknown>;

    if (msgRec.role === 'assistant') {
      for (const id of extractDeclaredToolUseIds(msgRec)) {
        knownToolUseIds.add(id);
      }
      filtered.push(msg);
      continue;
    }

    if (msgRec.role === 'tool') {
      const tcId =
        typeof msgRec.tool_call_id === 'string' ? msgRec.tool_call_id.trim() : '';
      if (!tcId || !knownToolUseIds.has(tcId) || seenToolResultIds.has(tcId)) {
        continue;
      }
      seenToolResultIds.add(tcId);
      filtered.push(msg);
      continue;
    }

    if (msgRec.role === 'user' && Array.isArray(msgRec.content)) {
      const blocks = msgRec.content as Record<string, unknown>[];
      const hasToolResult = blocks.some((b) => b?.type === 'tool_result');
      if (hasToolResult) {
        const keptBlocks = blocks.filter((b) => {
          if (b?.type !== 'tool_result') return true;
          const id = typeof b.tool_use_id === 'string' ? b.tool_use_id.trim() : '';
          if (!id || !knownToolUseIds.has(id) || seenToolResultIds.has(id)) {
            return false;
          }
          seenToolResultIds.add(id);
          return true;
        });
        if (keptBlocks.length === 0) continue;
        filtered.push(
          keptBlocks.length === blocks.length
            ? msg
            : ({ ...msg, content: keptBlocks } as T),
        );
        continue;
      }
    }

    filtered.push(msg);
  }

  const anthropicStyle = filtered.some((m) => {
    const rec = m as Record<string, unknown>;
    return (
      (rec.role === 'assistant' &&
        Array.isArray(rec.content) &&
        (rec.content as Record<string, unknown>[]).some((b) => b?.type === 'tool_use')) ||
      (rec.role === 'user' &&
        Array.isArray(rec.content) &&
        (rec.content as Record<string, unknown>[]).some((b) => b?.type === 'tool_result'))
    );
  });

  const repaired: T[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const msg = filtered[i];
    repaired.push(msg);

    const msgRec = msg as Record<string, unknown>;
    if (msgRec.role !== 'assistant') continue;

    const declaredIds = extractDeclaredToolUseIds(msgRec);
    if (declaredIds.length === 0) continue;

    const existingResultIds = new Set<string>();
    for (let j = i + 1; j < filtered.length; j++) {
      const next = filtered[j] as Record<string, unknown>;
      if (next.role === 'assistant') break;
      for (const id of extractToolResultIds(next)) {
        existingResultIds.add(id);
      }
    }

    const missingIds = declaredIds.filter((id) => !existingResultIds.has(id));
    if (missingIds.length === 0) continue;

    if (anthropicStyle) {
      repaired.push(buildMissingToolResultPlaceholder<T>(missingIds, true));
    } else {
      for (const id of missingIds) {
        repaired.push(buildMissingToolResultPlaceholder<T>([id], false));
      }
    }
  }

  while (repaired.length > 0) {
    const lastIdx = repaired.length - 1;
    const knownIds = collectToolUseIdsUpTo(repaired, lastIdx - 1);
    if (isOrphanToolResultOnly(repaired[lastIdx] as Record<string, unknown>, knownIds)) {
      repaired.pop();
    } else {
      break;
    }
  }

  return repaired;
}

/**
 * 判断消息是否属于工具调用的任一环节（发起工具、工具结果）
 */
function isToolRelatedMessage(msg: Record<string, unknown>): boolean {
  if (msg.role === 'tool') return true;
  if ('tool_calls' in msg && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return true;
  if ('tool_call_id' in msg && !!msg.tool_call_id) return true;
  
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === 'tool_use' || b.type === 'tool_result') return true;
      }
    }
  }
  return false;
}

/**
 * 计算合理的 keepLastRounds 值。
 * 工具密集型对话中，2 轮 (4 条) 可能不够保留完整的
 * user → assistant(tool_use) → tool_result → assistant 序列。
 */
function computeKeepLastRounds(messages: { role: string }[], baseRounds: number): number {
  if (messages.length <= 8) return baseRounds;
  // 统计最后 10 条消息中 tool 相关消息的占比
  const tail = messages.slice(-10);
  const toolCount = tail.filter(
    (m) => m.role === 'tool' || m.role === 'function'
  ).length;
  // tool 消息超过 30% → 多保留 1 轮
  if (toolCount >= 3) return baseRounds + 1;
  return baseRounds;
}

/**
 * 裁剪消息列表使其 token 总量不超过预算。
 *
 * 策略（参考 Claude Code CLI）：
 * 1. 始终保留第一条消息（通常含系统指令/上下文）
 * 2. 始终保留所有 system 消息（不可裁剪）
 * 3. 始终保留最后 N 轮对话（保证连贯性，N 根据工具密度动态调整）
 * 4. 中间的消息从旧到新逐条移除
 * 5. 被移除的区间替换为一条占位消息
 *
 * @param messages 格式化后待发送的消息数组
 * @param budgetTokens 可用 token 预算
 * @param keepLastRounds 始终保留最后几轮对话（默认 2 轮 = 4 条消息，根据工具密度自动+1）
 */
export function trimMessagesToFit<T extends { role: string; content: unknown }>(
  messages: T[],
  budgetTokens: number,
  keepLastRounds = 2,
): T[] {
  if (messages.length === 0) return messages;

  // 动态调整 keepLastRounds
  const effectiveKeepRounds = computeKeepLastRounds(messages, keepLastRounds);

  // 估算当前总量
  let totalTokens = 0;
  const tokensByMsg = messages.map((m) => {
    const t = estimateMessageTokens(m);
    totalTokens += t;
    return t;
  });

  // 在预算内，无需裁剪
  if (totalTokens <= budgetTokens) return messages;

  // 计算保护区起点的索引
  const keepLastCount = Math.min(effectiveKeepRounds * 2, messages.length - 1);
  const protectedTailThreshold = messages.length - keepLastCount;

  // 方法 10：前缀保护区。
  // 保持前 N 条消息不变（作为缓存前缀），只裁剪中间部分。
  // system + 首条 user + 首条 assistant 通常构成稳定的缓存前缀。
  const PREFIX_KEEP_COUNT = Math.min(3, messages.length);

  const removedIndices = new Set<number>();
  let currentTotal = totalTokens;

  // 将消息切分为块 (Chunk)。核心思路：连续的工具调用链路不能被从中切断，必须作为一个原子块保留或移除。
  const chunks: Array<{ indices: number[]; tokens: number }> = [];
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === 'system') continue;
    // 方法 10：跳过前缀保护区，使其不被纳入可移除的 chunks
    if (i < PREFIX_KEEP_COUNT) continue;

    const msg = messages[i] as Record<string, unknown>;
    const isTool = isToolRelatedMessage(msg);
    
    if (chunks.length > 0) {
      const prevChunk = chunks[chunks.length - 1];
      const prevLastIdx = prevChunk.indices[prevChunk.indices.length - 1];
      
      // 如果当前是 tool，且上一个也是 tool，合并为一个原子块
      if (isTool && isToolRelatedMessage(messages[prevLastIdx] as Record<string, unknown>)) {
        prevChunk.indices.push(i);
        prevChunk.tokens += tokensByMsg[i];
        continue;
      }
    }
    
    chunks.push({ indices: [i], tokens: tokensByMsg[i] });
  }

  // 从旧到新移除块，直到满足预算，或碰到受保护的尾部
  for (const chunk of chunks) {
    if (currentTotal <= budgetTokens) break;
    
    // 如果该块包含任何受保护范围的消息，则停止移除
    const isProtected = chunk.indices.some((idx) => idx >= protectedTailThreshold);
    if (isProtected) break;

    chunk.indices.forEach((idx) => removedIndices.add(idx));
    currentTotal -= chunk.tokens;
  }

  // 构建结果
  let result: T[] = [];

  if (removedIndices.size === 0 && currentTotal > budgetTokens) {
    // 保护区本身就超预算，只能截掉更多尾部
    // 退回到只保留首尾各 1 条
    if (messages.length <= 2) return messages; // 无法再减

    const first = messages[0];

    // 严格净化 placeholder，摒弃扩展运算符（避免带入 tool_calls 等越界字段）
    const placeholder = {
      role: 'user',
      content: TRIM_PLACEHOLDER,
    } as unknown as T;

    const safeLastIdx = findSafeLastIndex(messages);
    if (safeLastIdx < 0) {
      console.warn(
        `[contextBudget] Aggressive trim: kept first + placeholder only (${messages.length} -> 2); skipped orphan tool tail`,
      );
      result = [first, placeholder];
    } else {
      const last = messages[safeLastIdx];
      console.warn(
        `[contextBudget] Aggressive trim: kept first + last (${messages.length} -> 3${safeLastIdx < messages.length - 1 ? ', skipped orphan tool tail' : ''})`,
      );
      result = [first, placeholder, last];
    }
  } else {
    let placeholderInserted = false;

    for (let i = 0; i < messages.length; i++) {
      if (removedIndices.has(i)) {
        if (!placeholderInserted) {
          const placeholder = { 
              role: 'user', 
              content: TRIM_PLACEHOLDER 
          } as unknown as T;
          result.push(placeholder);
          placeholderInserted = true;
        }
        continue;
      }
      result.push(messages[i]);
    }
  }

  result = repairTrimmedToolChain(result);

  // 二次安全校验：极端情况下，即使只保留首尾，首部（如含巨型 system prompt）
  // 或尾部（含长文本）相加依然超标。此时须截断字符串内容本身作为最后兜底。
  let finalTokens = 0;
  result.forEach(m => finalTokens += estimateMessageTokens(m));
  
  if (finalTokens > budgetTokens && result.length > 0) {
    console.warn(
      `[contextBudget] Final result still exceeds budget (${finalTokens} > ${budgetTokens}). Forcing string truncation on the largest message.`,
    );

    for (let pass = 0; pass < MAX_HARD_TRUNC_PASSES; pass++) {
      finalTokens = result.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
      if (finalTokens <= budgetTokens) break;

      let targetIdx = -1;
      let maxMsgTokens = -1;
      for (let i = 0; i < result.length; i++) {
        if (typeof result[i].content !== 'string') continue;
        const msgTokens = estimateMessageTokens(result[i]);
        if (msgTokens > maxMsgTokens) {
          maxMsgTokens = msgTokens;
          targetIdx = i;
        }
      }
      if (targetIdx === -1) break;

      const targetMsg = result[targetIdx];
      const originalStr = targetMsg.content as string;
      const otherTokens = finalTokens - estimateMessageTokens(targetMsg);
      const contentBudget = budgetTokens - otherTokens - MESSAGE_TOKEN_OVERHEAD;
      const truncated = truncateTextToTokenBudget(
        originalStr,
        contentBudget,
        HARD_TRUNC_SUFFIX,
      );

      if (truncated === originalStr) break;

      result[targetIdx] = {
        ...targetMsg,
        content: truncated,
      } as T;
    }

    finalTokens = result.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  }

  return result;
}

// ==================== 统一预算裁剪 ====================

/** 上下文自动压缩阈值：当使用量达到预算的 90% 时触发压缩 */
export const AUTO_COMPRESS_THRESHOLD = 0.9;

/**
 * applyContextBudget 的返回结果
 */
export interface ApplyBudgetResult<T extends { role: string; content: unknown }> {
  /** 处理后的消息数组 */
  messages: T[];
}

/**
 * 对消息列表应用上下文预算：image aging + 裁剪兜底。
 *
 * 压缩（compact）在发送前由 Agent/Chat 的 contextUsage 流程改写会话历史完成；
 * 此函数仅处理出站前的 image aging 与超预算裁剪。
 */
export function applyContextBudget<T extends { role: string; content: unknown }>(
  messages: T[],
  _model: string,
  tools?: unknown,
  reserveTokens = 8192,
  maxContextTokens?: number,
  _existingSummary?: CompressedSummary | null,
  provider?: string,
): ApplyBudgetResult<T> {
  const budget = maxContextTokens ?? DEFAULT_CONTEXT_WINDOW;
  const toolTokens = estimateToolsTokens(tools);
  const messageBudget = budget - toolTokens - reserveTokens;
  const compressionThreshold = Math.floor(messageBudget * AUTO_COMPRESS_THRESHOLD);

  const agedMessagesFinal = provider
    ? ageOldImageAttachments(messages)
    : messages;

  const totalTokens = agedMessagesFinal.reduce(
    (sum, m) => sum + estimateMessageTokens(m),
    0,
  );

  let result: T[];
  if (totalTokens <= compressionThreshold) {
    result = agedMessagesFinal as T[];
  } else {
    result = repairTrimmedToolChain(
      trimMessagesToFit(agedMessagesFinal as T[], compressionThreshold),
    );
  }

  return { messages: result };
}
