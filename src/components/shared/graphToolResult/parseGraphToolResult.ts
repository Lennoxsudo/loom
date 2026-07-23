import type {
  GraphToolName,
  GraphToolResultCodeBlock,
  GraphToolResultSection,
  GraphToolResultStat,
  GraphToolResultTable,
  GraphToolResultViewModel,
  ParseGraphToolResultInput,
} from './types';
import { isGraphToolName } from './types';

function stripCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

function detectGraphToolError(text: string, isError?: boolean): boolean {
  if (isError === true) return true;
  const summary = stripCodeFences(text);
  return (
    summary.startsWith('❌') ||
    summary.includes('错误:') ||
    summary.includes('执行失败') ||
    summary.includes('索引超时') ||
    (summary.includes('代码图谱') && summary.includes('失败')) ||
    summary.toLowerCase().includes('failed') ||
    summary.toLowerCase().includes('error:') ||
    summary.toLowerCase().includes('timeout')
  );
}

function parseHeader(text: string): { tool?: GraphToolName; action?: string; body: string } {
  const match = text.match(/^###\s+(graph_\w+)\s*·\s*(\w+)\s*\n+([\s\S]*)$/);
  if (!match) {
    return { body: text.trim() };
  }
  const tool = isGraphToolName(match[1]) ? match[1] : undefined;
  return { tool, action: match[2], body: match[3].trim() };
}

function parseMarkdownTable(body: string): GraphToolResultTable | undefined {
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIdx = lines.findIndex((line) => line.startsWith('|') && line.endsWith('|'));
  if (headerIdx === -1 || headerIdx + 1 >= lines.length) return undefined;

  const sepLine = lines[headerIdx + 1];
  if (!/^\|[\s\-:|]+\|$/.test(sepLine)) return undefined;

  const headers = lines[headerIdx]
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
  const rows: string[][] = [];

  for (let i = headerIdx + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith('|')) break;
    rows.push(
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim())
    );
  }

  if (headers.length === 0) return undefined;

  const countMatch = body.match(/Found\s+(\d+)\s+/i) || body.match(/Detected\s+(\d+)\s+/i);
  const total = countMatch ? Number(countMatch[1]) : rows.length;

  return { headers, rows, total };
}

function parseCodeBlock(body: string): GraphToolResultCodeBlock | undefined {
  const fenceMatch = body.match(/```(\w*)\n([\s\S]*?)```/);
  if (!fenceMatch) return undefined;

  const fileMatch = body.match(/\*\*File\*\*:\s*(.+?)(?:\s*\(([^)]+)\))?(?:\n|$)/);
  const qnMatch = body.match(/\*\*Qualified name\*\*:\s*(.+?)(?:\n|$)/i);

  return {
    lang: fenceMatch[1] || 'text',
    code: fenceMatch[2].trim(),
    file: fileMatch?.[1]?.trim(),
    range: fileMatch?.[2]?.trim(),
    qualifiedName: qnMatch?.[1]?.trim(),
  };
}

function parseStats(body: string): GraphToolResultStat[] {
  const stats: GraphToolResultStat[] = [];
  const lines = body.split('\n');

  for (const line of lines) {
    const segments = line.split(' · ');
    for (const segment of segments) {
      const match = segment.trim().match(/^\*\*([^*]+)\*\*:\s*(.+)$/);
      if (!match) continue;
      const label = match[1].trim();
      if (label === 'File' || label === 'Qualified name') continue;
      stats.push({ label, value: match[2].trim() });
    }
  }

  return stats;
}

function parseSections(body: string): GraphToolResultSection[] {
  const sections: GraphToolResultSection[] = [];
  const chunks = body.split(/\n\n+/);

  for (const chunk of chunks) {
    const titleMatch = chunk.match(/^\*\*([^*]+)\*\*(?::\s*(.*))?$/m);
    if (!titleMatch) continue;

    const title = titleMatch[1].trim();
    const inline = titleMatch[2]?.trim();
    const rest = chunk.slice(titleMatch[0].length).trim();
    const items: string[] = [];

    if (inline) {
      items.push(inline);
    }

    for (const line of rest.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      items.push(trimmed.replace(/^[-*]\s+/, '').replace(/^`(.+)`/, '$1'));
    }

    if (items.length > 0) {
      sections.push({ title, items });
    }
  }

  return sections;
}

