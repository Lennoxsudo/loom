/** 将 git commit 的 stderr / 后端错误串转为更易读的提示（保留未知错误的原文） */

type GitCommitErrorI18n = {
  commitFailedGeneric: string;
  commitFailedNeedUser: string;
  commitFailedGpg: string;
  commitFailedHook: string;
  commitFailedMerge: string;
  commitFailedNothing: string;
};

export function formatGitCommitFailureMessage(raw: string, g: GitCommitErrorI18n): string {
  const t = raw.trim();
  if (!t) {
    return g.commitFailedGeneric.replace('{detail}', raw);
  }
  const s = t.toLowerCase();

  if (
    s.includes('please tell me who you are') ||
    (s.includes('user.name') && s.includes('user.email')) ||
    s.includes('author identity unknown')
  ) {
    return g.commitFailedNeedUser;
  }

  if (s.includes('nothing to commit')) {
    return g.commitFailedNothing;
  }

  if (s.includes('gpg failed') || s.includes('gpg signing') || s.includes('cannot sign')) {
    return `${g.commitFailedGpg}\n\n${t}`;
  }
  if (s.includes('.gpg') && s.includes('sign')) {
    return `${g.commitFailedGpg}\n\n${t}`;
  }

  if (
    s.includes('hook failed') ||
    s.includes('pre-commit hook') ||
    s.includes('commit-msg hook') ||
    s.includes('husky -') ||
    (s.includes('hook') && s.includes('exit code'))
  ) {
    return `${g.commitFailedHook}\n\n${t}`;
  }

  if (s.includes('unmerged paths') || (s.includes('conflict') && s.includes('merge'))) {
    return `${g.commitFailedMerge}\n\n${t}`;
  }

  return g.commitFailedGeneric.replace('{detail}', t);
}
