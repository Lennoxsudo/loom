import { describe, expect, it } from 'vitest';
import {
  formatCbmQueryCell,
  formatGraphQueryValidationHint,
  globToNamePatternRegex,
  isAggregateSchemaIntent,
  isLabelsTypesSchemaIntent,
  normalizeCbmCypher,
  normalizeGraphQueryArgs,
  qualifiedNameToQnPattern,
  rewriteGraphSearchDegreeFilter,
  rewriteCodePropertyCypher,
  sanitizeCbmQualifiedName,
} from '../graphQueryNormalize';
describe('normalizeGraphQueryArgs', () => {
  it('maps cypher alias to query for action=query', () => {
    const result = normalizeGraphQueryArgs({
      action: 'query',
      cypher: 'MATCH (f:Function) RETURN f LIMIT 5',
    });
    expect(result.query).toBe('MATCH (f:Function) RETURN f LIMIT 5');
  });

  it('maps code/text to pattern for action=code', () => {
    expect(
      normalizeGraphQueryArgs({ action: 'code', code: 'TODO' }).pattern,
    ).toBe('TODO');
    expect(
      normalizeGraphQueryArgs({ action: 'code', query: 'deprecated', pattern: undefined }).pattern,
    ).toBe('deprecated');
  });

  it('rewrites search+relationship to Cypher query (not degree counts)', () => {
    const result = normalizeGraphQueryArgs({
      action: 'search',
      relationship: 'HTTP_CALLS',
    });
    expect(result.action).toBe('query');
    expect(String(result.query)).toContain('type(r) AS edge_type');
    expect(String(result.query)).toContain('HTTP_CALLS');
  });

  it('rewrites dead-code search to Cypher with labels()', () => {
    const result = normalizeGraphQueryArgs({
      action: 'search',
      max_degree: 0,
      exclude_entry_points: true,
    });
    expect(result.action).toBe('query');
    expect(String(result.query)).toContain('labels(n)');
  });

  it('maps qualified_name to qn_pattern for action=search', () => {
    const result = normalizeGraphQueryArgs({
      action: 'search',
      qualified_name: '.src.stores.products.getProductById',
    });
    expect(result.qn_pattern).toBe(
      '^\\.src\\.stores\\.products\\.getProductById$',
    );
  });

  it('keeps regex boolean separate from pattern string', () => {
    const result = normalizeGraphQueryArgs({
      action: 'search',
      name_pattern: '.*Auth.*',
      regex: true,
    });
    expect(result.regex).toBe(true);
    expect(result.pattern).toBeUndefined();
    expect(result.name_pattern).toBe('.*Auth.*');
  });

  it('injects file_pattern into query action Cypher', () => {
    const result = normalizeGraphQueryArgs({
      action: 'query',
      query: 'MATCH (f:Function) RETURN f.name LIMIT 10',
      file_pattern: 'src/utils/**',
    });
    expect(String(result.query)).toContain('file_path =~');
    expect(String(result.query)).toContain('WHERE');
  });

  it('rewrites RETURN n.code to metadata fields', () => {
    const { query, rewritten } = rewriteCodePropertyCypher(
      'MATCH (f:Function) RETURN f.code LIMIT 5',
    );
    expect(rewritten).toBe(true);
    expect(query).toContain('f.file_path');
    expect(query).not.toContain('f.code');
  });

  it('reroutes action=code with Cypher query to action=query', () => {
    const result = normalizeGraphQueryArgs({
      action: 'code',
      query: 'MATCH (f:Function) RETURN f.code',
    });
    expect(result.action).toBe('query');
    expect(String(result.query)).toContain('file_path');
    expect(result.pattern).toBeUndefined();
  });

  it('sets default limit for code grep action', () => {
    const result = normalizeGraphQueryArgs({
      action: 'code',
      pattern: 'import',
    });
    expect(result.pattern).toBe('import');
    expect(result.limit).toBe(20);
    expect(result.query).toBeUndefined();
  });

  it('maps pattern to name_pattern for snippet and converts globs', () => {
    const result = normalizeGraphQueryArgs({
      action: 'snippet',
      pattern: 'use*',
    });
    expect(result.name_pattern).toBe('^use.*$');
  });

  it('converts glob name_pattern for search', () => {
    const result = normalizeGraphQueryArgs({
      action: 'search',
      name_pattern: 'use*',
    });
    expect(result.name_pattern).toBe('^use.*$');
  });
});

describe('qualifiedNameToQnPattern', () => {
  it('escapes dots for exact qualified_name match', () => {
    expect(qualifiedNameToQnPattern('.src.stores.products.getProductById')).toBe(
      '^\\.src\\.stores\\.products\\.getProductById$',
    );
  });

  it('passes through raw regex when regex=true', () => {
    expect(qualifiedNameToQnPattern('.*Product.*', true)).toBe('.*Product.*');
  });
});

describe('sanitizeCbmQualifiedName', () => {
  it('strips invoke-links project prefix and leading dot', () => {
    expect(
      sanitizeCbmQualifiedName(
        'C-Users-Administrator-AppData-Roaming-Loom-cbm-invoke-links-ecfb22c20d710397.src.stores.products.getProductById',
      ),
    ).toBe('src.stores.products.getProductById');
  });

  it('strips __file__ suffix from File-label nodes (Bug #7)', () => {
    expect(
      sanitizeCbmQualifiedName(
        'C-Users-Administrator-AppData-Roaming-Loom-cbm-invoke-links-ecfb22c20d710397.src.components.TheWelcome.__file__',
      ),
    ).toBe('src.components.TheWelcome');
  });

  it('handles input with leading dot', () => {
    expect(
      sanitizeCbmQualifiedName(
        '.C-Users-Administrator-AppData-Roaming-Loom-cbm-invoke-links-ecfb22c20d710397.src.stores.products.getProductById',
      ),
    ).toBe('src.stores.products.getProductById');
  });

  it('passes through non-invoke-links qualified names', () => {
    expect(sanitizeCbmQualifiedName('src.stores.products.getProductById')).toBe(
      'src.stores.products.getProductById',
    );
  });
});

