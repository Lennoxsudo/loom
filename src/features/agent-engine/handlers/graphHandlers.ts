/**
 * Built-in code knowledge graph (CBM) tool handlers.
 */

import { invokeWithTimeout } from '../../../utils/cbmRuntime';
import type { ToolResult } from '../../../types/ai';
import type { ToolHandler, ToolContext } from '../types';
import type { GraphIndexArgs, GraphQueryArgs, GraphTraceArgs } from '../toolArgs';
import { ToolError, ToolErrorCode, handleToolError } from '../errors';
import { resolvePathWithBaseDir } from '../argsParser';
import {
  formatCbmQueryCell,
  formatGraphQueryValidationHint,
  isAggregateSchemaIntent,
  isLabelsTypesSchemaIntent,
  normalizeCbmCypher,
  normalizeGraphQueryArgs,
  sanitizeCbmQualifiedName,
} from '../graphQueryNormalize';

export const GRAPH_TOOLS = new Set(['graph_index', 'graph_query', 'graph_trace']);

const GRAPH_INDEX_ACTIONS = new Set(['index', 'status', 'list', 'delete']);
const GRAPH_QUERY_ACTIONS = new Set(['search', 'snippet', 'query', 'schema', 'code', 'list']);
const GRAPH_TRACE_ACTIONS = new Set(['trace', 'architecture', 'changes']);

// Frontend timeouts must be > Rust timeouts to ensure Rust returns first.
// Rust: INDEX_TIMEOUT=1800s (30min), DEFAULT_TIMEOUT=60s.
const GRAPH_INDEX_TIMEOUT_MS = 31 * 60 * 1000; // 31min > Rust 30min
const GRAPH_QUERY_TIMEOUT_MS = 90 * 1000; // 90s > Rust 60s

async function invokeCbmRaw(
  tool: 'graph_index' | 'graph_query' | 'graph_trace',
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<string> {
  const repoPathRaw = (args.repo_path as string | undefined) ?? context?.baseDir;
  const repo_path = repoPathRaw
    ? resolvePathWithBaseDir(repoPathRaw, context?.baseDir)
    : context?.baseDir;

  const { action, ...rest } = args;
  const payload: Record<string, unknown> = { ...rest };

  if (!payload.project && typeof payload.project_id === 'string') {
    payload.project = payload.project_id;
  }
  delete payload.project_id;

  if (action !== 'list' && repo_path?.trim()) {
    payload.repo_path = repo_path;
  }

  delete payload._code_property_rewrite;

  if (tool === 'graph_query' && action === 'query' && typeof payload.query === 'string') {
    const normalized = normalizeCbmCypher(payload.query);
    if (normalized.hint) {
      throw new ToolError(
        ToolErrorCode.INVALID_PARAM,
        normalized.hint,
        true,
      );
    }
    payload.query = normalized.query;
  }

  const timeout = tool === 'graph_index' ? GRAPH_INDEX_TIMEOUT_MS : GRAPH_QUERY_TIMEOUT_MS;

  return invokeWithTimeout<string>(
    'cbm_graph',
    { tool, action: String(action), payload },
    timeout,
  );
}

async function invokeCbm(
  tool: 'graph_index' | 'graph_query' | 'graph_trace',
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<ToolResult> {
  const action = String(args.action);
  const timeout = tool === 'graph_index' ? GRAPH_INDEX_TIMEOUT_MS : GRAPH_QUERY_TIMEOUT_MS;

  try {
    const raw = await invokeCbmRaw(tool, args, context);
    return {
      tool_call_id: '',
      output: formatGraphOutput(tool, action, raw),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('timeout')) {
      return {
        tool_call_id: '',
        output: '',
        error: tool === 'graph_index'
          ? `代码图谱索引超时（${Math.round(timeout / 1000)}s）。索引可能仍在后台进行，稍后可用 graph_index action=status 检查。`
          : `代码图谱查询超时（${Math.round(timeout / 1000)}s）。`,
      };
    }
    // CBM CLI Cypher lexer errors (e.g. "expected token type 0, got 85 at pos 0")
    // occur when the query is not valid Cypher. Guide the AI to use MATCH syntax.
    if (tool === 'graph_query' && action === 'query') {
      if (msg.includes('expected token type') || msg.includes('CALL')) {
        return {
          tool_call_id: '',
          output: '',
          error:
            'Cypher 语法错误。查询必须以 MATCH 开头；RETURN 可用 labels(n)、type(r)、n.label、r.type。' +
            ' 不支持 CALL db.*() — 请用 action=schema。' +
            ' 示例: MATCH (f:Function) WHERE f.name =~ ".*send.*" RETURN f.name, f.file_path LIMIT 10',
        };
      }
    }
    return {
      tool_call_id: '',
      output: '',
      error: msg,
    };
  }
}

/** P2: extract first qualified_name from raw CBM search_graph JSON. */
export function extractFirstQualifiedNameFromSearchRaw(raw: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const results = extractArray(parsed, ['results', 'symbols', 'matches', 'nodes']);
  if (!results || results.length === 0) return undefined;
  const first = results[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const obj = first as Record<string, unknown>;
  return strVal(obj.qualified_name ?? obj.full_name);
}

function symbolMatchesNamePattern(name: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return true;
  try {
    return new RegExp(trimmed).test(name);
  } catch {
    return name === trimmed || name.includes(trimmed);
  }
}

/** Collect symbol names from search_graph JSON for code-search pre-filtering. */
export function extractSymbolNamesFromSearchRaw(raw: string): Set<string> {
  const names = new Set<string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return names;
  }
  const results = extractArray(parsed, ['results', 'symbols', 'matches', 'nodes']);
  if (!results) return names;
  for (const item of results) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    for (const key of ['name', 'qualified_name', 'full_name']) {
      const val = strVal(obj[key]);
      if (val) names.add(val);
    }
  }
  return names;
}

/** Keep only search_code hits whose symbol name matches name_pattern. */
export function filterCodeSearchRawByNamePattern(raw: string, namePattern: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (typeof parsed !== 'object' || parsed === null) return raw;
  const obj = parsed as Record<string, unknown>;
  const results = extractArray(obj, ['results']);
  if (!results) return raw;

  const filtered = results.filter((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const row = item as Record<string, unknown>;
    const node = strVal(row.node ?? row.name) ?? '';
    return symbolMatchesNamePattern(node, namePattern);
  });

  return JSON.stringify({ ...obj, results: filtered });
}

// ── formatGraphOutput: structured markdown for model readability ──

export function formatGraphOutput(tool: string, action: string, raw: string): string {
  const header = `### ${tool} · ${action}`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `${header}\n\n${raw}`;
  }

  const body = formatGraphBody(tool, action, parsed);
  return `${header}\n\n${body}`;
}

