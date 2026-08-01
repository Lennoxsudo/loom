import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/sessionSearch', () => ({
  searchAgentSessions: vi.fn(),
  formatSessionSearchOutput: vi.fn(
    (_result: unknown, query: string) => `formatted:${query}`
  ),
}));

vi.mock('../../../stores/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      enableAgentSessionSearch: true,
    }),
  },
}));

import { searchAgentSessions } from '../../../utils/sessionSearch';
import { getToolHandler } from '../registry';
import '../handlers/sessionSearchHandlers';

describe('sessionSearchHandlers', () => {
  beforeEach(() => {
    vi.mocked(searchAgentSessions).mockReset();
  });

  it('returns formatted hits', async () => {
    vi.mocked(searchAgentSessions).mockResolvedValue({
      ok: true,
      hits: [],
      scannedConversations: 0,
      offset: 0,
      hasMore: false,
    });
    const handler = getToolHandler('session_search');
    expect(handler).toBeTruthy();
    const result = await handler!.execute({ query: 'pnpm' }, undefined);
    expect(result.error).toBeUndefined();
    expect(result.output).toContain('formatted:pnpm');
  });

  it('returns error when search fails', async () => {
    vi.mocked(searchAgentSessions).mockResolvedValue({
      ok: false,
      hits: [],
      scannedConversations: 0,
      offset: 0,
      hasMore: false,
      error: 'query is required',
    });
    const handler = getToolHandler('session_search');
    const result = await handler!.execute({ query: 'x' }, undefined);
    expect(result.error).toMatch(/required/i);
  });
});
