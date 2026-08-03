/**
 * Change-review blast radius: inbound callers + file-level IMPORTS, with denoise.
 */

import { invoke } from '@tauri-apps/api/core';
import { extractSymbolNamesFromSearchRaw } from '../features/agent-engine/handlers/graphHandlers';
import { invokeCbmGraph } from './cbmRuntime';

function fileBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || filePath;
}

function normalizeFileKey(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

/** True when caller path refers to the same file as the changed target (not merely same basename). */
export function isSameSourceFile(callerFile: string, targetFilePath: string): boolean {
  const a = normalizeFileKey(callerFile);
  const b = normalizeFileKey(targetFilePath);
  if (a === b) return true;
  if (a.endsWith('/' + b) || b.endsWith('/' + a)) return true;
  return false;
}

/** parent/basename so stores/products.ts ≠ data/products.ts in the UI. */
export function formatBlastCallerPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] || filePath;
}

/** Module path hint for text search, e.g. src/data/products.ts → data/products */
export function moduleHintFromFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const base = parts[parts.length - 1] || filePath;
  const stem = base.replace(/\.[^.]+$/, '');
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${stem}`;
  }
  return stem;
}

export function isImportLikePreview(preview: string, moduleHint: string): boolean {
  const line = preview.trim();
  if (!line || !moduleHint) return false;
  if (!line.includes(moduleHint)) return false;
  return (
    /^\s*import\b/.test(line) ||
    /\bfrom\s+['"]/.test(line) ||
    /\brequire\s*\(/.test(line) ||
    /\bimport\s*\(/.test(line)
  );
}

export const BLAST_RADIUS_HIGH_RISK_CALLERS = 5;
export const BLAST_RADIUS_MAX_SYMBOLS = 5;

export type BlastRadiusEdgeKind = 'calls' | 'imports' | 'other';

export type BlastRadiusCaller = {
  name: string;
  file?: string;
  line?: number;
  kind?: BlastRadiusEdgeKind;
};

export type BlastRadiusSymbolImpact = {
  symbol: string;
  callers: BlastRadiusCaller[];
  highRisk: boolean;
};

export type BlastRadiusResult = {
  filePath: string;
  /** Who imports this file (file-level), after denoise */
  fileImporters: BlastRadiusCaller[];
  symbols: BlastRadiusSymbolImpact[];
  /** True when no file importers and every symbol has zero callers */
  empty: boolean;
  error?: string;
};

export type TextSearchHit = {
  path: string;
  line?: number;
  preview?: string;
};

export type ChangeBlastRadiusDeps = {
  searchFileSymbolsRaw: (repoPath: string, filePattern: string) => Promise<string>;
  traceInboundRaw: (repoPath: string, functionName: string) => Promise<string>;
  queryInboundFallbackRaw?: (repoPath: string, functionName: string) => Promise<string>;
  /** File-level IMPORTS / import-like edges into this basename */
  queryFileImportersRaw?: (repoPath: string, fileBasename: string) => Promise<string>;
  /** Workspace text search fallback when graph has no IMPORT edges */
  searchImportRefs?: (repoPath: string, moduleHint: string) => Promise<TextSearchHit[]>;
};

function escapeCypherLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function defaultSearchImportRefs(
  repoPath: string,
  moduleHint: string
): Promise<TextSearchHit[]> {
  type SearchMatch = { line: number; preview?: string };
  type SearchFileResult = { path: string; matches?: SearchMatch[] };
  const results = await invoke<SearchFileResult[]>('search_in_folder', {
    folderPath: repoPath,
    query: moduleHint,
    caseSensitive: false,
    maxResults: 80,
    maxFileSize: 5_000_000,
  });
  if (!Array.isArray(results)) return [];
  const hits: TextSearchHit[] = [];
  for (const file of results) {
    if (!file?.path) continue;
    const matches = Array.isArray(file.matches) ? file.matches : [];
    if (matches.length === 0) {
      hits.push({ path: file.path });
      continue;
    }
    for (const m of matches) {
      hits.push({ path: file.path, line: m.line, preview: m.preview });
    }
  }
  return hits;
}

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
      const escaped = escapeCypherLiteral(functionName);
      return invokeCbmGraph('graph_query', 'query', {
        repo_path: repoPath,
        query:
          `MATCH (a)-[r]->(f {name: '${escaped}'}) ` +
          `RETURN type(r) AS rel_type, a.name AS from_name, a.file_path AS from_file LIMIT 40`,
      });
    },
    queryFileImportersRaw: (repoPath, basename) => {
      const escaped = escapeCypherLiteral(basename);
      // Inbound to File/module; keep IMPORT* preferred but allow other types (denoised later).
      return invokeCbmGraph('graph_query', 'query', {
        repo_path: repoPath,
        query:
          `MATCH (a)-[r]->(t) ` +
          `WHERE (t.name = '${escaped}' OR t.file_path ENDS WITH '${escaped}') ` +
          `AND (type(r) = 'IMPORTS' OR type(r) = 'IMPORT' OR type(r) = 'USES' OR type(r) = 'USAGE') ` +
          `RETURN type(r) AS rel_type, a.name AS from_name, a.file_path AS from_file LIMIT 50`,
      });
    },
    searchImportRefs: defaultSearchImportRefs,
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

export function edgeKindFromRelType(relType: string | undefined): BlastRadiusEdgeKind {
  if (!relType) return 'other';
  const upper = relType.toUpperCase();
  if (upper.includes('CALL')) return 'calls';
  if (upper.includes('IMPORT') || upper === 'USES' || upper === 'USAGE') return 'imports';
  if (upper === 'DEFINES' || upper === 'DEFINE') return 'other';
  return 'other';
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
    const kind = edgeKindFromRelType(strVal(row.rel_type ?? row.type ?? row.edge));
    const key = `${name}\0${file ?? ''}\0${line ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, file, line, kind: kind === 'other' ? 'calls' : kind });
  }
  return out;
}