function formatGraphBody(tool: string, action: string, data: unknown): string {
  if (data == null) return '_No data returned._';
  switch (tool) {
    case 'graph_index':
      return formatIndex(action, data);
    case 'graph_query':
      return formatQuery(action, data);
    case 'graph_trace':
      return formatTrace(action, data);
    default:
      return jsonBlock(data);
  }
}

// ── graph_index ──

function formatIndex(action: string, data: unknown): string {
  switch (action) {
    case 'index':
    case 'status':
      return formatIndexStatus(data);
    case 'list':
      return formatProjectList(data);
    case 'delete':
      return formatDeleteResult(data);
    default:
      return jsonBlock(data);
  }
}

function formatIndexStatus(data: unknown): string {
  if (typeof data !== 'object' || data === null) return jsonBlock(data);
  const obj = data as Record<string, unknown>;

  const lines: string[] = [];
  const indexed = obj.indexed as boolean | undefined;
  const status = strVal(obj.status);

  if (indexed !== undefined) {
    lines.push(`**Indexed**: ${indexed ? 'yes' : 'no'}`);
  } else if (status) {
    lines.push(`**Status**: ${status}`);
  }

  const nodes = numVal(obj.node_count ?? obj.nodes);
  const edges = numVal(obj.edge_count ?? obj.edges);
  if (nodes !== undefined || edges !== undefined) {
    const parts: string[] = [];
    if (nodes !== undefined) parts.push(`**Nodes**: ${nodes.toLocaleString()}`);
    if (edges !== undefined) parts.push(`**Edges**: ${edges.toLocaleString()}`);
    lines.push(parts.join(' · '));
  }

  const indexedAt = strVal(obj.indexed_at ?? obj.created_at);
  if (indexedAt) lines.push(`**Indexed at**: ${indexedAt}`);

  const msg = strVal(obj.message ?? obj.error);
  if (msg) lines.push(`**Message**: ${msg}`);

  return lines.length > 0 ? lines.join('\n') : jsonBlock(data);
}

function formatIndexedAt(val: unknown): string {
  const s = strVal(val);
  if (!s) return '—';
  const ms = Date.parse(s);
  if (!Number.isNaN(ms)) {
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  }
  return s;
}

function formatProjectList(data: unknown): string {
  const projects = extractArray(data, ['projects', 'results']);
  if (!projects) return jsonBlock(data);
  if (projects.length === 0) return '_No indexed projects._';

  const rows = projects.map((p) => {
    const obj = (p ?? {}) as Record<string, unknown>;
    const slug = strVal(obj.name ?? obj.project ?? obj.slug) ?? '—';
    const path =
      strVal(obj.repo_path ?? obj.root_path ?? obj.path ?? obj.root ?? obj.project_path) ?? '—';
    const nodes = numVal(obj.node_count ?? obj.nodes);
    const edges = numVal(obj.edge_count ?? obj.edges);
    const indexedAt = formatIndexedAt(obj.indexed_at ?? obj.created_at ?? obj.last_indexed_at);
    return `| ${slug} | ${path} | ${nodes ?? '—'} | ${edges ?? '—'} | ${indexedAt} |`;
  });

  return (
    `Found ${projects.length} indexed project(s):\n\n` +
    '| Project (slug) | Path | Nodes | Edges | Indexed At |\n' +
    '|----------------|------|-------|-------|------------|\n' +
    rows.join('\n') +
    '\n\n_Use `project` param with the slug column when path→slug auto-resolve fails._'
  );
}

