import { describe, expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { formatGraphOutput, graphHandlers, extractFirstQualifiedNameFromSearchRaw, filterCodeSearchRawByNamePattern, filterDetectChangesRaw } from '../handlers/graphHandlers';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('graphHandlers', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('maps graph_index status to cbm_graph invoke', async () => {
    vi.mocked(invoke).mockResolvedValue('{"indexed":true}');
    const handler = graphHandlers.find((item) => item.name === 'graph_index');
    expect(handler).toBeDefined();
    const result = await handler!.execute(
      { action: 'status', repo_path: 'D:\\proj' },
      { baseDir: 'D:\\proj' }
    );
    expect(invoke).toHaveBeenCalledWith('cbm_graph', {
      tool: 'graph_index',
      action: 'status',
      payload: { repo_path: 'D:\\proj' },
    });
    expect(result.output).toContain('graph_index');
  });

  it('maps graph_query query action to cbm_graph invoke', async () => {
    vi.mocked(invoke).mockResolvedValue('{"results":[]}');
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute(
      { action: 'query', query: 'MATCH (f:Function) RETURN f LIMIT 5', repo_path: 'D:\\proj' },
      { baseDir: 'D:\\proj' },
    );
    expect(invoke).toHaveBeenCalledWith('cbm_graph', {
      tool: 'graph_query',
      action: 'query',
      payload: {
        repo_path: 'D:\\proj',
        query: 'MATCH (f:Function) RETURN f LIMIT 5',
      },
    });
    expect(result.output).toContain('graph_query');
  });

  it('rejects graph_query query without query string', async () => {
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute({ action: 'query' }, { baseDir: 'D:\\proj' });
    expect(result.error).toBeTruthy();
  });

  it('maps graph_trace changes action to cbm_graph invoke', async () => {
    vi.mocked(invoke).mockResolvedValue('{"changes":[]}');
    const handler = graphHandlers.find((item) => item.name === 'graph_trace');
    await handler!.execute({ action: 'changes', repo_path: 'D:\\proj' }, { baseDir: 'D:\\proj' });
    expect(invoke).toHaveBeenCalledWith('cbm_graph', {
      tool: 'graph_trace',
      action: 'changes',
      payload: { repo_path: 'D:\\proj' },
    });
  });

  it('rejects invalid graph_query action', async () => {
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute({ action: 'nope' as 'search' }, { baseDir: 'D:\\proj' });
    expect(result.error).toBeTruthy();
  });

  // ── formatGraphOutput: structured markdown ──

  it('includes tool and action in header', () => {
    const output = formatGraphOutput('graph_index', 'status', '{"indexed":true}');
    expect(output).toContain('graph_index');
    expect(output).toContain('status');
  });

  it('falls back to plain text for non-JSON', () => {
    const output = formatGraphOutput('graph_index', 'index', 'not json');
    expect(output).toContain('not json');
  });

  it('handles null response', () => {
    const output = formatGraphOutput('graph_index', 'status', 'null');
    expect(output).toContain('No data');
  });

  // ── graph_index ──

  it('formats index status with key fields', () => {
    const output = formatGraphOutput(
      'graph_index',
      'status',
      '{"indexed":true,"node_count":1234,"edge_count":5678,"indexed_at":"2026-01-01"}',
    );
    expect(output).toContain('**Indexed**: yes');
    expect(output).toContain('**Nodes**: 1,234');
    expect(output).toContain('**Edges**: 5,678');
    expect(output).toContain('2026-01-01');
  });

  it('formats index status with status string variant', () => {
    const output = formatGraphOutput(
      'graph_index',
      'status',
      '{"status":"indexed","nodes":42}',
    );
    expect(output).toContain('**Status**: indexed');
    expect(output).toContain('**Nodes**: 42');
  });

  it('formats project list as table with CBM slug', () => {
    const output = formatGraphOutput(
      'graph_index',
      'list',
      '{"projects":[{"name":"D-project-foo","root_path":"D:/foo","node_count":10,"edge_count":20,"indexed_at":"2026-01-01"}]}',
    );
    expect(output).toContain('Found 1 indexed project');
    expect(output).toContain('| D-project-foo |');
    expect(output).toContain('D:/foo');
    expect(output).toContain('10');
    expect(output).toContain('20');
    expect(output).toContain('slug');
  });

  it('formats empty project list', () => {
    const output = formatGraphOutput('graph_index', 'list', '{"projects":[]}');
    expect(output).toContain('No indexed projects');
  });

  it('formats delete success', () => {
    const output = formatGraphOutput('graph_index', 'delete', '{"deleted":true}');
    expect(output).toContain('deleted');
  });

  it('formats delete not found', () => {
    const output = formatGraphOutput(
      'graph_index',
      'delete',
      '{"status":"not_found"}',
    );
    expect(output).toContain('already clean');
  });

  // ── graph_query ──

  it('formats search results as table', () => {
    const output = formatGraphOutput(
      'graph_query',
      'search',
      '{"results":[{"name":"foo","label":"Function","file":"src/lib.ts","line":10,"qualified_name":"mod::foo"}]}',
    );
    expect(output).toContain('Found 1 symbol');
    expect(output).toContain('| foo |');
    expect(output).toContain('Function');
    expect(output).toContain('src/lib.ts');
  });

it('sanitizes invoke-links prefix from search qualified_name column', () => {
const output = formatGraphOutput(
'graph_query',
'search',
JSON.stringify({
results: [{
name: 'getProductById',
label: 'Function',
file: 'src/stores/products.ts',
qualified_name:
'.C-Users-Administrator-AppData-Roaming-Loom-cbm-invoke-links-ecfb22c20d710397.src.stores.products.getProductById',
}],
}),
);
expect(output).toContain('src.stores.products.getProductById');
expect(output).not.toContain('invoke-links');
expect(output).not.toContain('.src.stores');
});

  it('formats empty search results', () => {
    const output = formatGraphOutput(
      'graph_query',
      'search',
      '{"results":[]}',
    );
    expect(output).toContain('No symbols found');
  });

  it('formats snippet with code block', () => {
    const output = formatGraphOutput(
      'graph_query',
      'snippet',
      '{"code":"fn foo() {}","file":"src/lib.rs","start_line":1,"end_line":1,"qualified_name":"crate::foo"}',
    );
    expect(output).toContain('src/lib.rs');
    expect(output).toContain('lines 1–1');
    expect(output).toContain('```rust');
    expect(output).toContain('fn foo() {}');
  });

  it('formats query results as generic table (object array)', () => {
    const output = formatGraphOutput(
      'graph_query',
      'query',
      '{"results":[{"name":"foo","count":3},{"name":"bar","count":5}]}',
    );
    expect(output).toContain('Found 2 result');
    expect(output).toContain('| foo | 3 |');
    expect(output).toContain('| bar | 5 |');
  });

  it('formats query results with CBM columns/rows format', () => {
    const output = formatGraphOutput(
      'graph_query',
      'query',
      '{"columns":["f.name","f.file"],"rows":[["increment","src/lib.ts"],["getByCategory","src/api.ts"]],"total":2}',
    );
    expect(output).toContain('Found 2 result');
    expect(output).toContain('| f.name | f.file |');
    expect(output).toContain('| increment | src/lib.ts |');
    expect(output).toContain('| getByCategory | src/api.ts |');
  });

  it('formats empty CBM columns/rows query results', () => {
    const output = formatGraphOutput(
      'graph_query',
      'query',
      '{"columns":["f.name"],"rows":[],"total":0}',
    );
    expect(output).toContain('No results');
  });

  // ── graph_trace ──

  it('formats trace with callers and callees', () => {
    const output = formatGraphOutput(
      'graph_trace',
      'trace',
      '{"callers":[{"name":"bar","file":"src/bar.rs","line":5}],"callees":[{"name":"baz","file":"src/baz.rs","line":10}]}',
    );
    expect(output).toContain('Inbound (callers)');
    expect(output).toContain('`bar`');
    expect(output).toContain('src/bar.rs:5');
    expect(output).toContain('Outbound (callees)');
    expect(output).toContain('`baz`');
  });

  it('formats trace with empty call chain and hint', () => {
    const output = formatGraphOutput(
      'graph_trace',
      'trace',
      '{"function":"increment","callers":[],"callees":[]}',
    );
    expect(output).toContain('No CALLS edges');
    expect(output).toContain('graph_query');
  });

  it('formats architecture with CBM node_labels, edge_types, entry_points, layers', () => {
    const output = formatGraphOutput(
      'graph_trace',
      'architecture',
      JSON.stringify({
        total_nodes: 229,
        total_edges: 247,
        node_labels: [
          { label: 'Function', count: 19 },
          { label: 'File', count: 50 },
        ],
        edge_types: [
          { type: 'DEFINES', count: 163 },
          { type: 'IMPORTS', count: 18 },
        ],
        languages: [
          { language: 'TypeScript', file_count: 15 },
          { language: 'CSS', file_count: 2 },
        ],
        packages: [{ name: 'stores', node_count: 6, fan_in: 0, fan_out: 0 }],
        entry_points: [
          { name: 'formatPrice', qualified_name: 'mod.formatPrice', file: 'src/lib.ts' },
        ],
        layers: [{ name: 'data', layer: 'internal', reason: 'fan-in=0, fan-out=0' }],
      }),
    );
    expect(output).toContain('**Nodes**: 229');
    expect(output).toContain('**Edges**: 247');
    expect(output).toContain('**Node labels**: Function (19), File (50)');
    expect(output).toContain('**Edge types**: DEFINES (163), IMPORTS (18)');
    expect(output).toContain('TypeScript (15)');
    expect(output).toContain('**Packages** (1)');
    expect(output).toContain('**Entry points** (1)');
    expect(output).toContain('`formatPrice`');
    expect(output).toContain('**Layers** (1)');
    expect(output).toContain('`data` (internal, fan-in=0, fan-out=0)');
  });

  it('formats changes with CBM changed_files format', () => {
    const output = formatGraphOutput(
      'graph_trace',
      'changes',
      '{"changed_files":["src/lib.ts","src/api.ts","src/utils.ts"]}',
    );
    expect(output).toContain('Detected 3 changed file');
    expect(output).toContain('`src/lib.ts`');
    expect(output).toContain('`src/api.ts`');
    expect(output).toContain('`src/utils.ts`');
  });

  it('formats changes with structured format (fallback)', () => {
    const output = formatGraphOutput(
      'graph_trace',
      'changes',
      '{"changes":[{"file":"src/lib.rs","type":"modified","impacted_functions":["foo","bar"]}]}',
    );
    expect(output).toContain('Detected 1 change');
    expect(output).toContain('src/lib.rs');
    expect(output).toContain('modified');
    expect(output).toContain('foo, bar');
  });

  it('formats empty changed_files', () => {
    const output = formatGraphOutput('graph_trace', 'changes', '{"changed_files":[]}');
    expect(output).toContain('No changes detected');
  });

  // ── fallback ──

  it('falls back to json block for unrecognized shape', () => {
    const output = formatGraphOutput(
      'graph_index',
      'status',
      '{"unknown_field":"value"}',
    );
    expect(output).toContain('```json');
  });

  it('extractFirstQualifiedNameFromSearchRaw reads first match', () => {
    const raw = JSON.stringify({
      results: [{ qualified_name: 'crate::foo', name: 'foo' }],
    });
    expect(extractFirstQualifiedNameFromSearchRaw(raw)).toBe('crate::foo');
  });

  it('snippet with name_pattern auto-searches then fetches snippet', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(
        JSON.stringify({
          results: [{ qualified_name: 'mod::MyClass', name: 'MyClass' }],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ code: 'class MyClass {}', file: 'src/lib.ts', qualified_name: 'mod::MyClass' }),
      );

    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute(
      { action: 'snippet', name_pattern: 'MyClass', repo_path: 'D:\\proj' },
      { baseDir: 'D:\\proj' },
    );

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(1, 'cbm_graph', {
      tool: 'graph_query',
      action: 'search',
      payload: { name_pattern: 'MyClass', limit: 5, repo_path: 'D:\\proj' },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'cbm_graph', {
      tool: 'graph_query',
      action: 'snippet',
      payload: {
        name_pattern: 'MyClass',
        qualified_name: 'mod::MyClass',
        repo_path: 'D:\\proj',
      },
    });
    expect(result.output).toContain('MyClass');
  });

  it('snippet without qualified_name or name_pattern returns error', async () => {
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute({ action: 'snippet' }, { baseDir: 'D:\\proj' });
    expect(result.error).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('query with invalid Cypher returns friendly MATCH guidance', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('expected token type 0, got 85 at pos 0'));
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute(
      { action: 'query', query: 'Function', repo_path: 'D:\\proj' },
      { baseDir: 'D:\\proj' },
    );
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('MATCH');
  });

  // ── trace fallback (no CALLS edges) ──

  it('trace fallback queries all edge types when CALLS edges are empty', async () => {
    // 1st call: trace_path returns empty callers + callees
    // 2nd call: fallback incoming query (DEFINES edge from file)
    // 3rd call: fallback outgoing query (no results)
    vi.mocked(invoke)
      .mockResolvedValueOnce(
        JSON.stringify({ function: 'increment', direction: 'both', callees: [], callers: [] }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ columns: ['rel_type', 'from_name'], rows: [['DEFINES', 'counter.ts']], total: 1 }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ columns: ['rel_type', 'to_name'], rows: [], total: 0 }),
      );

    const handler = graphHandlers.find((item) => item.name === 'graph_trace');
    const result = await handler!.execute(
      { action: 'trace', function_name: 'increment', repo_path: 'D:\\proj' },
      { baseDir: 'D:\\proj' },
    );

    // 3 calls: trace + 2 fallback queries
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(result.output).toContain('Inbound (callers)');
    expect(result.output).toContain('Outbound (callees)');
    // Fallback section should appear
    expect(result.output).toContain('Fallback');
    expect(result.output).toContain('DEFINES');
    expect(result.output).toContain('counter.ts');
    expect(result.output).toContain('increment');
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'cbm_graph',
      expect.objectContaining({
        payload: expect.objectContaining({
          query: expect.stringContaining('type(r) AS rel_type'),
        }),
      }),
    );
  });

  it('trace fallback reports when no relationships exist', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(
        JSON.stringify({ function: 'missing', callers: [], callees: [] }),
      )
      .mockResolvedValueOnce(JSON.stringify({ columns: ['rel_type', 'from_name'], rows: [], total: 0 }))
      .mockResolvedValueOnce(JSON.stringify({ columns: ['rel_type', 'to_name'], rows: [], total: 0 }));

    const handler = graphHandlers.find((item) => item.name === 'graph_trace');
    const result = await handler!.execute(
      { action: 'trace', function_name: 'missing', repo_path: 'D:\\proj' },
      { baseDir: 'D:\\proj' },
    );

    expect(result.output).toContain('No relationships found');
    expect(result.output).toContain('graph_query search');
  });

  it('trace fallback skipped when trace already has results', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      JSON.stringify({
        function: 'foo',
        direction: 'both',
        callees: [{ name: 'bar', file: 'src/bar.ts', line: 5 }],
        callers: [],
      }),
    );

    const handler = graphHandlers.find((item) => item.name === 'graph_trace');
    const result = await handler!.execute(
      { action: 'trace', function_name: 'foo', repo_path: 'D:\\proj' },
      { baseDir: 'D:\\proj' },
    );

    // Only 1 call — no fallback
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.output).not.toContain('Fallback');
    expect(result.output).toContain('bar');
  });

  // ── schema ──

  it('formats schema with node_labels and edge_types', () => {
    const output = formatGraphOutput(
      'graph_query', 'schema',
      JSON.stringify({
        node_labels: [
          { label: 'Function', count: 19, properties: ['name', 'file_path', 'complexity'] },
          { label: 'File', count: 50, properties: ['name', 'extension'] },
        ],
        edge_types: [
          { type: 'DEFINES', count: 163 },
          { type: 'IMPORTS', count: 18 },
        ],
      }),
    );
    expect(output).toContain('**Node labels** (2)');
    expect(output).toContain('**Function** (19)');
    expect(output).toContain('name, file_path, complexity');
    expect(output).toContain('**Edge types** (2)');
    expect(output).toContain('**DEFINES** (163)');
    expect(output).toContain('MATCH/WHERE');
  });

  // ── code search ──

  it('formats code search results with match_lines', () => {
    const output = formatGraphOutput(
      'graph_query', 'code',
      JSON.stringify({
        results: [{
          node: 'increment', label: 'Function',
          file: 'src/stores/counter.ts',
          start_line: 7, end_line: 9,
          match_lines: [7],
        }],
        total_grep_matches: 1,
        dedup_ratio: '1.0x',
      }),
    );
    expect(output).toContain('Found 1 symbol');
    expect(output).toContain('1 grep matches');
    expect(output).toContain('increment');
    expect(output).toContain('src/stores/counter.ts');
    expect(output).toContain('7-9');
    expect(output).toContain('7');  // match_lines
  });

  it('formats empty code search results', () => {
    const output = formatGraphOutput(
      'graph_query', 'code',
      '{"results":[],"total_grep_matches":0}',
    );
    expect(output).toContain('No code matches');
  });

  it('rejects code action without pattern', async () => {
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute({ action: 'code' }, { baseDir: 'D:\\proj' });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('pattern');
    expect(result.error).toContain('action=code');
  });

  it('accepts code action with code alias after normalization', async () => {
    vi.mocked(invoke).mockResolvedValue(JSON.stringify({ results: [] }));
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    await handler!.execute(
      { action: 'code', code: 'TODO', repo_path: 'D:\\proj' },
      { baseDir: 'D:\\proj' },
    );
    expect(invoke).toHaveBeenCalledWith('cbm_graph', {
      tool: 'graph_query',
      action: 'code',
      payload: expect.objectContaining({
        repo_path: 'D:\\proj',
        pattern: 'TODO',
      }),
    });
  });

  it('code action with name_pattern pre-filters symbol hits', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(
        JSON.stringify({
          results: [{ name: 'useImageLoader', qualified_name: 'useImageLoader' }],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          results: [
            { node: 'useImageLoader', label: 'Function', file: 'src/hooks.ts', start_line: 1, end_line: 5 },
            { node: 'component', label: 'Function', file: 'src/router/index.ts', start_line: 1, end_line: 5 },
          ],
          total_grep_matches: 2,
        }),
      );
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute(
      {
        action: 'code',
        name_pattern: 'useImageLoader',
        pattern: 'import',
        repo_path: 'D:\\proj',
      },
      { baseDir: 'D:\\proj' },
    );
    expect(result.output).toContain('useImageLoader');
    expect(result.output).not.toContain('component');
    expect(invoke).toHaveBeenNthCalledWith(1, 'cbm_graph', expect.objectContaining({
      tool: 'graph_query',
      action: 'search',
    }));
    expect(invoke).toHaveBeenNthCalledWith(2, 'cbm_graph', expect.objectContaining({
      tool: 'graph_query',
      action: 'code',
      payload: expect.not.objectContaining({ name_pattern: 'useImageLoader' }),
    }));
  });

  it('filterCodeSearchRawByNamePattern keeps only matching symbols', () => {
    const raw = JSON.stringify({
      results: [
        { node: 'useImageLoader', label: 'Function' },
        { node: 'component', label: 'Function' },
      ],
    });
    const filtered = JSON.parse(filterCodeSearchRawByNamePattern(raw, 'useImageLoader'));
    expect(filtered.results).toHaveLength(1);
    expect(filtered.results[0].node).toBe('useImageLoader');
  });

  it('formats query results with labels() array cells', () => {
    const output = formatGraphOutput(
      'graph_query',
      'query',
      '{"columns":["name","labels(n)"],"rows":[["foo","[\\"Function\\"]"]],"total":1}',
    );
    expect(output).toContain('| foo | Function |');
    expect(output).not.toContain('["Function"]');
  });

  it('routes labels() discovery query to schema', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      JSON.stringify({
        node_labels: [{ label: 'Function', count: 19, properties: ['name'] }],
        edge_types: [{ type: 'CALLS', count: 10 }],
      }),
    );
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute(
      {
        action: 'query',
        query: 'MATCH (n) RETURN DISTINCT labels(n)',
        repo_path: 'D:\\proj',
      },
      { baseDir: 'D:\\proj' },
    );
    expect(invoke).toHaveBeenCalledWith('cbm_graph', {
      tool: 'graph_query',
      action: 'schema',
      payload: { repo_path: 'D:\\proj' },
    });
    expect(result.output).toContain('Function');
    expect(result.output).toContain('Routed');
  });

  it('rewrites search relationship filter to query_graph Cypher', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      JSON.stringify({
        columns: ['edge_type', 'from_name', 'to_name'],
        rows: [['HTTP_CALLS', 'api', 'handler']],
        total: 1,
      }),
    );
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    await handler!.execute(
      { action: 'search', relationship: 'HTTP_CALLS', repo_path: 'D:\\proj' },
      { baseDir: 'D:\\proj' },
    );
    expect(invoke).toHaveBeenCalledWith('cbm_graph', {
      tool: 'graph_query',
      action: 'query',
      payload: expect.objectContaining({
        query: expect.stringContaining('type(r) AS edge_type'),
      }),
    });
  });

  it('formats list indexed_at ISO timestamps', () => {
    const output = formatGraphOutput(
      'graph_index',
      'list',
      '{"projects":[{"name":"D-foo","root_path":"D:/foo","nodes":1,"edges":2,"indexed_at":"2026-03-15T10:20:30Z"}]}',
    );
    expect(output).toContain('2026-03-15 10:20:30');
    expect(output).not.toMatch(/\| — \|$/m);
  });

  it('graph_query list delegates to graph_index list', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      '{"projects":[{"name":"D-foo","root_path":"D:/foo","nodes":1,"edges":2}]}',
    );
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute({ action: 'list' }, { baseDir: 'D:\\proj' });
    expect(invoke).toHaveBeenCalledWith('cbm_graph', {
      tool: 'graph_index',
      action: 'list',
      payload: {},
    });
    expect(result.output).toContain('graph_query · list');
    expect(result.output).toContain('D-foo');
  });

  it('snippet with glob name_pattern converts and searches', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(
        JSON.stringify({
          results: [{ qualified_name: 'mod::useFoo', name: 'useFoo' }],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ code: 'function useFoo() {}', file: 'src/hooks.ts' }),
      );

    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    await handler!.execute(
      { action: 'snippet', name_pattern: 'use*', repo_path: 'D:\\proj' },
      { baseDir: 'D:\\proj' },
    );

    expect(invoke).toHaveBeenNthCalledWith(1, 'cbm_graph', {
      tool: 'graph_query',
      action: 'search',
      payload: { name_pattern: '^use.*$', limit: 5, repo_path: 'D:\\proj' },
    });
  });