describe('rewriteGraphSearchDegreeFilter', () => {
  it('returns null for normal symbol search', () => {
    expect(
      rewriteGraphSearchDegreeFilter({ action: 'search', name_pattern: '.*Auth.*' }),
    ).toBeNull();
  });
});

describe('isLabelsTypesSchemaIntent', () => {
  it('detects labels() discovery queries', () => {
    expect(isLabelsTypesSchemaIntent('MATCH (n) RETURN DISTINCT labels(n)')).toBe(true);
    expect(isLabelsTypesSchemaIntent('CALL db.labels()')).toBe(true);
  });

  it('detects type(r) edge discovery', () => {
    expect(
      isLabelsTypesSchemaIntent('MATCH ()-[r]->() RETURN DISTINCT type(r)'),
    ).toBe(true);
  });

  it('does not treat aggregation or multi-column RETURN as schema', () => {
    expect(
      isLabelsTypesSchemaIntent('MATCH ()-[r:CONTAINS]->() RETURN type(r), count(*)'),
    ).toBe(false);
    expect(isLabelsTypesSchemaIntent('MATCH (n) RETURN labels(n)[0] AS type')).toBe(false);
    expect(
      isLabelsTypesSchemaIntent(
        'MATCH (s:Section)-[r:CONTAINS]->(sub) RETURN s.name, type(r), sub.name',
      ),
    ).toBe(false);
  });
});

describe('isAggregateSchemaIntent', () => {
  it('detects type(r) + count() aggregation (Bug #1)', () => {
    expect(
      isAggregateSchemaIntent('MATCH (n)-[r]->(m) RETURN type(r), count(*)'),
    ).toBe(true);
  });

  it('detects labels(n) + count() aggregation (Bug #2)', () => {
    expect(
      isAggregateSchemaIntent('MATCH (n) RETURN labels(n), count(n)'),
    ).toBe(true);
  });

  it('does not match non-aggregate type(r) queries', () => {
    expect(
      isAggregateSchemaIntent('MATCH (a)-[r]->(b) RETURN type(r) AS rel, a.name'),
    ).toBe(false);
  });

  it('does not match non-MATCH queries', () => {
    expect(isAggregateSchemaIntent('RETURN type(r), count(*)')).toBe(false);
  });

  it('does not match queries without type()/labels()', () => {
    expect(
      isAggregateSchemaIntent('MATCH (n) RETURN n.name, count(n)'),
    ).toBe(false);
  });
});

describe('globToNamePatternRegex', () => {
  it('converts simple globs to anchored regex', () => {
    expect(globToNamePatternRegex('use*')).toBe('^use.*$');
    expect(globToNamePatternRegex('.*Auth.*', true)).toBe('.*Auth.*');
  });
});

describe('normalizeCbmCypher', () => {
  it('rewrites relationshipType to type', () => {
    const { query } = normalizeCbmCypher(
      'MATCH (a)-[r]->(b) RETURN relationshipType(r), a.name',
    );
    expect(query).toContain('type(r)');
    expect(query).not.toContain('relationshipType');
  });

  it('rewrites n.labels to labels(n)', () => {
    const { query } = normalizeCbmCypher('MATCH (n) RETURN n.labels');
    expect(query).toContain('labels(n)');
  });

  it('rewrites WHERE labels(n) = label to n.label', () => {
    const { query } = normalizeCbmCypher(
      'MATCH (n) WHERE labels(n) = "Function" RETURN n.name',
    );
    expect(query).toContain('n.label = \'Function\'');
  });

  it('rejects CALL db.labels with hint', () => {
    const { hint } = normalizeCbmCypher('CALL db.labels()');
    expect(hint).toContain('schema');
  });

  it('fixes RETURN label( typo to labels(', () => {
    const { query } = normalizeCbmCypher('MATCH (n:Module) RETURN label(n)');
    expect(query).toContain('labels(n)');
  });

  it('rewrites labels(n)[0] and adds RETURN aliases for type/count', () => {
    const { query } = normalizeCbmCypher(
      'MATCH ()-[r:IMPORTS]-() RETURN type(r), count(r) AS cnt',
    );
    expect(query).toContain('type(r) AS rel_type');
    expect(query).toContain('count(r) AS cnt');

    const labels = normalizeCbmCypher('MATCH (n) RETURN labels(n)[0] AS type');
    expect(labels.query).toContain('n.label AS type');
  });

  it('rewrites count(*) to count(relVar)', () => {
    const { query } = normalizeCbmCypher(
      'MATCH ()-[r:CONTAINS]->() RETURN type(r), count(*)',
    );
    expect(query).toContain('count(r)');
    expect(query).toContain('type(r) AS rel_type');
  });
});

describe('formatCbmQueryCell', () => {
  it('unwraps labels() JSON array strings', () => {
    expect(formatCbmQueryCell('["Function"]', 'labels(n)')).toBe('Function');
    expect(formatCbmQueryCell('["Module","Function"]', 'lbl')).toBe('Module, Function');
  });

  it('passes through type(r) strings', () => {
    expect(formatCbmQueryCell('CALLS', 'edge_type')).toBe('CALLS');
  });
});

describe('formatGraphQueryValidationHint', () => {
  it('includes examples for query and code', () => {
    expect(formatGraphQueryValidationHint('query', 'query')).toContain('MATCH');
    expect(formatGraphQueryValidationHint('code', 'pattern')).toContain('pattern');
  });
});
