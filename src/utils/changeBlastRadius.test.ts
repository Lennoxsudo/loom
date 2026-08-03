import { describe, expect, it, vi } from 'vitest';
import {
  BLAST_RADIUS_HIGH_RISK_CALLERS,
  BLAST_RADIUS_MAX_SYMBOLS,
  denoiseAndRankCallers,
  formatBlastCallerPath,
  importersFromTextHits,
  isImportLikePreview,
  isNoiseCaller,
  isNoiseCallerFile,
  loadChangeBlastRadius,
  moduleHintFromFilePath,
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
      { name: 'a', file: 'src/a.ts', line: 1, kind: 'calls' },
      { name: 'b', file: 'src/b.ts', line: 2, kind: 'calls' },
    ]);
  });
});

describe('parseCallersFromQueryRaw', () => {
  it('parses column rows with edge kind', () => {
    const callers = parseCallersFromQueryRaw(
      JSON.stringify({
        rows: [
          ['CALLS', 'callerA', 'src/a.ts'],
          ['IMPORTS', 'callerB', 'src/b.ts'],
        ],
      })
    );
    expect(callers).toEqual([
      { name: 'callerA', file: 'src/a.ts', kind: 'calls' },
      { name: 'callerB', file: 'src/b.ts', kind: 'imports' },
    ]);
  });
});

describe('denoiseAndRankCallers', () => {
  it('drops self-file and backup, keeps other-dir same basename, prefers imports', () => {
    expect(isNoiseCallerFile('src/data/products.ts', 'src/data/products.ts')).toBe(true);
    expect(isNoiseCallerFile('src/data/products_backup.ts', 'src/data/products.ts')).toBe(true);
    expect(isNoiseCallerFile('src/views/ProductDetailView.vue', 'src/data/products.ts')).toBe(
      false
    );

    const ranked = denoiseAndRankCallers(
      [
        { name: 'self', file: 'src/data/products.ts', kind: 'calls' },
        { name: 'backupFn', file: 'src/data/products_backup.ts', kind: 'calls' },
        { name: 'dupA', file: 'src/views/ProductDetailView.vue', kind: 'calls' },
        { name: 'dupB', file: 'src/views/ProductDetailView.vue', kind: 'imports' },
        { name: 'store', file: 'src/stores/products.ts', kind: 'imports' },
      ],
      'src/data/products.ts'
    );

    expect(ranked.map((c) => c.file)).toEqual([
      'src/stores/products.ts',
      'src/views/ProductDetailView.vue',
    ]);
    expect(ranked[0].kind).toBe('imports');
  });

  it('drops screenshot-shaped File-node self callers (name=file=basename)', () => {
    const target = 'D:\\project\\酷态科\\src\\data\\products.ts';
    expect(
      isNoiseCaller({ name: 'products.ts', file: 'products.ts', kind: 'calls' }, target)
    ).toBe(true);
    expect(isNoiseCaller({ name: 'products.ts', kind: 'calls' }, target)).toBe(true);

    const ranked = denoiseAndRankCallers(
      [
        { name: 'products.ts', file: 'products.ts', kind: 'calls' },
        { name: 'products.ts', file: 'src/data/products.ts', kind: 'calls' },
        { name: 'getProductById', file: 'src/views/ProductDetailView.vue', kind: 'calls' },
      ],
      target
    );
    expect(ranked.map((c) => c.file)).toEqual(['src/views/ProductDetailView.vue']);
  });
});

