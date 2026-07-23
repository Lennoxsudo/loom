type WindowRoute = { kind: 'main' } | { kind: 'agent'; projectPath: string };

type RouteLocation = Pick<Location, 'pathname' | 'search' | 'hash'>;
type WindowRouteOptions = {
  windowLabel?: string | null;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseHashParams(hash: string): URLSearchParams {
  const normalized = hash.replace(/^#\/?/, '').replace(/^\?/, '');
  return new URLSearchParams(normalized);
}

export function resolveWindowRoute(
  locationLike: RouteLocation,
  options?: WindowRouteOptions
): WindowRoute {
  if (options?.windowLabel === 'agent-window') {
    const searchParams = new URLSearchParams(locationLike.search);
    const hashParams = parseHashParams(locationLike.hash);
    return {
      kind: 'agent',
      projectPath: safeDecode(
        searchParams.get('projectPath') ?? hashParams.get('projectPath') ?? ''
      ),
    };
  }

  const searchParams = new URLSearchParams(locationLike.search);
  if (searchParams.get('window') === 'agent') {
    return {
      kind: 'agent',
      projectPath: safeDecode(searchParams.get('projectPath') ?? ''),
    };
  }

  const normalizedPath = locationLike.pathname.replace(/\\/g, '/');
  const agentPrefix = '/agent-window/';
  if (normalizedPath === '/agent-window' || normalizedPath === '/agent-window/') {
    return { kind: 'agent', projectPath: '' };
  }
  if (normalizedPath.startsWith(agentPrefix)) {
    return {
      kind: 'agent',
      projectPath: safeDecode(normalizedPath.slice(agentPrefix.length)),
    };
  }

  const hashParams = parseHashParams(locationLike.hash);
  if (hashParams.get('window') === 'agent') {
    return {
      kind: 'agent',
      projectPath: safeDecode(hashParams.get('projectPath') ?? ''),
    };
  }

  return { kind: 'main' };
}