function formatDeleteResult(data: unknown): string {
  if (typeof data !== 'object' || data === null) return jsonBlock(data);
  const obj = data as Record<string, unknown>;

  const deleted = obj.deleted as boolean | undefined;
  const status = strVal(obj.status);

  if (deleted === true || status === 'deleted') return '✅ Index deleted successfully.';
  if (deleted === false || status === 'not_found') return 'ℹ️ No index found (already clean).';
  return jsonBlock(data);
}

// ── graph_query ──

function formatQuery(action: string, data: unknown): string {
  switch (action) {
    case 'search':
      return formatSearchResults(data);
    case 'snippet':
      return formatSnippet(data);
    case 'query':
      return formatQueryResults(data);
    case 'schema':
      return formatSchema(data);
    case 'code':
      return formatCodeSearch(data);
    case 'list':
      return formatProjectList(data);
    default:
      return jsonBlock(data);
  }
}

function formatSearchResults(data: unknown): string {
  const results = extractArray(data, ['results', 'symbols', 'matches', 'nodes']);
  if (!results) return jsonBlock(data);
  if (results.length === 0) return '_No symbols found._';

  const rows = results.map((r) => {
    const obj = (r ?? {}) as Record<string, unknown>;
    const name = strVal(obj.name ?? obj.qualified_name) ?? '—';
    const label = strVal(obj.label ?? obj.type ?? obj.kind) ?? '—';
    const file = strVal(obj.file ?? obj.file_path ?? obj.path) ?? '—';
    const line = numVal(obj.line ?? obj.start_line);
    const qnRaw = strVal(obj.qualified_name ?? obj.full_name) ?? '';
    const qn = qnRaw ? sanitizeCbmQualifiedName(qnRaw) : '';
    return `| ${name} | ${label} | ${file} | ${line ?? '—'} | ${qn} |`;
  });

  return (
    `Found ${results.length} symbol(s):\n\n` +
    '| Name | Type | File | Line | Qualified Name |\n' +
    '|------|------|------|------|----------------|\n' +
    rows.join('\n')
  );
}

function formatSnippet(data: unknown): string {
  if (typeof data !== 'object' || data === null) return jsonBlock(data);
  const obj = data as Record<string, unknown>;

  const code = strVal(obj.code ?? obj.snippet ?? obj.content);
  if (!code) return jsonBlock(data);

  const file = strVal(obj.file ?? obj.file_path ?? obj.path);
  const startLine = numVal(obj.start_line ?? obj.line);
  const endLine = numVal(obj.end_line);
  const qnRaw = strVal(obj.qualified_name ?? obj.full_name);
  const qn = qnRaw ? sanitizeCbmQualifiedName(qnRaw) : undefined;

  const lines: string[] = [];
  if (file) {
    const range =
      startLine && endLine ? ` (lines ${startLine}–${endLine})`
      : startLine ? ` (line ${startLine})`
      : '';
    lines.push(`**File**: ${file}${range}`);
  }
  if (qn) lines.push(`**Qualified name**: ${qn}`);
  lines.push(`\n\`\`\`${inferLang(file)}\n${code}\n\`\`\``);

  return lines.join('\n');
}

function formatQueryResults(data: unknown): string {
  if (typeof data !== 'object' || data === null) return jsonBlock(data);
  const obj = data as Record<string, unknown>;

  // CBM CLI query_graph returns {"columns":[...], "rows":[[...]]} format.
  const columns = extractArray(obj, ['columns']);
  const rows = extractArray(obj, ['rows']);
  if (columns && rows) {
    const colNames = columns.map((c) => strVal(c) ?? String(c));
    if (colNames.length === 0) return '_No columns returned._';
    if (rows.length === 0) return '_No results._';
    const header = `| ${colNames.join(' | ')} |`;
    const sep = `| ${colNames.map(() => '---').join(' | ')} |`;
    const tableRows = rows.map((r) => {
      const arr = Array.isArray(r) ? r : [r];
      return `| ${colNames.map((_, i) => formatCbmQueryCell(arr[i], colNames[i])).join(' | ')} |`;
    });
    return `Found ${rows.length} result(s):\n\n${header}\n${sep}\n${tableRows.join('\n')}`;
  }

  // Fallback: results as array of objects.
  const results = extractArray(data, ['results', 'data']);
  if (!results) return jsonBlock(data);
  if (results.length === 0) return '_No results._';

  const first = results[0] as Record<string, unknown>;
  if (typeof first !== 'object' || first === null) return jsonBlock(data);

  const keys = Object.keys(first);
  const header = `| ${keys.join(' | ')} |`;
  const sep = `| ${keys.map(() => '---').join(' | ')} |`;
  const tableRows = results.map((r) => {
    const rObj = (r ?? {}) as Record<string, unknown>;
    return `| ${keys.map((k) => formatCbmQueryCell(rObj[k], k)).join(' | ')} |`;
  });

  return `Found ${results.length} result(s):\n\n${header}\n${sep}\n${tableRows.join('\n')}`;
}