/** Parse Cypher columns/rows into callers (rel_type, from_name, from_file). */
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
      const rel = strVal(row[0]);
      const name = strVal(row[1]);
      if (!name) continue;
      const file = strVal(row[2]);
      const key = `${name}\0${file ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, file, kind: edgeKindFromRelType(rel) });
    }
    return out;
  }

  if (rows) {
    const out: BlastRadiusCaller[] = [];
    const seen = new Set<string>();
    for (const item of rows) {
      if (typeof item !== 'object' || item === null) continue;
      const row = item as Record<string, unknown>;
      const name = strVal(row.from_name ?? row.name);
      if (!name) continue;
      const file = strVal(row.from_file ?? row.file ?? row.file_path);
      const rel = strVal(row.rel_type ?? row.type);
      const key = `${name}\0${file ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, file, kind: edgeKindFromRelType(rel) });
    }
    return out;
  }

  return [];
}

/** Same-file / backup / File-node self noise for blast-radius display. */
export function isNoiseCaller(caller: BlastRadiusCaller, targetFilePath: string): boolean {
  const targetBase = fileBasename(targetFilePath).toLowerCase();
  const nameBase = fileBasename(caller.name).toLowerCase();

  if (caller.file?.trim()) {
    if (isSameSourceFile(caller.file, targetFilePath)) return true;
    const callerBase = fileBasename(caller.file).toLowerCase();
    if (/_backup(\.|$)/i.test(callerBase)) return true;
    if (/(^|[._-])backup([._-]|$)/i.test(callerBase)) return true;
    // Basename-only path (no directory) matching target → treat as self File node
    if (!/[\\/]/.test(caller.file) && callerBase === targetBase) return true;
  } else if (nameBase === targetBase) {
    // Graph often returns File nodes as callers with name=filename and no file_path
    return true;
  }

  // name is the target filename and file points at the target (or is missing)
  if (nameBase === targetBase) {
    if (!caller.file?.trim()) return true;
    if (isSameSourceFile(caller.file, targetFilePath)) return true;
  }

  return false;
}

/** @deprecated use isNoiseCaller — kept for existing tests */
export function isNoiseCallerFile(
  callerFile: string | undefined,
  targetFilePath: string
): boolean {
  return isNoiseCaller({ name: fileBasename(callerFile || ''), file: callerFile }, targetFilePath);
}

/**
 * Drop self/backup noise, dedupe by full file path, import-like first.
 */
