import { describe, it, expect } from 'vitest';
import { parseSubagentResult } from '../resultParser';

describe('parseSubagentResult', () => {
  it('extracts file artifacts from summary text', () => {
    const parsed = parseSubagentResult('Updated src/utils/foo.ts and README.md');
    expect(parsed.artifacts?.some((a) => a.type === 'file' && a.ref.includes('foo.ts'))).toBe(true);
  });

  it('extracts assumptions section', () => {
    const summary = `## Summary\nDone.\n\n## Assumptions\n- API is reachable\n- Tests pass locally`;
    const parsed = parseSubagentResult(summary);
    expect(parsed.assumptions).toContain('API is reachable');
  });
});
