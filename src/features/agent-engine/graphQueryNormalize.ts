/**
 * graph_query argument + Cypher normalization for CBM CLI compatibility.
 */

function boolArg(val: unknown): boolean | undefined {
  if (typeof val === 'boolean') return val;
  if (val === 'true' || val === 1) return true;
  if (val === 'false' || val === 0) return false;
  return undefined;
}

/** Global paramNormalizer maps boolean `regex` → `pattern`; undo for graph_query. */
function fixRegexPatternAliasConfusion(result: Record<string, unknown>): void {
  if (typeof result.pattern === 'boolean') {
    if (result.regex === undefined) {
      result.regex = result.pattern;
    }
    delete result.pattern;
  }
}

/** Escape a literal qualified_name for CBM qn_pattern (regex) exact match. */
export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Map user qualified_name to CBM search_graph qn_pattern. */
export function qualifiedNameToQnPattern(qualifiedName: string, useRegex?: boolean): string {
  const trimmed = qualifiedName.trim();
  if (!trimmed) return '';
  if (useRegex === true) return trimmed;
  return `^${escapeRegexLiteral(trimmed)}$`;
}

const INVOKE_LINKS_QN_PREFIX_RE =
  /^\.?(?:[A-Za-z0-9_-]+-)*[A-Za-z0-9_-]*invoke-links-[a-f0-9]{8,}(?=\.|$)/i;

/** Strip CBM invoke-links project slug from qualified_name for display.
 *  Also removes the `.__file__` suffix that CBM appends to File-label nodes
 *  (Module nodes for the same file don't have it), so search results are
 *  consistent and the displayed value can be passed back to snippet/search. */
export function sanitizeCbmQualifiedName(qualifiedName: string): string {
  const trimmed = qualifiedName.trim();
  if (!trimmed) return trimmed;

  let rest = trimmed.replace(INVOKE_LINKS_QN_PREFIX_RE, '');
  // Remove leading dot left after prefix stripping
  rest = rest.replace(/^\.+/, '');
  // Remove __file__ suffix (File nodes get this; Module nodes don't)
  rest = rest.replace(/\.__file__$/, '');
  return rest || trimmed;
}

/** Action-aware param mapping (runs after global paramNormalizer). */
export function normalizeGraphQueryArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result = { ...args };
  fixRegexPatternAliasConfusion(result);
  const action = String(result.action ?? '').toLowerCase();

  if (action === 'query') {
    if (result.query === undefined || String(result.query).trim() === '') {
      for (const key of ['cypher', 'cypher_query', 'graph_query', 'statement', 'sql']) {
        const val = result[key];
        if (typeof val === 'string' && val.trim()) {
          result.query = val;
          break;
        }
      }
    }
    const queryStr = strArg(result.query);
    const filePattern = strArg(result.file_pattern);
    if (queryStr && filePattern) {
      result.query = injectFilePatternIntoCypher(queryStr, filePattern);
    }
    const finalQuery = strArg(result.query) ?? queryStr;
    if (finalQuery) {
      const rewritten = rewriteCodePropertyCypher(finalQuery);
      if (rewritten.rewritten) {
        result.query = rewritten.query;
        result._code_property_rewrite = true;
      }
    }
  }

  if (action === 'code') {
    const queryStr = strArg(result.query);
    if (queryStr && looksLikeCypher(queryStr)) {
      result.action = 'query';
      result.query = queryStr;
      delete result.pattern;
      const fp = strArg(result.file_pattern);
      if (fp) {
        result.query = injectFilePatternIntoCypher(queryStr, fp);
      }
      const rewritten = rewriteCodePropertyCypher(strArg(result.query) ?? queryStr);
      if (rewritten.rewritten) {
        result.query = rewritten.query;
        result._code_property_rewrite = true;
      }
    } else {
      if (result.pattern === undefined || String(result.pattern).trim() === '') {
        for (const key of ['pattern', 'code', 'text', 'grep', 'keyword', 'search_text', 'script']) {
          const val = result[key];
          if (typeof val === 'string' && val.trim()) {
            result.pattern = val;
            break;
          }
        }
      }
      if (
        (result.pattern === undefined || String(result.pattern).trim() === '') &&
        queryStr &&
        !looksLikeCypher(queryStr)
      ) {
        result.pattern = queryStr;
      }
      if (!numArg(result.limit)) {
        result.limit = 20;
      }
      delete result.query;
    }
  }

  if (action === 'snippet' || action === 'search') {
    if (result.name_pattern === undefined || String(result.name_pattern).trim() === '') {
      for (const key of ['name_pattern', 'pattern', 'name', 'symbol', 'symbol_name']) {
        const val = result[key];
        if (typeof val === 'string' && val.trim()) {
          result.name_pattern = val;
          break;
        }
      }
    }
    if (
      (result.name_pattern === undefined || String(result.name_pattern).trim() === '') &&
      typeof result.query === 'string' &&
      result.query.trim() &&
      action === 'search' &&
      !strArg(result.qn_pattern)
    ) {
      result.name_pattern = result.query;
    }
    const regex = boolArg(result.regex);
    const np = strArg(result.name_pattern);
    if (np) {
      result.name_pattern = globToNamePatternRegex(np, regex);
    }
  }

  if (action === 'search') {
    const regex = boolArg(result.regex);

    const qn = strArg(result.qualified_name) ?? strArg(result.qn_pattern);
    if (qn && !strArg(result.qn_pattern)) {
      result.qn_pattern = qualifiedNameToQnPattern(qn, regex);
    }

    if (strArg(result.qn_pattern) && !strArg(result.name_pattern)) {
      // CBM qn_pattern scopes by qualified id; avoid BM25 `query` overriding filters.
      if (strArg(result.query) && strArg(result.qualified_name)) {
        delete result.query;
      }
    }
  }

  const rewritten = rewriteGraphSearchDegreeFilter(result);
  if (rewritten) {
    return rewritten;
  }

  return result;
}

