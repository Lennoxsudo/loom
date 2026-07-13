export type WebSearchResultItem = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchToolResultView = {
  isError: boolean;
  errorText?: string;
  query: string;
  count: number;
  provider: string;
  results: WebSearchResultItem[];
  hint?: string;
  emptyMessage?: string;
};

function looksLikeToolError(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return (
    trimmed.startsWith('❌')
    || trimmed.includes('错误:')
    || trimmed.includes('执行失败')
    || trimmed.startsWith('搜索失败')
    || /^error:/i.test(trimmed)
    || /\bfailed\b/i.test(trimmed)
  );
}

/** Decode numeric/named HTML entities from search snippets. */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }

  return text
    .replace(/&ensp;/g, '\u2002')
    .replace(/&emsp;/g, '\u2003')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function normalizeSearchText(text: string): string {
  const decoded = decodeHtmlEntities(text);
  return decoded
    .replace(/[\u00a0\u2002\u2003\u2009]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseResultBlock(block: string): WebSearchResultItem | null {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const titleLine = lines[0].replace(/^\d+\.\s*/, '').trim();
  const urlLine = lines.find((line) => /^URL:\s*/i.test(line));
  const snippetLine = lines.find((line) => /^摘要:\s*/.test(line));

  const url = urlLine?.replace(/^URL:\s*/i, '').trim() || '';
  const snippet = snippetLine?.replace(/^摘要:\s*/, '').trim() || '';

  if (!titleLine && !url) return null;
  if (!url && !/^\d+\./.test(lines[0])) return null;

  return {
    title: normalizeSearchText(titleLine || url),
    url,
    snippet: normalizeSearchText(snippet),
  };
}

export function extractHost(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      return `${parsed.hostname}:${parsed.port}`;
    }
    return parsed.hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

export function formatResultUrl(url: string, maxLen = 72): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const compact = `${parsed.host}${path}${parsed.search}`;
    return compact.length > maxLen ? `${compact.slice(0, maxLen - 1)}…` : compact;
  } catch {
    return url.length > maxLen ? `${url.slice(0, maxLen - 1)}…` : url;
  }
}

export function parseWebSearchToolResult(
  text: string,
  isError = false,
): WebSearchToolResultView {
  const raw = text || '';

  if (isError || looksLikeToolError(raw)) {
    return {
      isError: true,
      errorText: raw.trim() || undefined,
      query: '',
      count: 0,
      provider: '',
      results: [],
    };
  }

  const queryMatch = raw.match(/搜索:\s*"(.+?)"/);
  const countMatch = raw.match(/结果:\s*(\d+)/);
  const providerMatch = raw.match(/结果:\s*\d+（来源:\s*(.+?)）/);

  const query = queryMatch?.[1]?.trim() || '';
  const count = countMatch ? Number.parseInt(countMatch[1], 10) : 0;
  const provider = providerMatch?.[1]?.trim() || '';

  const hintMatch = raw.match(/提示:\s*(.+?)(?:\n|$)/);
  const hint = hintMatch?.[1]?.trim();

  const bodyStart = raw.indexOf('\n\n');
  let body = bodyStart !== -1 ? raw.slice(bodyStart + 2) : '';
  const hintIndex = body.indexOf('\n提示:');
  if (hintIndex !== -1) {
    body = body.slice(0, hintIndex);
  } else if (body.startsWith('提示:')) {
    body = '';
  }

  const blocks = body
    .split(/\n(?=\d+\.\s)/)
    .map((block) => block.trim())
    .filter((block) => /^\d+\.\s/.test(block));

  const results = blocks
    .map(parseResultBlock)
    .filter((item): item is WebSearchResultItem => item !== null);

  let emptyMessage: string | undefined;
  if (count === 0 || results.length === 0) {
    const emptyBody = body
      .replace(/^\d+\.\s*[\s\S]*/m, '')
      .trim();
    emptyMessage = emptyBody ? normalizeSearchText(emptyBody) : undefined;
  }

  return {
    isError: false,
    query,
    count: Number.isFinite(count) ? count : results.length,
    provider,
    results,
    hint: hint ? normalizeSearchText(hint) : undefined,
    emptyMessage,
  };
}
