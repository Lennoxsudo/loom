import { describe, expect, it } from 'vitest';

import { resolveWindowRoute } from './windowRoute';

describe('resolveWindowRoute', () => {
  it('resolves the legacy agent query route', () => {
    expect(
      resolveWindowRoute({
        pathname: '/',
        search: '?window=agent&projectPath=D%3A%5Cproject%5CLoom',
        hash: '',
      })
    ).toEqual({
      kind: 'agent',
      projectPath: 'D:\\project\\Loom',
    });
  });

  it('resolves the packaged agent path route', () => {
    expect(
      resolveWindowRoute({
        pathname: '/agent-window/D%3A%5Cproject%5CLoom',
        search: '',
        hash: '',
      })
    ).toEqual({
      kind: 'agent',
      projectPath: 'D:\\project\\Loom',
    });
  });

  it('keeps hash-based agent routing compatible', () => {
    expect(
      resolveWindowRoute({
        pathname: '/',
        search: '',
        hash: '#window=agent&projectPath=D%3A%5Cproject%5CLoom',
      })
    ).toEqual({
      kind: 'agent',
      projectPath: 'D:\\project\\Loom',
    });
  });

  it('falls back to the main window route', () => {
    expect(
      resolveWindowRoute({
        pathname: '/',
        search: '?projectPath=D%3A%5Cproject%5CLoom',
        hash: '',
      })
    ).toEqual({ kind: 'main' });
  });

  it('treats the agent window label as authoritative', () => {
    expect(
      resolveWindowRoute(
        {
          pathname: '/',
          search: '?projectPath=D%3A%5Cproject%5CLoom',
          hash: '',
        },
        { windowLabel: 'agent-window' }
      )
    ).toEqual({
      kind: 'agent',
      projectPath: 'D:\\project\\Loom',
    });
  });
});
