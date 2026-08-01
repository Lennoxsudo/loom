import { describe, expect, it, vi } from 'vitest';
import {
  BLAST_RADIUS_HIGH_RISK_CALLERS,
  BLAST_RADIUS_MAX_SYMBOLS,
  loadChangeBlastRadius,
  parseCallersFromQueryRaw,
  parseCallersFromTraceRaw,
  selectSymbolsForBlastRadius,
  type ChangeBlastRadiusDeps,
} from './changeBlastRadius';

describe('selectSymbolsForBlastRadius', () => {
  it('prefers name fields and caps at max', () => {
    const results = Array.from({ length: 8 }, (_, i) => ({
      name: `sym${i}`,
      qualified_name: `pkg.sym${i}`,
    }));
    const names = selectSymbolsForBlastRadius(JSON.stringify({ results }), 5);
    expect(names).toHaveLength(BLAST_RADIUS_MAX_SYMBOLS);
    expect(names[0]).toBe('sym0');
    expect(names).not.toContain('pkg.sym0');
  });

  it('returns empty for invalid JSON', () => {
    expect(selectSymbolsForBlastRadius('not-json')).toEqual([]);
  });
});

describe('parseCallersFromTraceRaw', () => {
  it('parses callers and dedupes', () => {
    const callers = parseCallersFromTraceRaw(
      JSON.stringify({
        callers: [
          { name: 'a', file: 'src/a.ts', line: 1 },
          { name: 'a', file: 'src/a.ts', line: 1 },
          { name: 'b', file: 'src/b.ts', line: 2 },
        ],
      })
    );
    expect(callers).toEqual([
      { name: 'a', file: 'src/a.ts', line: 1 },
      { name: 'b', file: 'src/b.ts', line: 2 },
    ]);
  });
});

describe('parseCallersFromQueryRaw', () => {
  it('parses column rows', () => {
    const callers = parseCallersFromQueryRaw(
      JSON.stringify({
        rows: [
          ['CALLS', 'callerA', 'src/a.ts'],
          ['IMPORTS', 'callerB', 'src/b.ts'],
        ],
      })
    );
    expect(callers).toEqual([
      { name: 'callerA', file: 'src/a.ts' },
      { name: 'callerB', file: 'src/b.ts' },
    ]);
  });
});

describe('loadChangeBlastRadius', () => {
  it('aggregates callers and marks high risk', async () => {
    const manyCallers = Array.from({ length: BLAST_RADIUS_HIGH_RISK_CALLERS }, (_, i) => ({
      name: `c${i}`,
      file: `f${i}.ts`,
      line: i,
    }));

    const deps: ChangeBlastRadiusDeps = {
      searchFileSymbolsRaw: vi.fn().mockResolvedValue(
        JSON.stringify({ results: [{ name: 'hot' }, { name: 'cold' }] })
      ),
      traceInboundRaw: vi.fn().mockImplementation(async (_repo, symbol: string) => {
        if (symbol === 'hot') {
          return JSON.stringify({ callers: manyCallers });
        }
        return JSON.stringify({ callers: [{ name: 'one', file: 'x.ts', line: 1 }] });
      }),
    };

    const result = await loadChangeBlastRadius(
      { projectPath: 'D:\\proj', filePath: 'src/demo.ts' },
      deps
    );

    expect(deps.searchFileSymbolsRaw).toHaveBeenCalledWith('D:\\proj', 'demo.ts');
    expect(result.symbols).toHaveLength(2);
    expect(result.symbols[0]).toMatchObject({ symbol: 'hot', highRisk: true });
    expect(result.symbols[0].callers).toHaveLength(BLAST_RADIUS_HIGH_RISK_CALLERS);
    expect(result.symbols[1]).toMatchObject({ symbol: 'cold', highRisk: false });
    expect(result.empty).toBe(false);
  });

  it('uses fallback query when trace callers empty', async () => {
    const deps: ChangeBlastRadiusDeps = {
      searchFileSymbolsRaw: vi
        .fn()
        .mockResolvedValue(JSON.stringify({ results: [{ name: 'foo' }] })),
      traceInboundRaw: vi.fn().mockResolvedValue(JSON.stringify({ callers: [], callees: [] })),
      queryInboundFallbackRaw: vi.fn().mockResolvedValue(
        JSON.stringify({ rows: [['USAGE', 'bar', 'src/bar.ts']] })
      ),
    };

    const result = await loadChangeBlastRadius(
      { projectPath: '/repo', filePath: 'src/foo.ts' },
      deps
    );

    expect(deps.queryInboundFallbackRaw).toHaveBeenCalled();
    expect(result.symbols[0].callers).toEqual([{ name: 'bar', file: 'src/bar.ts' }]);
  });

  it('returns empty when no symbols', async () => {
    const deps: ChangeBlastRadiusDeps = {
      searchFileSymbolsRaw: vi.fn().mockResolvedValue(JSON.stringify({ results: [] })),
      traceInboundRaw: vi.fn(),
    };

    const result = await loadChangeBlastRadius(
      { projectPath: '/repo', filePath: 'src/x.ts' },
      deps
    );

    expect(result.empty).toBe(true);
    expect(result.symbols).toEqual([]);
    expect(deps.traceInboundRaw).not.toHaveBeenCalled();
  });

  it('caps symbols at BLAST_RADIUS_MAX_SYMBOLS', async () => {
    const results = Array.from({ length: 10 }, (_, i) => ({ name: `s${i}` }));
    const deps: ChangeBlastRadiusDeps = {
      searchFileSymbolsRaw: vi.fn().mockResolvedValue(JSON.stringify({ results })),
      traceInboundRaw: vi.fn().mockResolvedValue(JSON.stringify({ callers: [] })),
    };

    await loadChangeBlastRadius({ projectPath: '/repo', filePath: 'a.ts' }, deps);
    expect(deps.traceInboundRaw).toHaveBeenCalledTimes(BLAST_RADIUS_MAX_SYMBOLS);
  });
});