it('routes aggregation RETURN with type(r)+count() to schema (Bug #1)', async () => {
vi.mocked(invoke).mockResolvedValueOnce(
JSON.stringify({
node_labels: [{ label: 'Function', count: 19, properties: ['name'] }],
edge_types: [{ type: 'IMPORTS', count: 36 }],
}),
);
const handler = graphHandlers.find((item) => item.name === 'graph_query');
const result = await handler!.execute(
{
action: 'query',
query: 'MATCH ()-[r:IMPORTS]-() RETURN type(r), count(r) AS cnt',
repo_path: 'D:\\proj',
},
{ baseDir: 'D:\\proj' },
);
expect(result.output).toContain('Node labels');
expect(result.output).toContain('Edge types');
expect(result.output).toContain('IMPORTS');
expect(result.output).toContain('incorrect values');
});

  it('filterDetectChangesRaw filters by file hint and drops vendor paths', () => {
    const raw = JSON.stringify({
      changed_files: [
        'src/products.ts',
        'node_modules/foo/index.js',
        'src/other.ts',
      ],
    });
    const filtered = JSON.parse(filterDetectChangesRaw(raw, 'products.ts'));
    expect(filtered.changed_files).toEqual(['src/products.ts']);
  });

  it('graph_trace changes filters changed_files when function_name set', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      JSON.stringify({
        changed_files: [
          'src/products.ts',
          'node_modules/pkg/index.js',
          'src/utils.ts',
        ],
      }),
    );
    const handler = graphHandlers.find((item) => item.name === 'graph_trace');
    const result = await handler!.execute(
      { action: 'changes', function_name: 'products.ts', repo_path: 'D:\\proj' },
      { baseDir: 'D:\\proj' },
    );
    expect(result.output).toContain('products.ts');
    expect(result.output).not.toContain('node_modules');
    expect(result.output).not.toContain('utils.ts');
  });

  // ── Bug #1/#2: aggregate type(r)/labels(n) + count() routing ──

  it('routes type(r) + count(*) aggregate to schema (Bug #1)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      JSON.stringify({
        node_labels: [{ label: 'Function', count: 19, properties: ['name'] }],
        edge_types: [{ type: 'DEFINES', count: 163 }],
      }),
    );
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute(
      {
        action: 'query',
        query: 'MATCH (n)-[r]->(m) RETURN type(r), count(*)',
        repo_path: 'D:\\proj',
      },
      { baseDir: 'D:\\proj' },
    );
    expect(result.output).toContain('Node labels');
    expect(result.output).toContain('Edge types');
    expect(result.output).toContain('incorrect values');
  });

  it('routes labels(n) + count() aggregate to schema (Bug #2)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      JSON.stringify({
        node_labels: [{ label: 'Module', count: 50, properties: ['name'] }],
        edge_types: [],
      }),
    );
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute(
      {
        action: 'query',
        query: 'MATCH (n) RETURN labels(n), count(n)',
        repo_path: 'D:\\proj',
      },
      { baseDir: 'D:\\proj' },
    );
    expect(result.output).toContain('Node labels');
    expect(result.output).toContain('Module');
  });

  it('does not route non-aggregate type(r) queries to schema', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(
      JSON.stringify({
        columns: ['rel_type', 'from_name'],
        rows: [['DEFINES', 'counter.ts']],
        total: 1,
      }),
    );
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute(
      {
        action: 'query',
        query: "MATCH (a)-[r]->(b) RETURN type(r) AS rel, a.name",
        repo_path: 'D:\\proj',
      },
      { baseDir: 'D:\\proj' },
    );
    expect(result.output).toContain('Found 1 result');
    expect(result.output).not.toContain('incorrect values');
  });

  // ── Bug #5: MATCH path = ... hint ──

  it('returns hint for MATCH path = ... syntax (Bug #5)', async () => {
    const handler = graphHandlers.find((item) => item.name === 'graph_query');
    const result = await handler!.execute(
      {
        action: 'query',
        query: 'MATCH path = (n)-[r]->(m) RETURN path LIMIT 5',
        repo_path: 'D:\\proj',
      },
      { baseDir: 'D:\\proj' },
    );
    expect(result.output).toContain('path variables');
    expect(result.output).toContain('graph_trace');
    expect(invoke).not.toHaveBeenCalled();
  });

  // ── Bug #4: trace fallback for non-Function nodes ──

  it('trace fallback queries without :Function label for non-function nodes (Bug #4)', async () => {
    // 1st: trace_path returns empty (TheWelcome is a Module, not Function)
    // 2nd: fallback incoming (IMPORTS edge from App.vue)
    // 3rd: fallback outgoing (no results)
    vi.mocked(invoke)
      .mockResolvedValueOnce(
        JSON.stringify({ function: 'TheWelcome', direction: 'both', callees: [], callers: [] }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          columns: ['rel_type', 'from_name'],
          rows: [['IMPORTS', 'App.vue']],
          total: 1,
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ columns: ['rel_type', 'to_name'], rows: [], total: 0 }),
      );

    const handler = graphHandlers.find((item) => item.name === 'graph_trace');
    const result = await handler!.execute(
      { action: 'trace', function_name: 'TheWelcome', repo_path: 'D:\\proj' },
      { baseDir: 'D:\\proj' },
    );

    expect(invoke).toHaveBeenCalledTimes(3);
    // The fallback query should NOT contain :Function label constraint
    const secondCall = vi.mocked(invoke).mock.calls[1];
    const payload = secondCall?.[1] as Record<string, unknown>;
    const innerPayload = payload?.payload as Record<string, unknown>;
    expect(String(innerPayload?.query)).not.toContain(':Function');
    expect(result.output).toContain('Fallback');
    expect(result.output).toContain('IMPORTS');
    expect(result.output).toContain('App.vue');
  });

  // ── Bug #6: code search empty hint ──

  it('code search empty hint mentions symbol bodies not import/export (Bug #6)', () => {
    const output = formatGraphOutput(
      'graph_query', 'code',
      '{"results":[],"total_grep_matches":0}',
    );
    expect(output).toContain('symbol bodies');
    expect(output).toContain('import');
  });
});
