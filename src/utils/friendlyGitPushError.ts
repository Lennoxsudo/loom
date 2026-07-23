type GitPushErrorI18n = {
  pushFailedGeneric: string;
  pushFailedNoUpstream: string;
  pushFailedNetwork: string;
  pushFailedAuth: string;
  pushFailedNonFastForward: string;
  pushFailedRemoteRejected: string;
};

type FormattedGitPushError = {
  summary: string;
  detail: string;
};

export function formatGitPushFailureMessage(
  raw: string,
  g: GitPushErrorI18n
): FormattedGitPushError {
  const t = raw.trim();
  const s = t.toLowerCase();

  if (!t) {
    return {
      summary: g.pushFailedGeneric.replace('{detail}', raw),
      detail: raw,
    };
  }

  if (
    s.includes('has no upstream branch') ||
    s.includes('no upstream branch') ||
    s.includes('set the remote as upstream') ||
    s.includes('set-upstream')
  ) {
    return { summary: g.pushFailedNoUpstream, detail: t };
  }

  if (
    s.includes('authentication failed') ||
    s.includes('permission denied') ||
    s.includes('could not read username') ||
    s.includes('repository not found') ||
    s.includes('access denied') ||
    s.includes('403') ||
    s.includes('401')
  ) {
    return { summary: g.pushFailedAuth, detail: t };
  }

  if (
    s.includes('could not resolve host') ||
    s.includes('failed to connect') ||
    s.includes('connection timed out') ||
    s.includes('operation timed out') ||
    s.includes('connection reset') ||
    s.includes('network is unreachable') ||
    s.includes('unable to access') ||
    s.includes('ssl_connect') ||
    s.includes('tls') ||
    s.includes('timeout was reached')
  ) {
    return { summary: g.pushFailedNetwork, detail: t };
  }

  if (
    s.includes('non-fast-forward') ||
    s.includes('[rejected]') ||
    s.includes('fetch first') ||
    s.includes('failed to push some refs')
  ) {
    return { summary: g.pushFailedNonFastForward, detail: t };
  }

  if (s.includes('remote rejected') || s.includes('pre-receive hook declined')) {
    return { summary: g.pushFailedRemoteRejected, detail: t };
  }

  return {
    summary: g.pushFailedGeneric.replace('{detail}', t),
    detail: t,
  };
}
