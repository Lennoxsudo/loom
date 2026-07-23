export type SearchBothSummary = {
  query: string;
  fileCount: number | null;
  placeCount: number | null;
  noMatches: boolean;
  expandable: boolean;
};

export type BgTaskEntry = {
  id: string;
  command: string;
  status: 'running' | 'completed' | string;
  detail: string;
};

export type ListBgTasksSummary = {
  total: number;
  running: number;
  completed: number;
  empty: boolean;
  tasks: BgTaskEntry[];
};

export type KillBgTaskSummary = {
  taskId: string;
  terminated: boolean;
};

export function shortenId(id: string, maxLen = 16): string {
  if (id.length <= maxLen) return id;
  return id.slice(0, maxLen) + '…';
}

function extractQuotedQuery(text: string): string | null {
  const match =
    text.match(/未找到匹配\s*"([^"]+)"/) || text.match(/找到\s*\d+\s*个文件包含\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

export function summarizeSearchBoth(
  text: string,
  args?: Record<string, unknown>
): SearchBothSummary {
  const queryFromArgs =
    (typeof args?.query === 'string' && args.query) ||
    (typeof args?.pattern === 'string' && args.pattern) ||
    extractQuotedQuery(text) ||
    '';

  const noMatches = /未找到匹配/i.test(text);
  const fileMatch = text.match(/文件名匹配\s*\((\d+)\s*个\)/);
  const placeMatch = text.match(/找到\s*(\d+)\s*个文件包含/);

  const fileCount = fileMatch ? parseInt(fileMatch[1], 10) : noMatches ? null : 0;
  const placeCount = placeMatch ? parseInt(placeMatch[1], 10) : noMatches ? null : 0;

  const hasFileSection = fileMatch !== null || /^- /m.test(text.split('---')[0] ?? text);
  const hasContentSection = placeMatch !== null || /^📄 /m.test(text);
  const expandable = !noMatches && text.trim().length > 0 && (hasFileSection || hasContentSection);

  return {
    query: queryFromArgs,
    fileCount,
    placeCount,
    noMatches,
    expandable,
  };
}

const BG_TASK_LINE_RE = /^- (\S+):\s*"([^"]*)"\s*\[(\w+)([^\]]*)\]/;

export function parseBgTaskLines(text: string): BgTaskEntry[] {
  const entries: BgTaskEntry[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(BG_TASK_LINE_RE);
    if (!match) continue;
    entries.push({
      id: match[1],
      command: match[2],
      status: match[3],
      detail: match[4].trim(),
    });
  }
  return entries;
}

export function summarizeListBgTasks(text: string): ListBgTasksSummary {
  const empty = /No background tasks\.?/i.test(text.trim());
  const tasks = parseBgTaskLines(text);
  const running = tasks.filter((t) => t.status === 'running').length;
  const completed = tasks.filter((t) => t.status === 'completed').length;

  return {
    total: tasks.length,
    running,
    completed,
    empty,
    tasks,
  };
}

export function summarizeKillBgTask(
  text: string,
  args?: Record<string, unknown>
): KillBgTaskSummary {
  const fromArgs =
    (typeof args?.terminal_id === 'string' && args.terminal_id) ||
    (typeof args?.tid === 'string' && args.tid) ||
    '';

  const fromText = text.match(/Background task\s+(\S+)\s+has been terminated/i)?.[1] ?? '';

  return {
    taskId: fromArgs || fromText,
    terminated: /has been terminated/i.test(text),
  };
}