const CALL_PROCEDURE_RE = /^\s*CALL\s+db\.\w+\s*\(/i;

function numArg(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() && !Number.isNaN(Number(val))) return Number(val);
  return undefined;
}

function strArg(val: unknown): string | undefined {
  if (typeof val === 'string' && val.trim()) return val.trim();
  return undefined;
}

export function looksLikeCypher(query: string): boolean {
  const compact = query.trim().replace(/\s+/g, ' ');
  return /^\s*MATCH\b/i.test(compact) || /^\s*OPTIONAL\s+MATCH\b/i.test(compact);
}

/** Convert simple glob (*, ?) to regex for CBM name_pattern when not already regex. */
export function globToNamePatternRegex(pattern: string, useRegex?: boolean): string {
  const trimmed = pattern.trim();
  if (!trimmed || useRegex === true) return trimmed;
  const hasGlob = trimmed.includes('*') || trimmed.includes('?');
  const looksLikeRegex = trimmed.startsWith('^') || /\.\*|\[/.test(trimmed);
  if (!hasGlob || looksLikeRegex) return trimmed;
  const escaped = trimmed
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return `^${escaped}$`;
}

/** Convert a simple glob to a loose path regex for CBM `file_path =~ "..."`. */
export function globToCbmPathRegex(glob: string): string {
  const g = glob.trim().replace(/\\/g, '/');
  if (!g) return '.*';
  const escaped = g
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\0\0/g, '.*')
    .replace(/\?/g, '[^/]');
  return `.*${escaped}.*`;
}

function extractPrimaryNodeVar(query: string): string {
  const match = query.match(/\bMATCH\s*\(\s*(\w+)\s*(?::[^)]*)?\)/i);
  return match?.[1] ?? 'n';
}

/** Inject file_pattern into Cypher WHERE (query_graph has no native file_pattern param). */
export function injectFilePatternIntoCypher(query: string, filePattern: string): string {
  const pattern = filePattern.trim();
  if (!pattern) return query;

  const nodeVar = extractPrimaryNodeVar(query);
  const pathRegex = globToCbmPathRegex(pattern);
  const filter = `${nodeVar}.file_path =~ "${pathRegex}"`;

  if (/\bWHERE\b/i.test(query)) {
    return query.replace(/\bWHERE\b/i, `WHERE ${filter} AND `);
  }

  const matchClose = query.search(/\)\s*(?:-\[|WHERE|RETURN|WITH|ORDER|LIMIT|$)/i);
  if (matchClose > 0) {
    return `${query.slice(0, matchClose + 1)} WHERE ${filter}${query.slice(matchClose + 1)}`;
  }

  return `${query} WHERE ${filter}`;
}

const CODE_PROPERTY_RE = /\b\w+\.(code|source|content|body|text)\b/i;

/** CBM nodes do not store source code — rewrite .code RETURNs to metadata fields. */
export function rewriteCodePropertyCypher(query: string): { query: string; rewritten: boolean } {
  const trimmed = query.trim();
  if (!trimmed || !/\bRETURN\b/i.test(trimmed) || !CODE_PROPERTY_RE.test(trimmed)) {
    return { query: trimmed, rewritten: false };
  }

  const nodeVar = extractPrimaryNodeVar(trimmed);
  const rewrittenQuery = trimmed.replace(
    /\bRETURN\b[\s\S]*$/i,
    `RETURN ${nodeVar}.name, ${nodeVar}.file_path, ${nodeVar}.qualified_name, ${nodeVar}.start_line, ${nodeVar}.end_line`
  );
  return { query: rewrittenQuery, rewritten: true };
}