function isEmptyBody(body: string): boolean {
  const normalized = body.trim();
  if (!normalized) return true;
  return (
    /^_(No [^._]+|No data returned)\._$/i.test(normalized) ||
    normalized.includes('No symbols found') ||
    normalized.includes('No results') ||
    normalized.includes('No indexed projects') ||
    normalized.includes('No changes detected') ||
    normalized.includes('No call chain found') ||
    normalized.includes('No code matches found')
  );
}

function truncateMeta(value: string, max = 72): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function buildPanelMeta(toolArgs?: Record<string, unknown>): string | undefined {
  const repoPath = toolArgs?.repo_path ?? toolArgs?.project ?? toolArgs?.path;
  if (typeof repoPath === 'string' && repoPath.trim()) {
    return repoPath.trim();
  }
  return undefined;
}

function enrichSummaryFromArgs(
  tool: GraphToolName,
  action: string,
  summary: string,
  toolArgs?: Record<string, unknown>
): string {
  if (summary.toLowerCase() !== action.toLowerCase()) return summary;

  if (tool === 'graph_query') {
    const query = toolArgs?.query ?? toolArgs?.cypher;
    if (typeof query === 'string' && query.trim()) return truncateMeta(query, 40);
    const pattern = toolArgs?.pattern ?? toolArgs?.name_pattern;
    if (typeof pattern === 'string' && pattern.trim()) return truncateMeta(pattern, 40);
    const qn = toolArgs?.qualified_name;
    if (typeof qn === 'string' && qn.trim()) return truncateMeta(qn, 40);
  }

  if (tool === 'graph_trace') {
    const fn = toolArgs?.function_name ?? toolArgs?.name;
    if (typeof fn === 'string' && fn.trim()) return truncateMeta(fn, 40);
  }

  if (tool === 'graph_index' && (action === 'index' || action === 'status')) {
    return 'Indexed';
  }

  return summary;
}

function countSectionItems(sections: GraphToolResultSection[], titleIncludes: string): number {
  const section = sections.find((item) =>
    item.title.toLowerCase().includes(titleIncludes.toLowerCase())
  );
  if (!section) return 0;
  if (section.items.length === 1 && section.items[0].toLowerCase().includes('none')) return 0;
  return section.items.length;
}

