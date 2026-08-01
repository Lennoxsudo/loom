/**
 * Change-review blast radius: inbound callers for symbols in a changed file.
 */

import { extractSymbolNamesFromSearchRaw } from '../features/agent-engine/handlers/graphHandlers';
import { invokeCbmGraph } from './cbmRuntime';

function fileBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

export const BLAST_RADIUS_HIGH_RISK_CALLERS = 5;
export const BLAST_RADIUS_MAX_SYMBOLS = 5;

export type BlastRadiusCaller = {
  name: string;
  file?: string;
  line?: number;
};

export type BlastRadiusSymbolImpact = {
  symbol: string;
  callers: BlastRadiusCaller[];
  highRisk: boolean;
};

export type BlastRadiusResult = {
  filePath: string;
  symbols: BlastRadiusSymbolImpact[];
  /** True when search found no symbols or every symbol has zero callers */
  empty: boolean;
  error?: string;
};

export type ChangeBlastRadiusDeps = {
  searchFileSymbolsRaw: (repoPath: string, filePattern: string) => Promise<string>;
  traceInboundRaw: (repoPath: string, functionName: string) => Promise<string>;
  queryInboundFallbackRaw?: (repoPath: string, functionName: string) => Promise<string>;
};

function defaultDeps(): ChangeBlastRadiusDeps {
  return {
    searchFileSymbolsRaw: (repoPath, filePattern) =>
      invokeCbmGraph('graph_query', 'search', {
        repo_path: repoPath,
        file_pattern: filePattern,
        name_pattern: '.*',
      }),
    traceInboundRaw: (repoPath, functionName) =>
      invokeCbmGraph('graph_trace', 'trace', {
        repo_path: repoPath,
        function_name: functionName,
        direction: 'inbound',
        depth: 2,
      }),
    queryInboundFallbackRaw: (repoPath, functionName) => {
      const escaped = functionName.replace(/'/g, "\\'");
      return invokeCbmGraph('graph_query', 'query', {
        repo_path: repoPath,
        query:
          `MATCH (a)-[r]->(f {name: '${escaped}'}) ` +
          `RETURN type(r) AS rel_type, a.name AS from_name, a.file_path AS from_file LIMIT 40`,
      });
    },
  };
}

function strVal(val: unknown): string | undefined {
  if (typeof val === 'string' && val.trim()) return val.trim();
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  return undefined;
}

function numVal(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim()) {
    const n = Number(val);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function extractArray(data: unknown, keys: string[]): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  return null;
}

/** Prefer simple `name` entries from search JSON; fall back to qualified names. */
export function selectSymbolsForBlastRadius(raw: string, max = BLAST_RADIUS_MAX_SYMBOLS): string[] {
  const preferred: string[] = [];
  const seen = new Set<string>();
  try {
    const parsed = JSON.parse(raw) as unknown;
    const results = extractArray(parsed, ['results', 'symbols', 'matches', 'nodes']);
    if (results) {
      for (const item of results) {
        if (typeof item !== 'object' || item === null) continue;
        const obj = item as Record<string, unknown>;
        const name = strVal(obj.name) ?? strVal(obj.qualified_name) ?? strVal(obj.full_name);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        preferred.push(name);
        if (preferred.length >= max) return preferred;
      }
    }
  } catch {
    // fall through to Set helper
  }

  if (preferred.length > 0) return preferred;

  const fromSet = [...extractSymbolNamesFromSearchRaw(raw)];
  fromSet.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return fromSet.slice(0, max);
}

export function parseCallersFromTraceRaw(raw: string): BlastRadiusCaller[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const obj = parsed as Record<string, unknown>;
  const callers = extractArray(obj, ['callers', 'inbound', 'upstream']);
  if (!callers) return [];

  const out: BlastRadiusCaller[] = [];
  const seen = new Set<string>();
  for (const item of callers) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    const name = strVal(row.name ?? row.from_name ?? row.symbol ?? row.label);
    if (!name) continue;
    const file = strVal(row.file ?? row.file_path ?? row.path);
    const line = numVal(row.line ?? row.line_number ?? row.start_line);
    const key = `${name}\0${file ?? ''}\0${line ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, file, line });
  }
  return out;
}

/** Parse Cypher columns/rows fallback into callers (from_name / from_file). */
export function parseCallersFromQueryRaw(raw: string): BlastRadiusCaller[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const obj = parsed as Record<string, unknown>;

  const rows = extractArray(obj, ['rows', 'results', 'data']);
  if (rows && rows.length > 0 && Array.isArray(rows[0])) {
    const out: BlastRadiusCaller[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      // rel_type, from_name, from_file
      const name = strVal(row[1]);
      if (!name) continue;
      const file = strVal(row[2]);
      const key = `${name}\0${file ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, file });
    }
    return out;
  }

  // Object-shaped results
  if (rows) {
    const out: BlastRadiusCaller[] = [];
    const seen = new Set<string>();
    for (const item of rows) {
      if (typeof item !== 'object' || item === null) continue;
      const row = item as Record<string, unknown>;
      const name = strVal(row.from_name ?? row.name);
      if (!name) continue;
      const file = strVal(row.from_file ?? row.file ?? row.file_path);
      const key = `${name}\0${file ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, file });
    }
    return out;
  }

  return [];
}

function filePatternForPath(filePath: string): string {
  return fileBasename(filePath) || filePath;
}

export async function loadChangeBlastRadius(
  options: { projectPath: string; filePath: string },
  deps: ChangeBlastRadiusDeps = defaultDeps()
): Promise<BlastRadiusResult> {
  const projectPath = options.projectPath.trim();
  const filePath = options.filePath.trim();
  if (!projectPath) {
    return { filePath, symbols: [], empty: true, error: 'missing_project_path' };
  }
  if (!filePath) {
    return { filePath, symbols: [], empty: true, error: 'missing_file_path' };
  }

  let searchRaw: string;
  try {
    searchRaw = await deps.searchFileSymbolsRaw(projectPath, filePatternForPath(filePath));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { filePath, symbols: [], empty: true, error: msg };
  }

  const symbolNames = selectSymbolsForBlastRadius(searchRaw, BLAST_RADIUS_MAX_SYMBOLS);
  if (symbolNames.length === 0) {
    return { filePath, symbols: [], empty: true };
  }

  const symbols: BlastRadiusSymbolImpact[] = [];
  for (const symbol of symbolNames) {
    let callers: BlastRadiusCaller[] = [];
    try {
      const traceRaw = await deps.traceInboundRaw(projectPath, symbol);
      callers = parseCallersFromTraceRaw(traceRaw);
      if (callers.length === 0 && deps.queryInboundFallbackRaw) {
        try {
          const fallbackRaw = await deps.queryInboundFallbackRaw(projectPath, symbol);
          callers = parseCallersFromQueryRaw(fallbackRaw);
        } catch {
          // keep empty callers
        }
      }
    } catch {
      callers = [];
    }

    symbols.push({
      symbol,
      callers,
      highRisk: callers.length >= BLAST_RADIUS_HIGH_RISK_CALLERS,
    });
  }

  const empty = symbols.every((s) => s.callers.length === 0);
  return { filePath, symbols, empty };
}