/**
 * search_graph with relationship/degree filters returns nodes + in/out_degree counts,
 * NOT edge rows. Rewrite to query_graph Cypher that returns type(r)/labels(n) values.
 */
export function rewriteGraphSearchDegreeFilter(
  args: Record<string, unknown>
): Record<string, unknown> | null {
  const action = String(args.action ?? '').toLowerCase();
  if (action !== 'search') return null;

  const relationship = strArg(
    args.relationship ?? args.relationship_type ?? args.edge_type ?? args.rel_type
  );
  const minDegree = numArg(args.min_degree ?? args.minDegree);
  const maxDegree = numArg(args.max_degree ?? args.maxDegree);
  const excludeEntry = args.exclude_entry_points === true;
  const limit = numArg(args.limit) ?? 20;
  const hasNameFilter = Boolean(
    strArg(args.name_pattern) ??
    strArg(args.qualified_name) ??
    strArg(args.qn_pattern) ??
    strArg(args.label)
  );

  if (relationship && !hasNameFilter) {
    const rel = relationship.replace(/[^A-Za-z0-9_]/g, '');
    return {
      ...args,
      action: 'query',
      query:
        `MATCH (a)-[r:${rel}]->(b) ` +
        `RETURN type(r) AS edge_type, a.name AS from_name, b.name AS to_name LIMIT ${limit}`,
    };
  }

  if (maxDegree === 0 || (minDegree === 0 && maxDegree === 0)) {
    const entryFilter = excludeEntry ? ' AND coalesce(n.is_entry_point, false) = false' : '';
    return {
      ...args,
      action: 'query',
      query:
        `MATCH (n:Function) WHERE NOT (n)<-[:CALLS]-()${entryFilter} ` +
        `RETURN n.name AS name, labels(n) AS node_labels, n.file_path AS file LIMIT ${limit}`,
    };
  }

  if (minDegree !== undefined && relationship) {
    const rel = relationship.replace(/[^A-Za-z0-9_]/g, '');
    const dir = strArg(args.direction) ?? 'outbound';
    const match =
      dir === 'inbound'
        ? `MATCH (n)<-[r:${rel}]-()`
        : dir === 'outbound'
          ? `MATCH (n)-[r:${rel}]->()`
          : `MATCH (n)-[r:${rel}]-()`;
    return {
      ...args,
      action: 'query',
      query:
        `${match} WITH n, count(r) AS deg WHERE deg >= ${minDegree} ` +
        `RETURN n.name AS name, labels(n) AS node_labels, deg LIMIT ${limit}`,
    };
  }

  return null;
}