function buildSummary(
  tool: GraphToolName,
  action: string,
  body: string,
  parsed: {
    table?: GraphToolResultTable;
    codeBlock?: GraphToolResultCodeBlock;
    sections: GraphToolResultSection[];
    stats: GraphToolResultStat[];
    isEmpty: boolean;
    isError: boolean;
  }
): string {
  if (parsed.isError) return 'Failed';

  if (parsed.isEmpty) {
    if (tool === 'graph_index' && action === 'list') return 'No indexed projects';
    if (tool === 'graph_trace' && action === 'changes') return 'No changes';
    return 'No results';
  }

  if (tool === 'graph_index') {
    if (action === 'delete') {
      if (body.includes('deleted successfully') || body.includes('✅')) return 'Index deleted';
      if (body.includes('already clean') || body.includes('ℹ️')) return 'Already clean';
    }
    if (action === 'list') {
      const match = body.match(/Found\s+(\d+)\s+indexed project/i);
      if (match) return `${match[1]} project${match[1] === '1' ? '' : 's'}`;
    }
    const indexed = parsed.stats.find((s) => s.label === 'Indexed')?.value;
    const nodes = parsed.stats.find((s) => s.label === 'Nodes')?.value;
    const edges = parsed.stats.find((s) => s.label === 'Edges')?.value;
    if (indexed) {
      const parts = [indexed === 'yes' ? 'Indexed' : 'Not indexed'];
      if (nodes) parts.push(`${nodes} nodes`);
      if (edges) parts.push(`${edges} edges`);
      return parts.join(' · ');
    }
    const status = parsed.stats.find((s) => s.label === 'Status')?.value;
    if (status) {
      if (status.toLowerCase() === 'indexed') return 'Indexed';
      return status;
    }
    if (action === 'index') return 'Indexed';
  }

  if (tool === 'graph_query') {
    if (action === 'snippet' && parsed.codeBlock?.file) {
      const base = parsed.codeBlock.file.split(/[\\/]/).pop() || parsed.codeBlock.file;
      return parsed.codeBlock.qualifiedName ? `${base} · ${parsed.codeBlock.qualifiedName}` : base;
    }
    if (parsed.table) {
      const noun = action === 'code' ? 'match' : action === 'search' ? 'symbol' : 'result';
      const count = parsed.table.total;
      return `${count} ${noun}${count === 1 ? '' : 's'}`;
    }
    if (action === 'schema') {
      const labels = parsed.sections.find((s) => s.title.toLowerCase().includes('node labels'));
      const edges = parsed.sections.find((s) => s.title.toLowerCase().includes('edge types'));
      const parts: string[] = [];
      if (labels) parts.push(`${labels.items.length} labels`);
      if (edges) parts.push(`${edges.items.length} edge types`);
      if (parts.length > 0) return parts.join(' · ');
    }
  }

  if (tool === 'graph_trace') {
    if (action === 'trace') {
      const inbound = countSectionItems(parsed.sections, 'inbound');
      const outbound = countSectionItems(parsed.sections, 'outbound');
      return `Inbound ${inbound} · Outbound ${outbound}`;
    }
    if (action === 'architecture') {
      const nodes = parsed.stats.find((s) => s.label === 'Nodes')?.value;
      const edges = parsed.stats.find((s) => s.label === 'Edges')?.value;
      if (nodes || edges) {
        return [nodes ? `${nodes} nodes` : '', edges ? `${edges} edges` : '']
          .filter(Boolean)
          .join(' · ');
      }
    }
    if (action === 'changes') {
      const match = body.match(/Detected\s+(\d+)\s+changed file/i);
      if (match) return `${match[1]} changed file${match[1] === '1' ? '' : 's'}`;
      const listSection = parsed.sections[0];
      if (listSection)
        return `${listSection.items.length} changed file${listSection.items.length === 1 ? '' : 's'}`;
    }
  }

  const foundMatch = body.match(/Found\s+(\d+)\s+\w+/i);
  if (foundMatch) return `${foundMatch[1]} results`;

  return action;
}

export function parseGraphToolResult(
  input: ParseGraphToolResultInput
): GraphToolResultViewModel | null {
  const toolFromName = isGraphToolName(input.toolName) ? input.toolName : undefined;
  if (!toolFromName && !input.text.includes('graph_')) return null;

  const { tool: toolFromHeader, action: actionFromHeader, body } = parseHeader(input.text);
  const tool = toolFromName ?? toolFromHeader;
  if (!tool) return null;

  const actionFromArgs = typeof input.toolArgs?.action === 'string' ? input.toolArgs.action : '';
  const action = actionFromHeader || actionFromArgs || 'unknown';
  const isError = detectGraphToolError(input.text, input.isError);
  const isEmpty = !isError && isEmptyBody(body);

  const table = parseMarkdownTable(body);
  const codeBlock = parseCodeBlock(body);
  const stats = parseStats(body);
  const sections = parseSections(body);

  const hasStructured = Boolean(table || codeBlock || stats.length > 0 || sections.length > 0);

  let rawBody: string | undefined;
  if (!hasStructured && body.trim()) {
    rawBody = body;
  }

  if (
    tool === 'graph_trace' &&
    action === 'changes' &&
    !table &&
    sections.length === 0 &&
    body.includes('- `')
  ) {
    const items = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.replace(/^-\s+/, ''));
    if (items.length > 0) {
      sections.push({ title: 'Changed files', items });
    }
  }

  const summary = enrichSummaryFromArgs(
    tool,
    action,
    buildSummary(tool, action, body, {
      table,
      codeBlock,
      sections,
      stats,
      isEmpty,
      isError,
    }),
    input.toolArgs
  );

  return {
    tool,
    action,
    isError,
    summary,
    panelMeta: buildPanelMeta(input.toolArgs),
    isEmpty,
    stats: stats.length > 0 ? stats : undefined,
    table,
    codeBlock,
    sections: sections.length > 0 ? sections : undefined,
    rawBody,
  };
}