function formatSchema(data: unknown): string {
  if (typeof data !== 'object' || data === null) return jsonBlock(data);
  const obj = data as Record<string, unknown>;

  const sections: string[] = [];

  const nodeLabels = extractArray(obj, ['node_labels']);
  if (nodeLabels && nodeLabels.length > 0) {
    const lines = nodeLabels.map((l) => {
      const lo = l as Record<string, unknown>;
      const label = strVal(lo.label) ?? '?';
      const count = numVal(lo.count);
      const props = extractArray(lo, ['properties']);
      const propStr = props ? props.map((p) => strVal(p) ?? String(p)).join(', ') : '';
      return `- **${label}** (${count ?? '?'}): ${propStr}`;
    });
    sections.push(`**Node labels** (${nodeLabels.length}):\n${lines.join('\n')}`);
  }

  const edgeTypes = extractArray(obj, ['edge_types']);
  if (edgeTypes && edgeTypes.length > 0) {
    const lines = edgeTypes.map((e) => {
      const eo = e as Record<string, unknown>;
      const type = strVal(eo.type) ?? '?';
      const count = numVal(eo.count);
      return `- **${type}** (${count ?? '?'})`;
    });
    sections.push(`**Edge types** (${edgeTypes.length}):\n${lines.join('\n')}`);
  }

  return sections.length > 0
    ? sections.join('\n\n') + '\n\n_Use these labels and properties in MATCH/WHERE clauses._'
    : jsonBlock(data);
}

function formatCodeSearch(data: unknown): string {
  if (typeof data !== 'object' || data === null) return jsonBlock(data);
  const obj = data as Record<string, unknown>;

  const results = extractArray(obj, ['results']);
  if (!results) return jsonBlock(data);
  if (results.length === 0) {
    const totalGrep = numVal(obj.total_grep_matches);
    if (totalGrep === 0) {
      return (
        '_No code matches found._\n\n' +
        '`action=code` searches within indexed **symbol bodies** (function/method/class source), ' +
        'not file-level statements like `import` or `export`. For import patterns, use `action=search` ' +
        'with `name_pattern`, or `action=snippet` with `qualified_name`. Try `file_pattern` to narrow scope.'
      );
    }
    return '_No code matches found (grep hits were deduplicated away). Try a narrower `pattern` or raise `limit`._';
  }

  const totalGrep = numVal(obj.total_grep_matches);
  const dedupRatio = strVal(obj.dedup_ratio);

  const rows = results.map((r) => {
    const ro = (r ?? {}) as Record<string, unknown>;
    const node = strVal(ro.node ?? ro.name) ?? '—';
    const label = strVal(ro.label ?? ro.type) ?? '—';
    const file = strVal(ro.file ?? ro.file_path) ?? '—';
    const startLine = numVal(ro.start_line);
    const endLine = numVal(ro.end_line);
    const matchLines = extractArray(ro, ['match_lines']);
    const matchStr = matchLines ? matchLines.join(',') : (startLine ?? '—');
    const range = startLine && endLine ? `${startLine}-${endLine}` : (startLine ?? '—');
    return `| ${node} | ${label} | ${file} | ${range} | ${matchStr} |`;
  });

  const summary = `Found ${results.length} symbol(s)${totalGrep ? ` (${totalGrep} grep matches${dedupRatio ? `, ${dedupRatio} dedup` : ''})` : ''}:\n\n`;
  return summary +
    '| Name | Type | File | Lines | Match Lines |\n' +
    '|------|------|------|-------|-------------|\n' +
    rows.join('\n');
}

// ── graph_trace ──

function formatTrace(action: string, data: unknown): string {
  switch (action) {
    case 'trace':
      return formatTraceResult(data);
    case 'architecture':
      return formatArchitecture(data);
    case 'changes':
      return formatChanges(data);
    default:
      return jsonBlock(data);
  }
}

function formatTraceResult(data: unknown): string {
  if (typeof data !== 'object' || data === null) return jsonBlock(data);
  const obj = data as Record<string, unknown>;

  const callers = extractArray(obj, ['callers', 'inbound', 'upstream']);
  const callees = extractArray(obj, ['callees', 'outbound', 'downstream']);

  if (callers || callees) {
    const callersEmpty = !callers || callers.length === 0;
    const calleesEmpty = !callees || callees.length === 0;
    if (callersEmpty && calleesEmpty) {
      return formatTraceEmptyHint(obj);
    }

    const sections: string[] = [];
    if (callers) {
      sections.push(
        callers.length > 0
          ? `**Inbound (callers):**\n${formatNodeList(callers)}`
          : '**Inbound (callers):** _None_',
      );
    }
    if (callees) {
      sections.push(
        callees.length > 0
          ? `**Outbound (callees):**\n${formatNodeList(callees)}`
          : '**Outbound (callees):** _None_',
      );
    }
    return sections.join('\n\n');
  }

  const nodes = extractArray(obj, ['nodes', 'paths']);
  if (nodes) {
    if (nodes.length === 0) return formatTraceEmptyHint(obj);
    return `**Call chain:**\n${formatNodeList(nodes)}`;
  }

  return jsonBlock(data);
}

function formatTraceEmptyHint(obj: Record<string, unknown>): string {
  const fn = strVal(obj.function ?? obj.function_name) ?? 'target';
  return (
    `**Inbound (callers):** _None_\n\n**Outbound (callees):** _None_\n\n` +
    `> No CALLS edges for \`${fn}\`. TS/Vue repos often only have DEFINES/IMPORTS. ` +
    `Loom will try a fallback query for other edge types; if still empty, run ` +
    `\`graph_query search\` to resolve the exact name, then ` +
    `\`graph_query query\` with \`MATCH (a)-[r]->(f:Function {name: '${fn}'}) RETURN type(r) AS rel, a.name LIMIT 20\`.`
  );
}