/** Queries that only discover schema should use action=schema (returns label/type names, not degrees). */
export function isLabelsTypesSchemaIntent(query: string): boolean {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return false;

  if (/^CALL\s+db\.(labels|relationshiptypes|reltypes)\s*\(\s*\)\s*$/i.test(q)) {
    return true;
  }

  // Aggregation, aliases, filters, or subscripts are real queries — not schema discovery.
  // But type(r)/labels(n) + count() aggregations return wrong values in CBM CLI
  // (Bug #1/#2: returns total count instead of type/label names), so we
  // intercept those separately in isAggregateSchemaIntent.
  if (/\b(WHERE|WITH|count\s*\(|sum\s*\(|avg\s*\(|\[\s*0\s*\]|\bAS\b|,)/i.test(q)) {
    return false;
  }

  if (
    /^MATCH\s+\(\s*\)\s*-\s*\[[^\]]*\]\s*->\s*\(\s*\)\s+RETURN\s+(DISTINCT\s+)?type\s*\(\s*\w+\s*\)(\s+LIMIT\s+\d+)?\s*$/i.test(
      q
    )
  ) {
    return true;
  }

  if (
    /^MATCH\s+\(\s*\w+\s*(?::\s*\w+)?\s*\)\s+RETURN\s+(DISTINCT\s+)?labels\s*\(\s*\w+\s*\)(\s+LIMIT\s+\d+)?\s*$/i.test(
      q
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Detect aggregate queries like `RETURN type(r), count(*)` or
 * `RETURN labels(n), count(n)` — CBM CLI returns wrong values for these
 * (returns total count instead of type/label names). Route to schema instead.
 */
export function isAggregateSchemaIntent(query: string): boolean {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return false;
  const hasTypeOrLabels = /\b(type\s*\(\s*\w+\s*\)|labels\s*\(\s*\w+\s*\))/i.test(q);
  const hasCount = /\bcount\s*\(/i.test(q);
  const hasMatch = /^\s*MATCH\b/i.test(q);
  return hasMatch && hasTypeOrLabels && hasCount;
}

function extractRelationshipVar(query: string): string | undefined {
  const match = query.match(/-\s*\[\s*(\w+)/);
  return match?.[1];
}

function rewriteReturnExpressionAliases(query: string): string {
  let q = query;
  q = q.replace(
    /(\bRETURN\s+(?:DISTINCT\s+)?)type\s*\(\s*(\w+)\s*\)(?!\s+AS\b)/gi,
    '$1type($2) AS rel_type'
  );
  q = q.replace(/,\s*type\s*\(\s*(\w+)\s*\)(?!\s+AS\b)/gi, ', type($1) AS rel_type');
  q = q.replace(
    /(\bRETURN\s+(?:DISTINCT\s+)?)count\s*\(\s*(\w+)\s*\)(?!\s+AS\b)/gi,
    '$1count($2) AS cnt'
  );
  q = q.replace(/,\s*count\s*\(\s*(\w+)\s*\)(?!\s+AS\b)/gi, ', count($1) AS cnt');
  return q;
}

/**
 * Rewrite Neo4j-isms to CBM Cypher subset (see codebase-memory src/cypher/cypher.c).
 */
export function normalizeCbmCypher(query: string): { query: string; hint?: string } {
  let q = query.trim();
  if (!q) return { query: q };

  if (CALL_PROCEDURE_RE.test(q)) {
    return {
      query: q,
      hint: 'CBM 不支持 CALL db.*() 过程调用。请改用 graph_query action=schema 获取标签/边类型名称，或用 MATCH … RETURN labels(n)/type(r)。',
    };
  }

  q = q.replace(/\brelationshipType\s*\(\s*(\w+)\s*\)/gi, 'type($1)');

  q = q.replace(/\blabels\s*\(\s*(\w+)\s*\)\s*=\s*['"]([^'"]+)['"]/gi, "$1.label = '$2'");

  q = q.replace(
    /\blabels\s*\(\s*(\w+)\s*\)\s*\[\s*0\s*\]\s*=\s*['"]([^'"]+)['"]/gi,
    "$1.label = '$2'"
  );

  q = q.replace(/\blabels\s*\(\s*(\w+)\s*\)\s*\[\s*0\s*\]/gi, '$1.label');

  const relVar = extractRelationshipVar(q);
  if (relVar) {
    q = q.replace(/\bcount\s*\(\s*\*\s*\)/gi, `count(${relVar})`);
  }

  q = rewriteReturnExpressionAliases(q);

  q = q.replace(/\bRETURN\s+label\s*\(/gi, 'RETURN labels(');
  q = q.replace(/,\s*label\s*\(/gi, ', labels(');

  // Neo4j n.labels property → labels(n) function
  q = q.replace(/\b(\w+)\.labels\b/g, 'labels($1)');

  // Typed edge property access (CBM supports r.type; normalize rel.type variants)
  q = q.replace(/\b(\w+)\.relationshipType\b/gi, 'type($1)');

  return { query: q };
}

/** Format labels()/type() cell values for markdown tables. */
export function formatCbmQueryCell(value: unknown, column?: string): string {
  if (value === null || value === undefined) return '—';
  const raw = String(value);
  if (!raw) return '—';

  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).join(', ');
      }
    } catch {
      // keep raw
    }
  }

  if (column && /labels/i.test(column) && raw.includes('Function')) {
    return raw.replace(/^\["|"\]$/g, '').replace(/","/g, ', ');
  }

  return raw;
}

export function formatGraphQueryValidationHint(
  action: string,
  missing: 'query' | 'pattern'
): string {
  if (action === 'query' && missing === 'query') {
    return 'action=query 需要 `query` 参数：Cypher MATCH 语句（非自然语言）。示例: MATCH (f:Function) WHERE f.name =~ ".*Auth.*" RETURN f.name, f.file_path LIMIT 10';
  }
  if (action === 'code' && missing === 'pattern') {
    return 'action=code 需要 `pattern` 参数：在已索引符号体内搜索的文本或正则。示例: pattern="TODO" 或 pattern="deprecated"';
  }
  return missing === 'query'
    ? '缺少 query（Cypher MATCH 语句）'
    : '缺少 pattern（符号体内搜索文本）';
}
