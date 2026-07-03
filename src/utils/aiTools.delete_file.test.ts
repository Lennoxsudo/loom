import { describe, expect, it } from 'vitest';
import { AI_TOOLS } from './aiTools/definitions';

describe('delete_file tool definition', () => {
  it('is exposed in AI_TOOLS for the model', () => {
    const tool = AI_TOOLS.find((t) => t.name === 'delete_file');
    expect(tool).toBeDefined();
    expect(tool?.parameters.required).toEqual(['path']);
    expect(tool?.parameters.properties).toMatchObject({
      path: { type: 'string' },
      permanent: { type: 'boolean' },
    });
  });
});