export function denoiseAndRankCallers(
  callers: BlastRadiusCaller[],
  targetFilePath: string
): BlastRadiusCaller[] {
  const filtered = callers.filter((c) => !isNoiseCaller(c, targetFilePath));

  filtered.sort((a, b) => {
    const aHasFile = a.file?.trim() ? 0 : 1;
    const bHasFile = b.file?.trim() ? 0 : 1;
    if (aHasFile !== bHasFile) return aHasFile - bHasFile;
    const aImport = a.kind === 'imports' ? 0 : 1;
    const bImport = b.kind === 'imports' ? 0 : 1;
    if (aImport !== bImport) return aImport - bImport;
    return (
      (a.file ?? '').localeCompare(b.file ?? '') || a.name.localeCompare(b.name)
    );
  });

  const out: BlastRadiusCaller[] = [];
  const seen = new Set<string>();
  for (const caller of filtered) {
    const key = caller.file?.trim()
      ? `f:${normalizeFileKey(caller.file)}`
      : `n:${caller.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(caller);
  }
  return out;
}

export function importersFromTextHits(
  hits: TextSearchHit[],
  targetFilePath: string,
  moduleHint: string
): BlastRadiusCaller[] {
  const callers: BlastRadiusCaller[] = [];
  for (const hit of hits) {
    if (!hit.path?.trim()) continue;
    if (isSameSourceFile(hit.path, targetFilePath)) continue;
    if (hit.preview != null && hit.preview !== '' && !isImportLikePreview(hit.preview, moduleHint)) {
      continue;
    }
    const base = fileBasename(hit.path);
    callers.push({
      name: base,
      file: hit.path,
      line: hit.line,
      kind: 'imports',
    });
  }
  return denoiseAndRankCallers(callers, targetFilePath);
}

function filePatternForPath(filePath: string): string {
  return fileBasename(filePath) || filePath;
}

async function resolveFileImporters(
  projectPath: string,
  filePath: string,
  basename: string,
  deps: ChangeBlastRadiusDeps
): Promise<BlastRadiusCaller[]> {
  let fromGraph: BlastRadiusCaller[] = [];
  if (deps.queryFileImportersRaw) {
    try {
      const importersRaw = await deps.queryFileImportersRaw(projectPath, basename);
      fromGraph = denoiseAndRankCallers(parseCallersFromQueryRaw(importersRaw), filePath);
    } catch {
      fromGraph = [];
    }
  }

  if (fromGraph.length > 0) return fromGraph;

  if (!deps.searchImportRefs) return [];
  try {
    const hint = moduleHintFromFilePath(filePath);
    const hits = await deps.searchImportRefs(projectPath, hint);
    return importersFromTextHits(hits, filePath, hint);
  } catch {
    return [];
  }
}

export async function loadChangeBlastRadius(
  options: { projectPath: string; filePath: string },
  deps: ChangeBlastRadiusDeps = defaultDeps()
): Promise<BlastRadiusResult> {
  const projectPath = options.projectPath.trim();
  const filePath = options.filePath.trim();
  if (!projectPath) {
    return { filePath, fileImporters: [], symbols: [], empty: true, error: 'missing_project_path' };
  }
  if (!filePath) {
    return { filePath, fileImporters: [], symbols: [], empty: true, error: 'missing_file_path' };
  }

  const basename = filePatternForPath(filePath);

  let searchRaw: string;
  try {
    searchRaw = await deps.searchFileSymbolsRaw(projectPath, basename);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { filePath, fileImporters: [], symbols: [], empty: true, error: msg };
  }

  const fileImporters = await resolveFileImporters(projectPath, filePath, basename, deps);

  const symbolNames = selectSymbolsForBlastRadius(searchRaw, BLAST_RADIUS_MAX_SYMBOLS);
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
          // keep empty
        }
      }
    } catch {
      callers = [];
    }

    const ranked = denoiseAndRankCallers(callers, filePath);
    if (ranked.length === 0) continue;
    symbols.push({
      symbol,
      callers: ranked,
      highRisk: ranked.length >= BLAST_RADIUS_HIGH_RISK_CALLERS,
    });
  }

  const empty = fileImporters.length === 0 && symbols.length === 0;

  return { filePath, fileImporters, symbols, empty };
}