describe('moduleHint / text importers', () => {
  it('builds module hint and import-like preview checks', () => {
    expect(moduleHintFromFilePath('src/data/products.ts')).toBe('data/products');
    expect(formatBlastCallerPath('src/stores/products.ts')).toBe('stores/products.ts');
    expect(
      isImportLikePreview(
        "import { getProductById } from '@/data/products'",
        'data/products'
      )
    ).toBe(true);
    expect(isImportLikePreview('const x = data/products', 'data/products')).toBe(false);
  });

  it('maps text hits to importers and drops self/non-import', () => {
    const callers = importersFromTextHits(
      [
        {
          path: 'src/data/products.ts',
          preview: "export const products = []",
        },
        {
          path: 'src/stores/products.ts',
          line: 3,
          preview: "import { products as productData } from '@/data/products'",
        },
        {
          path: 'src/views/ProductDetailView.vue',
          line: 124,
          preview: "import { getProductById } from '@/data/products'",
        },
        {
          path: 'README.md',
          preview: 'see data/products for catalog',
        },
      ],
      'src/data/products.ts',
      'data/products'
    );
    expect(callers.map((c) => c.file)).toEqual([
      'src/stores/products.ts',
      'src/views/ProductDetailView.vue',
    ]);
    expect(callers.every((c) => c.kind === 'imports')).toBe(true);
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
    expect(result.symbols[0].callers).toEqual([
      { name: 'bar', file: 'src/bar.ts', kind: 'imports' },
    ]);
  });

  it('loads file importers and omits symbols that only had self/backup callers', async () => {
    const deps: ChangeBlastRadiusDeps = {
      searchFileSymbolsRaw: vi
        .fn()
        .mockResolvedValue(JSON.stringify({ results: [{ name: 'getProductById' }] })),
      traceInboundRaw: vi.fn().mockResolvedValue(
        JSON.stringify({
          callers: [
            { name: 'products.ts', file: 'products.ts', line: 1 },
            { name: 'bak', file: 'src/data/products_backup.ts', line: 2 },
          ],
        })
      ),
      queryFileImportersRaw: vi.fn().mockResolvedValue(
        JSON.stringify({
          rows: [
            ['IMPORTS', 'ProductDetailView', 'src/views/ProductDetailView.vue'],
            ['IMPORTS', 'useProductsStore', 'src/stores/products.ts'],
            ['IMPORTS', 'noise', 'src/data/products.ts'],
          ],
        })
      ),
    };

    const result = await loadChangeBlastRadius(
      { projectPath: '/repo', filePath: 'src/data/products.ts' },
      deps
    );

    expect(result.fileImporters.map((c) => c.file)).toEqual([
      'src/stores/products.ts',
      'src/views/ProductDetailView.vue',
    ]);
    expect(result.symbols).toEqual([]);
    expect(result.empty).toBe(false);
  });

  it('falls back to text search when graph importers empty (screenshot repro)', async () => {
    const deps: ChangeBlastRadiusDeps = {
      searchFileSymbolsRaw: vi.fn().mockResolvedValue(
        JSON.stringify({
          results: [
            { name: 'Product' },
            { name: 'getByCategory' },
            { name: 'getBySeries' },
            { name: 'getProductById' },
            { name: 'getRecommendProducts' },
          ],
        })
      ),
      traceInboundRaw: vi.fn().mockResolvedValue(
        JSON.stringify({
          callers: [{ name: 'products.ts', file: 'products.ts' }],
        })
      ),
      queryFileImportersRaw: vi.fn().mockResolvedValue(JSON.stringify({ rows: [] })),
      searchImportRefs: vi.fn().mockResolvedValue([
        {
          path: 'src/stores/products.ts',
          line: 3,
          preview: "import { products as productData, type Product } from '@/data/products'",
        },
        {
          path: 'src/views/ProductDetailView.vue',
          line: 124,
          preview:
            "import { getProductById, getRecommendProducts, type Product } from '@/data/products'",
        },
      ]),
    };

    const result = await loadChangeBlastRadius(
      {
        projectPath: 'D:\\project\\酷态科',
        filePath: 'D:\\project\\酷态科\\src\\data\\products.ts',
      },
      deps
    );

    expect(deps.searchImportRefs).toHaveBeenCalledWith(
      'D:\\project\\酷态科',
      'data/products'
    );
    expect(result.fileImporters.map((c) => formatBlastCallerPath(c.file!))).toEqual([
      'stores/products.ts',
      'views/ProductDetailView.vue',
    ]);
    expect(result.symbols).toEqual([]);
    expect(result.empty).toBe(false);
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
