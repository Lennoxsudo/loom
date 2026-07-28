import { describe, it, expect } from 'vitest';
import {
  dedupeContextAnnotations,
  extractPathMentionsFromText,
  isPathLikeMention,
  mergeAnnotationsFromText,
  parseAtMentionToken,
  replaceAtMentionToken,
  serializeContextAnnotations,
  splitPrefixedUserMessageContent,
  extractAnnotationLabelsFromPrefix,
  type ContextAnnotation,
} from '../contextAnnotations';

describe('contextAnnotations', () => {
  it('treats codebase and path-like tokens as mentions', () => {
    expect(isPathLikeMention('codebase')).toBe(true);
    expect(isPathLikeMention('src/App.tsx')).toBe(true);
    expect(isPathLikeMention('src\\main.ts')).toBe(true);
    expect(isPathLikeMention('autoplan')).toBe(false);
    expect(isPathLikeMention('benchmark')).toBe(false);
  });

  it('extracts path mentions and ignores bare @skill names', () => {
    const text = 'use @autoplan and @codebase then @src/App.tsx @src/components/';
    expect(extractPathMentionsFromText(text)).toEqual([
      'codebase',
      'src/App.tsx',
      'src/components/',
    ]);
  });

  it('parses @ token at cursor', () => {
    expect(parseAtMentionToken('hello @co', 9)).toEqual({
      start: 6,
      end: 9,
      query: 'co',
    });
    expect(parseAtMentionToken('hello @co world', 9)).toEqual({
      start: 6,
      end: 9,
      query: 'co',
    });
    expect(parseAtMentionToken('hello world', 5)).toBeNull();
  });

  it('replaces @ token with mention label', () => {
    expect(replaceAtMentionToken('see @Ap', { start: 4, end: 7, query: 'Ap' }, 'src/App.tsx')).toEqual(
      {
        nextValue: 'see @src/App.tsx ',
        cursor: 17,
      }
    );
  });

  it('serializes annotations as path-only block', () => {
    const annotations: ContextAnnotation[] = [
      { id: '1', kind: 'codebase', path: 'D:/proj', label: 'codebase' },
      { id: '2', kind: 'file', path: 'src/App.tsx', label: 'src/App.tsx' },
      { id: '3', kind: 'folder', path: 'src/components/', label: 'src/components/' },
    ];
    const block = serializeContextAnnotations(annotations, 'D:/proj', '# Context Annotations\n\n');
    expect(block).toContain('# Context Annotations');
    expect(block).toContain('- codebase: `D:/proj`');
    expect(block).toContain('- file: `src/App.tsx`');
    expect(block).toContain('- folder: `src/components/`');
    expect(block).toContain('\n---\n\n');
    expect(block).not.toContain('export ');
  });

  it('dedupes by kind+path', () => {
    const list = dedupeContextAnnotations([
      { id: '1', kind: 'file', path: 'src/A.tsx', label: 'src/A.tsx' },
      { id: '2', kind: 'file', path: 'src\\A.tsx', label: 'src/A.tsx' },
    ]);
    expect(list).toHaveLength(1);
  });

  it('merges text mentions into chip annotations', () => {
    const merged = mergeAnnotationsFromText(
      [{ id: '1', kind: 'file', path: 'a.ts', label: 'a.ts' }],
      'please check @codebase',
      'D:/proj'
    );
    expect(merged.some((a) => a.kind === 'codebase')).toBe(true);
    expect(merged.some((a) => a.path === 'a.ts')).toBe(true);
  });

  it('splits stacked annotation and file-context prefixes', () => {
    const content =
      '# 上下文标注\n\n- codebase: `D:/p`\n\n---\n\n# 文件上下文\n\n- a.ts (`/a.ts`)\n\n---\n\nPlease fix';
    const { prefix, body } = splitPrefixedUserMessageContent(content, [
      '# 上下文标注\n\n',
      '# 文件上下文\n\n',
    ]);
    expect(prefix).toContain('# 上下文标注');
    expect(prefix).toContain('# 文件上下文');
    expect(body).toBe('Please fix');
    expect(extractAnnotationLabelsFromPrefix(prefix)).toEqual(['@codebase', 'a.ts']);
  });
});