function formatArchitecture(data: unknown): string {
  if (typeof data !== 'object' || data === null) return jsonBlock(data);
  const obj = data as Record<string, unknown>;

  const sections: string[] = [];

  // Summary stats
  const totalNodes = numVal(obj.total_nodes ?? obj.node_count);
  const totalEdges = numVal(obj.total_edges ?? obj.edge_count);
  if (totalNodes !== undefined || totalEdges !== undefined) {
    const parts: string[] = [];
    if (totalNodes !== undefined) parts.push(`**Nodes**: ${totalNodes.toLocaleString()}`);
    if (totalEdges !== undefined) parts.push(`**Edges**: ${totalEdges.toLocaleString()}`);
    sections.push(parts.join(' · '));
  }

  const languages = extractArray(obj, ['languages']);
  if (languages && languages.length > 0) {
    const langStrs = languages.map((l) => {
      if (typeof l === 'string') return l;
      const lo = l as Record<string, unknown>;
      const name = strVal(lo.language ?? lo.name) ?? '?';
      const count = numVal(lo.file_count ?? lo.count);
      return count !== undefined ? `${name} (${count})` : name;
    });
    sections.push(`**Languages**: ${langStrs.join(', ')}`);
  }

  // Node labels (CBM format: [{"label":"Function","count":19}, ...])
  const nodeLabels = extractArray(obj, ['node_labels']);
  if (nodeLabels && nodeLabels.length > 0) {
    const labelStrs = nodeLabels.map((l) => {
      const lo = l as Record<string, unknown>;
      const label = strVal(lo.label ?? lo.name) ?? '?';
      const count = numVal(lo.count);
      return count !== undefined ? `${label} (${count})` : label;
    });
    sections.push(`**Node labels**: ${labelStrs.join(', ')}`);
  }

  // Edge types (CBM format: [{"type":"DEFINES","count":163}, ...])
  const edgeTypes = extractArray(obj, ['edge_types']);
  if (edgeTypes && edgeTypes.length > 0) {
    const edgeStrs = edgeTypes.map((e) => {
      const eo = e as Record<string, unknown>;
      const type = strVal(eo.type ?? eo.name) ?? '?';
      const count = numVal(eo.count);
      return count !== undefined ? `${type} (${count})` : type;
    });
    sections.push(`**Edge types**: ${edgeStrs.join(', ')}`);
  }

  // Packages
  const packages = extractArray(obj, ['packages']);
  if (packages && packages.length > 0) {
    sections.push(`**Packages** (${packages.length}):\n${formatSimpleList(packages)}`);
  }

  // Entry points (CBM format: [{"name":"formatPrice","qualified_name":"...","file":"..."}, ...])
  const entryPoints = extractArray(obj, ['entry_points']);
  if (entryPoints && entryPoints.length > 0) {
    const epStrs = entryPoints.map((ep) => {
      const eo = ep as Record<string, unknown>;
      const name = strVal(eo.name ?? eo.qualified_name) ?? '?';
      const file = strVal(eo.file ?? eo.file_path);
      return file ? `- \`${name}\` — ${file}` : `- \`${name}\``;
    });
    sections.push(`**Entry points** (${entryPoints.length}):\n${epStrs.join('\n')}`);
  }

  // Layers (CBM format: [{"name":"data","layer":"internal","reason":"fan-in=0, fan-out=0"}, ...])
  const layers = extractArray(obj, ['layers']);
  if (layers && layers.length > 0) {
    const layerStrs = layers.map((l) => {
      const lo = l as Record<string, unknown>;
      const name = strVal(lo.name) ?? '?';
      const layer = strVal(lo.layer);
      const reason = strVal(lo.reason);
      return `- \`${name}\` (${layer}${reason ? `, ${reason}` : ''})`;
    });
    sections.push(`**Layers** (${layers.length}):\n${layerStrs.join('\n')}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : jsonBlock(data);
}

function formatChanges(data: unknown): string {
  if (typeof data !== 'object' || data === null) return jsonBlock(data);
  const obj = data as Record<string, unknown>;

  // CBM CLI detect_changes returns {"changed_files": ["path1", "path2", ...]} format.
  const changedFiles = extractArray(obj, ['changed_files']);
  if (changedFiles) {
    if (changedFiles.length === 0) return '_No changes detected._';
    const fileList = changedFiles.map((f) => `- \`${strVal(f) ?? String(f)}\``);
    return `Detected ${changedFiles.length} changed file(s):\n${fileList.join('\n')}`;
  }

  // Fallback: structured changes with impact analysis.
  const changes = extractArray(obj, ['changes', 'impacts', 'results']);
  if (!changes) return jsonBlock(data);
  if (changes.length === 0) return '_No changes detected._';

  const lines = changes.map((c) => {
    const cObj = (c ?? {}) as Record<string, unknown>;
    const file = strVal(cObj.file ?? cObj.file_path ?? cObj.path) ?? '—';
    const type = strVal(cObj.type ?? cObj.change_type ?? cObj.kind) ?? '—';
    const impact = extractArray(cObj, ['impacted_functions', 'impacts', 'functions']);
    const impactStr =
      impact && impact.length > 0
        ? ` → ${impact
            .map((i) =>
              strVal(typeof i === 'object' && i !== null ? (i as Record<string, unknown>).name : i) ??
                String(i),
            )
            .join(', ')}`
        : '';
    return `- ${file} (${type})${impactStr}`;
  });

  return `Detected ${changes.length} change(s):\n${lines.join('\n')}`;
}

