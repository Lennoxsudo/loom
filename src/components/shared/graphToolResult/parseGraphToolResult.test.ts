import { describe, expect, it } from 'vitest';
import { formatGraphOutput } from '../../../features/agent-engine/handlers/graphHandlers';
import { parseGraphToolResult } from './parseGraphToolResult';

describe('parseGraphToolResult', () => {
  it('returns null for non-graph tools', () => {
    expect(parseGraphToolResult({ toolName: 'read', text: 'file content' })).toBeNull();
  });

  it('parses graph_index status with stats summary', () => {
    const text = formatGraphOutput(
      'graph_index',
      'status',
      '{"indexed":true,"node_count":1234,"edge_count":5678,"indexed_at":"2026-01-01"}'
    );
    const view = parseGraphToolResult({
      toolName: 'graph_index',
      toolArgs: { action: 'status' },
      text,
    });
    expect(view?.tool).toBe('graph_index');
    expect(view?.action).toBe('status');
    expect(view?.summary).toContain('Indexed');
    expect(view?.summary).toContain('1,234 nodes');
    expect(view?.stats?.some((s) => s.label === 'Indexed')).toBe(true);
  });

  it('parses graph_index project list table', () => {
    const text = formatGraphOutput(
      'graph_index',
      'list',
      '{"projects":[{"repo_path":"D:/foo","node_count":10,"indexed_at":"2026-01-01"}]}'
    );
    const view = parseGraphToolResult({
      toolName: 'graph_index',
      toolArgs: { action: 'list' },
      text,
    });
    expect(view?.summary).toBe('1 project');
    expect(view?.table?.headers).toContain('Project');
    expect(view?.table?.rows[0]).toContain('foo');
  });

  it('parses graph_query search table', () => {
    const text = formatGraphOutput(
      'graph_query',
      'search',
      '{"results":[{"name":"foo","label":"Function","file":"src/lib.ts","line":10,"qualified_name":"mod::foo"}]}'
    );
    const view = parseGraphToolResult({
      toolName: 'graph_query',
      toolArgs: { action: 'search', query: 'foo' },
      text,
    });
    expect(view?.summary).toBe('1 symbol');
    expect(view?.panelMeta).toBeUndefined();
    expect(view?.table?.rows[0]).toContain('Function');
  });

  it('parses graph_query snippet code block', () => {
    const text = formatGraphOutput(
      'graph_query',
      'snippet',
      '{"code":"fn foo() {}","file":"src/lib.rs","start_line":1,"end_line":1,"qualified_name":"crate::foo"}'
    );
    const view = parseGraphToolResult({
      toolName: 'graph_query',
      toolArgs: { action: 'snippet', qualified_name: 'crate::foo' },
      text,
    });
    expect(view?.codeBlock?.code).toContain('fn foo()');
    expect(view?.codeBlock?.file).toContain('src/lib.rs');
    expect(view?.summary).toContain('lib.rs');
  });

  it('parses graph_trace inbound/outbound sections', () => {
    const text = formatGraphOutput(
      'graph_trace',
      'trace',
      '{"callers":[{"name":"bar","file":"src/bar.rs","line":5}],"callees":[{"name":"baz","file":"src/baz.rs","line":10}]}'
    );
    const view = parseGraphToolResult({
      toolName: 'graph_trace',
      toolArgs: { action: 'trace', function_name: 'foo' },
      text,
    });
    expect(view?.summary).toBe('Inbound 1 · Outbound 1');
    expect(view?.sections?.some((s) => s.title.includes('Inbound'))).toBe(true);
  });

  it('parses graph_trace architecture stats', () => {
    const text = formatGraphOutput(
      'graph_trace',
      'architecture',
      JSON.stringify({
        total_nodes: 229,
        total_edges: 247,
        node_labels: [{ label: 'Function', count: 19 }],
        edge_types: [{ type: 'DEFINES', count: 163 }],
      })
    );
    const view = parseGraphToolResult({
      toolName: 'graph_trace',
      toolArgs: { action: 'architecture' },
      text,
    });
    expect(view?.summary).toContain('229 nodes');
    expect(view?.summary).toContain('247 edges');
  });

  it('marks empty search as empty', () => {
    const text = formatGraphOutput('graph_query', 'search', '{"results":[]}');
    const view = parseGraphToolResult({
      toolName: 'graph_query',
      toolArgs: { action: 'search' },
      text,
    });
    expect(view?.isEmpty).toBe(true);
    expect(view?.summary).toBe('No results');
  });

  it('detects error output', () => {
    const view = parseGraphToolResult({
      toolName: 'graph_index',
      toolArgs: { action: 'index' },
      text: '### graph_index · index\n\n❌ 代码图谱索引失败',
      isError: true,
    });
    expect(view?.isError).toBe(true);
    expect(view?.summary).toBe('Failed');
  });
});
