/**
 * 工具匹配模块
 *
 * 提供基于关键词相似度的工具名称匹配功能
 */

/**
 * 根据输入的工具名称，在候选列表中找到最佳匹配
 *
 * 匹配策略：
 * 1. 将工具名称按 '_' 分割为关键词
 * 2. 计算输入与候选的关键词重叠数
 * 3. 检查是否为子串关系
 * 4. 至少 50% 的关键词匹配才认为有效
 *
 * @param input - 输入的工具名称
 * @param candidates - 候选工具名称列表
 * @returns 最佳匹配的工具名称，若无有效匹配则返回 null
 *
 * @example
 * findBestToolMatch('browser_screenshot', ['browser_take_screenshot', 'read_file'])
 * // 返回 'browser_take_screenshot' (共享 browser + screenshot)
 */
export function findBestToolMatch(input: string, candidates: string[]): string | null {
  if (!input || !input.trim()) {
    return null;
  }

  const inputTokens = new Set(input.toLowerCase().split('_'));

  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const candidateTokens = new Set(candidate.toLowerCase().split('_'));

    // 计算关键词重叠数
    let overlap = 0;
    for (const token of inputTokens) {
      if (candidateTokens.has(token)) overlap++;
    }

    // 也检查是否 input 是 candidate 的子串或反之，要求长度至少为 2 字符以防单字符匹配错误
    const cl = candidate.toLowerCase();
    const il = input.toLowerCase().trim();
    if (il.length >= 2 && (cl.includes(il) || il.includes(cl))) {
      overlap = Math.max(overlap, inputTokens.size * 0.8);
    }

    // 分数 = 重叠数 / 输入 token 总数
    const score = overlap / inputTokens.size;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  // 至少 50% 的关键词匹配才认为有效
  return bestScore >= 0.5 ? bestMatch : null;
}