/** Filter detect_changes output by optional file path hint; drops vendor paths by default. */
export function filterDetectChangesRaw(
  raw: string,
  fileHint?: string,
  options?: { excludeVendor?: boolean },
): string {
  const excludeVendor = options?.excludeVendor !== false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (typeof parsed !== 'object' || parsed === null) return raw;
  const obj = parsed as Record<string, unknown>;
  const files = extractArray(obj, ['changed_files']);
  if (!files) return raw;

  const hint = fileHint?.trim().toLowerCase();
  const filtered = files.filter((f) => {
    const path = String(f).replace(/\\/g, '/');
    if (
      excludeVendor
      && /(?:^|\/)(?:node_modules|vendor|dist)(?:\/|$)/i.test(path)
    ) {
      return false;
    }
    if (!hint) return true;
    const base = path.split('/').pop()?.toLowerCase() ?? path.toLowerCase();
    return path.toLowerCase().includes(hint) || base.includes(hint);
  });

  return JSON.stringify({ ...obj, changed_files: filtered });
}

// ── helpers ──

function jsonBlock(data: unknown): string {
  return `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}

function extractArray(data: unknown, keys: string[]): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  for (const key of keys) {
    const val = obj[key];
    if (Array.isArray(val)) return val;
  }
  return null;
}

function strVal(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return undefined;
}

function numVal(val: unknown): number | undefined {
  if (typeof val === 'number') return val;
  if (typeof val === 'string' && /^\d+$/.test(val)) return parseInt(val, 10);
  return undefined;
}

/**
 * Parse CBM CLI query_graph response {"columns":[...],"rows":[[...]]} into an
 * array of row arrays. Returns empty array if parsing fails or no rows.
 */
function parseColumnsRows(raw: string): unknown[][] {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const rows = extractArray(parsed, ['rows']);
    if (!rows) return [];
    return rows.map((r) => (Array.isArray(r) ? r : [r]));
  } catch {
    return [];
  }
}

function formatNodeList(nodes: unknown[]): string {
  return nodes
    .map((n) => {
      if (typeof n === 'string') return `- \`${n}\``;
      if (typeof n !== 'object' || n === null) return `- ${String(n)}`;
      const obj = n as Record<string, unknown>;
      const name = strVal(obj.name ?? obj.qualified_name ?? obj.function_name ?? obj.id) ?? '—';
      const file = strVal(obj.file ?? obj.file_path ?? obj.path);
      const line = numVal(obj.line ?? obj.start_line);
      const loc = file ? ` — ${file}${line ? `:${line}` : ''}` : '';
      return `- \`${name}\`${loc}`;
    })
    .join('\n');
}

function formatSimpleList(items: unknown[]): string {
  return items
    .map((item) => {
      if (typeof item === 'string') return `- ${item}`;
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        const name = strVal(obj.name ?? obj.id ?? obj.path) ?? JSON.stringify(item);
        const extra = strVal(obj.count ?? obj.size ?? obj.description);
        return `- ${name}${extra ? ` (${extra})` : ''}`;
      }
      return `- ${String(item)}`;
    })
    .join('\n');
}

function inferLang(file?: string): string {
  if (!file) return '';
  const ext = file.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    rs: 'rust', ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
    cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
    vue: 'vue', svelte: 'svelte', css: 'css', scss: 'scss', html: 'html',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown',
  };
  return map[ext ?? ''] ?? '';
}

class GraphIndexHandler implements ToolHandler<'graph_index'> {
  name = 'graph_index' as const;

  async execute(args: GraphIndexArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!GRAPH_INDEX_ACTIONS.has(args.action)) {
        throw ToolError.invalidParam('action', `unsupported action: ${args.action}`);
      }
      if (args.action !== 'list' && !args.repo_path && !context?.baseDir && !args.project) {
        throw ToolError.missingParam('repo_path');
      }
      return invokeCbm('graph_index', args as Record<string, unknown>, context);
    } catch (error) {
      return handleToolError(error);
    }
  }
}

class GraphQueryHandler implements ToolHandler<'graph_query'> {
  name = 'graph_query' as const;

