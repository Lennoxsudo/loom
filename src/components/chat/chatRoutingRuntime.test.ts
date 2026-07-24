import { describe, expect, it } from 'vitest';
import { reconcileChatRequestRuntime } from './chatRoutingRuntime';

describe('reconcileChatRequestRuntime', () => {
  it('keeps the selected built-in model without coercing against AI protocol profiles', () => {
    const config = {
      profiles: {
        openai: {
          activeId: 'user-1',
          items: [
            {
              id: 'user-1',
              name: 'Mine',
              models: ['gpt-4o', 'other-model'],
            },
          ],
        },
      },
    };

    const reconciled = reconcileChatRequestRuntime(config, 'builtin', 'deepseek-v4-pro');

    expect(reconciled).toEqual({
      provider: 'builtin',
      model: 'deepseek-v4-pro',
      profileId: 'builtin-gateway',
      routingMode: 'manual',
    });
  });
});
