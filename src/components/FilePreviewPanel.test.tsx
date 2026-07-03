import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import FilePreviewPanel from './FilePreviewPanel';

let latestDiffEditorProps: Record<string, unknown> | null = null;

vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: () => null,
  DiffEditor: (props: Record<string, unknown>) => {
    latestDiffEditorProps = props;
    return <div data-testid="mock-diff-editor" />;
  },
}));

afterEach(() => {
  cleanup();
  latestDiffEditorProps = null;
});

test('FilePreviewPanel 在 Diff 模式会保留 Monaco model 以避免提前 dispose', () => {
  render(
    <FilePreviewPanel
      isOpen={true}
      onClose={() => {}}
      mode="diff"
      filePath="example.ts"
      originalContent="const a = 1"
      modifiedContent="const a = 2"
    />
  );

  expect(latestDiffEditorProps).toBeTruthy();
  expect(latestDiffEditorProps?.keepCurrentOriginalModel).toBe(true);
  expect(latestDiffEditorProps?.keepCurrentModifiedModel).toBe(true);
  const options = latestDiffEditorProps?.options as
    | { minimap?: { enabled?: boolean; side?: string } }
    | undefined;
  expect(options?.minimap?.enabled).toBe(true);
  expect(options?.minimap?.side).toBe('right');
});