  async execute(args: GraphQueryArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      const normalized = normalizeGraphQueryArgs(args as Record<string, unknown>) as GraphQueryArgs;
      if (!GRAPH_QUERY_ACTIONS.has(normalized.action)) {
        throw ToolError.invalidParam('action', `unsupported action: ${normalized.action}`);
      }
      if (normalized.action === 'list') {
        const raw = await invokeCbmRaw('graph_index', { action: 'list' }, context);
        return {
          tool_call_id: '',
          output: formatGraphOutput('graph_query', 'list', raw),
        };
      }
      if (normalized.action === 'snippet' && !normalized.qualified_name?.trim()) {
        if (!normalized.name_pattern?.trim()) {
          throw ToolError.invalidParam(
            'qualified_name',
            'qualified_name or name_pattern is required for snippet (name_pattern supports globs like use*)',
          );
        }
        const searchRaw = await invokeCbmRaw(
          'graph_query',
          {
            action: 'search',
            name_pattern: normalized.name_pattern,
            label: normalized.label,
            file_pattern: normalized.file_pattern,
            limit: normalized.limit ?? 5,
            repo_path: normalized.repo_path,
            project: normalized.project,
          },
          context,
        );
        const qualifiedName = extractFirstQualifiedNameFromSearchRaw(searchRaw);
        if (!qualifiedName) {
          throw ToolError.invalidParam(
            'name_pattern',
            'no symbol found; refine pattern or pass qualified_name from search',
          );
        }
        return invokeCbm(
          'graph_query',
          { ...normalized, qualified_name: qualifiedName },
          context,
        );
      }
      if (normalized.action === 'query' && !normalized.query?.trim()) {
        throw ToolError.invalidParam('query', formatGraphQueryValidationHint('query', 'query'));
      }
      if (normalized.action === 'code' && !normalized.pattern?.trim()) {
        throw ToolError.invalidParam('pattern', formatGraphQueryValidationHint('code', 'pattern'));
      }
      if (!normalized.repo_path && !context?.baseDir && !normalized.project) {
        throw ToolError.missingParam('repo_path');
      }

      if (
        normalized.action === 'query'
        && normalized.query?.trim()
        && (isLabelsTypesSchemaIntent(normalized.query) || /^\s*CALL\s+db\./i.test(normalized.query))
      ) {
        const schemaRaw = await invokeCbmRaw(
          'graph_query',
          {
            action: 'schema',
            repo_path: normalized.repo_path,
            project: normalized.project,
          },
          context,
        );
        const body = formatGraphOutput('graph_query', 'schema', schemaRaw);
        return {
          tool_call_id: '',
          output:
            `${body}\n\n` +
            '_Routed: labels()/type() discovery queries use **schema** (label/type **names**), not search_graph degree counts._',
        };
      }

      // Bug #1/#2 fix: CBM CLI returns wrong values for type(r)/labels(n) + count() aggregations
      // (returns total count instead of type/label names). Route to schema which has correct counts.
      if (
        normalized.action === 'query'
        && normalized.query?.trim()
        && isAggregateSchemaIntent(normalized.query)
      ) {
        const schemaRaw = await invokeCbmRaw(
          'graph_query',
          {
            action: 'schema',
            repo_path: normalized.repo_path,
            project: normalized.project,
          },
          context,
        );
        const body = formatGraphOutput('graph_query', 'schema', schemaRaw);
        return {
          tool_call_id: '',
          output:
            `${body}\n\n` +
            '_Routed: `type(r)`/`labels(n)` with `count()` returns incorrect values in Cypher queries. ' +
            'Schema action provides correct label and edge-type counts._',
        };
      }

      // Bug #5 hint: MATCH path = ... is not supported by CBM CLI Cypher engine
      if (
        normalized.action === 'query'
        && normalized.query?.trim()
        && /^\s*MATCH\s+path\s*=/i.test(normalized.query)
      ) {
        return {
          tool_call_id: '',
          output:
            '_CBM Cypher engine does not support path variables (`MATCH path = ...`). ' +
            'Rewrite as `MATCH (n)-[r]->(m) RETURN n.name, type(r), m.name` to get relationship data, ' +
            'or use `graph_trace action=trace` for call chain analysis._',
        };
      }

      if (normalized.action === 'code' && normalized.name_pattern?.trim()) {
        const searchRaw = await invokeCbmRaw(
          'graph_query',
          {
            action: 'search',
            name_pattern: normalized.name_pattern,
            label: normalized.label,
            file_pattern: normalized.file_pattern,
            limit: normalized.limit ?? 50,
            repo_path: normalized.repo_path,
            project: normalized.project,
          },
          context,
        );
        const symbolNames = extractSymbolNamesFromSearchRaw(searchRaw);
        if (symbolNames.size === 0) {
          return {
            tool_call_id: '',
            output: `_No symbols matched name_pattern \`${normalized.name_pattern}\`._`,
          };
        }

        const { name_pattern: _omit, ...codeArgs } = normalized as Record<string, unknown>;
        const codeRaw = await invokeCbmRaw(
          'graph_query',
          codeArgs,
          context,
        );
        const filtered = filterCodeSearchRawByNamePattern(codeRaw, normalized.name_pattern);
        return {
          tool_call_id: '',
          output: formatGraphOutput('graph_query', 'code', filtered),
        };
      }

      const codePropertyRewrite = normalized._code_property_rewrite === true;
      const invokeArgs = { ...normalized } as Record<string, unknown>;
      delete invokeArgs._code_property_rewrite;

      if (invokeArgs.action === 'query') {
        const result = await invokeCbm('graph_query', invokeArgs, context);
        if (codePropertyRewrite && result.output) {
          result.output +=
            '\n\n_Code is not stored on graph nodes. Rewrote `.code` RETURN to metadata fields. ' +
            'Use `graph_query action=snippet` with `qualified_name`, or `action=code` with `pattern` to read source._';
        }
        return result;
      }

      return invokeCbm('graph_query', invokeArgs, context);
    } catch (error) {
      return handleToolError(error);
    }
  }
}

