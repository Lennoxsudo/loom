import { describe, expect, it, vi } from 'vitest';

describe('monaco-loader', () => {
  it('getMonacoInstance returns the monaco namespace synchronously', async () => {
    vi.doMock('monaco-editor', () => ({
      editor: { create: vi.fn() },
      languages: {},
      Uri: { parse: vi.fn() },
    }));

    const monacoLoaderModule = await import('./monaco-loader.ts');

    const instance = monacoLoaderModule.getMonacoInstance();
    expect(instance).toBeDefined();
    expect(instance.editor).toBeDefined();
  });
});