class GraphTraceHandler implements ToolHandler<'graph_trace'> {
  name = 'graph_trace' as const;

  async execute(args: GraphTraceArgs, context?: ToolContext): Promise<ToolResult> {
    try {
      if (!GRAPH_TRACE_ACTIONS.has(args.action)) {
        throw ToolError.invalidParam('action', `unsupported action: ${args.action}`);
      }
      if (args.action === 'trace' && !args.function_name?.trim()) {
        throw ToolError.missingParam('function_name');
      }
      if (!args.repo_path && !context?.baseDir && !args.project) {
        throw ToolError.missingParam('repo_path');
      }

      const action = String(args.action);
      let raw = await invokeCbmRaw('graph_trace', args as Record<string, unknown>, context);
      if (action === 'changes') {
        raw = filterDetectChangesRaw(raw, args.function_name?.trim());
      }
      let output = formatGraphOutput('graph_trace', action, raw);

      // Fallback: CBM trace_path only follows CALLS edges. Many projects
      // (especially TS/Vue) have zero CALLS edges, so trace always returns
      // empty. When that happens, query all edge types via Cypher so the AI
      // gets useful relationship info instead of a bare "None".
      if (args.action === 'trace' && this.isTraceEmpty(raw)) {
        const fallback = await this.traceFallback(args, context);
        if (fallback) {
          output = `${output}\n\n---\n\n**Fallback** (no CALLS edges; other relationship types):\n\n${fallback}`;
        }
      }

      return { tool_call_id: '', output };
    } catch (error) {
      return handleToolError(error);
    }
  }

  /**
   * Check if trace_path returned empty callers AND callees.
   */
  private isTraceEmpty(raw: string): boolean {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return false;
      const obj = parsed as Record<string, unknown>;
      const callers = extractArray(obj, ['callers', 'inbound', 'upstream']);
      const callees = extractArray(obj, ['callees', 'outbound', 'downstream']);
      // Empty if both are empty arrays (or missing)
      const callersEmpty = !callers || callers.length === 0;
      const calleesEmpty = !callees || callees.length === 0;
      return callersEmpty && calleesEmpty;
    } catch {
      return false;
    }
  }

  /**
   * When trace_path returns empty callers AND callees, run a Cypher query
   * to discover relationships via ALL edge types (DEFINES, IMPORTS, USAGE, etc.).
   */
  private async traceFallback(
    args: GraphTraceArgs,
    context?: ToolContext,
  ): Promise<string | null> {
    const fnName = args.function_name?.trim();
    if (!fnName) return null;
    const escaped = fnName.replace(/'/g, "\\'");

    try {
      // Bug #4 fix: don't constrain to :Function label — the target may be a Module, File, etc.
      const incomingRaw = await invokeCbmRaw('graph_query', {
        action: 'query',
        query:
          `MATCH (a)-[r]->(f {name: '${escaped}'}) ` +
          `RETURN type(r) AS rel_type, a.name AS from_name LIMIT 20`,
        repo_path: args.repo_path,
        project: args.project,
      }, context);

      const outgoingRaw = await invokeCbmRaw('graph_query', {
        action: 'query',
        query:
          `MATCH (f {name: '${escaped}'})-[r]->(b) ` +
          `RETURN type(r) AS rel_type, b.name AS to_name LIMIT 20`,
        repo_path: args.repo_path,
        project: args.project,
      }, context);

      const incoming = parseColumnsRows(incomingRaw);
      const outgoing = parseColumnsRows(outgoingRaw);

      if (incoming.length === 0 && outgoing.length === 0) {
        return (
          `_No relationships found for \`${fnName}\` across any edge type._ ` +
          `Run \`graph_query search\` with \`name_pattern\` to confirm the symbol exists and get qualified_name.`
        );
      }

      const sections: string[] = [];
      if (incoming.length > 0) {
        const lines = incoming.map(
          (row) => `- \`${row[1] ?? '—'}\` —[${row[0] ?? '?'}]→ **${fnName}**`,
        );
        sections.push(`**Incoming** (${incoming.length}):\n${lines.join('\n')}`);
      }
      if (outgoing.length > 0) {
        const lines = outgoing.map(
          (row) => `- **${fnName}** —[${row[0] ?? '?'}]→ \`${row[1] ?? '—'}\``,
        );
        sections.push(`**Outgoing** (${outgoing.length}):\n${lines.join('\n')}`);
      }

      return sections.length > 0 ? sections.join('\n\n') : null;
    } catch {
      return (
        `_Fallback Cypher query failed for \`${fnName}\`. ` +
        `Try \`graph_query search\` first, then a manual \`graph_query query\` with labels(n)/type(r).`
      );
    }
  }
}

export const graphHandlers = [
  new GraphIndexHandler(),
  new GraphQueryHandler(),
  new GraphTraceHandler(),
];
