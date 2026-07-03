import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import type { ComponentPropsWithoutRef, MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNotification } from '../contexts/NotificationContext';
import { useTranslation } from '../i18n';
import { DEFAULT_GITIGNORE_TEMPLATE } from '../utils/defaultGitignoreTemplate';
import {
  appendGitignoreRule,
  gitignoreAlreadyHasRule,
  isUnsafeGitignoreRelativePath,
  normalizePathForGitignore,
} from '../utils/gitignorePathUtils';
import { formatGitCommitFailureMessage } from '../utils/friendlyGitCommitError';
import {
  buildWindowsReservedDeleteCommand,
  formatFriendlyGitError,
} from '../utils/friendlyGitError';
import { formatGitPushFailureMessage } from '../utils/friendlyGitPushError';
import {
  formatBlameEpochDate,
  isUnmergedBranchDeleteError,
  isValidBranchName,
} from '../utils/gitRefValidation';
import {
  compactGitPathHeadTail,
  gitPathPreferSeparators,
  truncatePathMiddle,
} from '../utils/gitPathDisplay';
import { getLanguage } from '../utils/editorUtils';
import { normalizePathForCompare } from '../utils/pathUtils';
import { GitPanelContextMenu, type GitPanelMenuEntry } from './GitPanelContextMenu';
import { GitBranchSelect } from './GitBranchSelect';
import styles from './GitPanel.module.css';

export type GitStatusEntry = {
  displayPath: string;
  filePath: string;
  indexStatus: string;
  worktreeStatus: string;
  conflict: boolean;
  untracked: boolean;
};

type GitWorkspaceStatus = {
  isRepo: boolean;
  branch: string;
  upstreamName: string | null;
  ahead: number;
  behind: number;
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  entries: GitStatusEntry[];
};

type GitWorkspaceSnapshot = {
  isRepo: boolean;
  status: GitWorkspaceStatus | null;
  branches: GitBranchInfo[];
  commits: GitLogEntry[];
  conflicted: string[];
};

type GitPreparedDiff = {
  originalContent: string;
  modifiedContent: string;
};

type GitSyncRemoteResult = {
  pulled: boolean;
  pushed: boolean;
  ahead: number;
  behind: number;
};

type GitBranchInfo = { name: string; isCurrent: boolean; isRemote: boolean };

type GitLogEntry = { hash: string; subject: string; author: string; date: string };

type BlameLine = {
  commitHash: string;
  author: string;
  date: string;
  lineNo: number;
  content: string;
};

type GitCommitMeta = {
  hash: string;
  subject: string;
  author: string;
  date: string;
  body: string | null;
};

type GitCommitFileSummary = {
  path: string;
  oldPath: string | null;
  status: string;
  additions: number;
  deletions: number;
};

type GitCommitDetail = {
  meta: GitCommitMeta;
  files: GitCommitFileSummary[];
  truncated: boolean;
  truncatedInfo: string | null;
};

type GitStashEntry = {
  index: number;
  message: string;
  branch: string;
  date: string;
};

type BlameState = {
  filePath: string;
  lines: BlameLine[];
  loading: boolean;
  error: string | null;
};

const COMMIT_LOG_PAGE_SIZE = 30;

type RecentCommitNotice = {
  subject: string;
  committedAt: number;
};

type PushErrorState = {
  summary: string;
  detail: string;
};

type GitPanelCacheEntry = {
  isGitRepo: boolean | null;
  status: GitWorkspaceStatus | null;
  branches: GitBranchInfo[];
  commits: GitLogEntry[];
  conflicted: string[];
  updatedAt: number;
};

type GitPanelDraftEntry = {
  commitSummary: string;
  commitDescription: string;
  stashMessage: string;
  recentCommitNotice: RecentCommitNotice | null;
};

const gitPanelCache = new Map<string, GitPanelCacheEntry>();
const gitPanelDraftCache = new Map<string, GitPanelDraftEntry>();
const GIT_PANEL_DRAFT_STORAGE_PREFIX = 'loom:git-panel-draft:';
const GIT_PANEL_CACHE_TTL_MS = 30_000;
const RECENT_COMMIT_NOTICE_TTL_MS = 20_000;

const EMPTY_GIT_PANEL_DRAFT: GitPanelDraftEntry = {
  commitSummary: '',
  commitDescription: '',
  stashMessage: '',
  recentCommitNotice: null,
};

function splitLegacyCommitMsg(commitMsg: string): { summary: string; description: string } {
  const trimmed = commitMsg.trim();
  if (!trimmed) return { summary: '', description: '' };
  const newlineIndex = trimmed.indexOf('\n');
  if (newlineIndex === -1) return { summary: trimmed, description: '' };
  return {
    summary: trimmed.slice(0, newlineIndex).trim(),
    description: trimmed.slice(newlineIndex + 1).trim(),
  };
}

function buildCommitMessage(summary: string, description: string): string {
  const subject = summary.trim();
  const body = description.trim();
  if (!subject) return '';
  if (!body) return subject;
  return `${subject}\n\n${body}`;
}

function gitPanelProjectKey(projectPath: string): string {
  const trimmed = projectPath.trim();
  if (!trimmed) return '';
  return normalizePathForCompare(trimmed).toLowerCase();
}

function readGitPanelDraftStorage(key: string): GitPanelDraftEntry | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(`${GIT_PANEL_DRAFT_STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GitPanelDraftEntry> & { commitMsg?: string };
    const legacySplit = splitLegacyCommitMsg(typeof parsed.commitMsg === 'string' ? parsed.commitMsg : '');
    return {
      commitSummary:
        typeof parsed.commitSummary === 'string' ? parsed.commitSummary : legacySplit.summary,
      commitDescription:
        typeof parsed.commitDescription === 'string'
          ? parsed.commitDescription
          : legacySplit.description,
      stashMessage: typeof parsed.stashMessage === 'string' ? parsed.stashMessage : '',
      recentCommitNotice:
        parsed.recentCommitNotice &&
        typeof parsed.recentCommitNotice.subject === 'string' &&
        typeof parsed.recentCommitNotice.committedAt === 'number'
          ? parsed.recentCommitNotice
          : null,
    };
  } catch {
    return null;
  }
}

function writeGitPanelDraftStorage(key: string, draft: GitPanelDraftEntry) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(`${GIT_PANEL_DRAFT_STORAGE_PREFIX}${key}`, JSON.stringify(draft));
  } catch {
    // ignore quota / privacy errors
  }
}

function getCachedGitPanelState(projectPath: string): GitPanelCacheEntry | null {
  const key = gitPanelProjectKey(projectPath);
  if (!key) return null;
  return gitPanelCache.get(key) ?? null;
}

function setCachedGitPanelState(projectPath: string, cache: GitPanelCacheEntry) {
  const key = gitPanelProjectKey(projectPath);
  if (!key) return;
  gitPanelCache.set(key, cache);
}

function getGitPanelDraft(projectPath: string): GitPanelDraftEntry {
  const key = gitPanelProjectKey(projectPath);
  if (!key) return EMPTY_GIT_PANEL_DRAFT;
  const cached = gitPanelDraftCache.get(key);
  if (cached) return cached;
  const stored = readGitPanelDraftStorage(key);
  if (stored) {
    gitPanelDraftCache.set(key, stored);
    return stored;
  }
  return EMPTY_GIT_PANEL_DRAFT;
}

function setGitPanelDraft(projectPath: string, draft: Partial<GitPanelDraftEntry>) {
  const key = gitPanelProjectKey(projectPath);
  if (!key) return;
  const current = getGitPanelDraft(projectPath);
  const next = { ...current, ...draft };
  gitPanelDraftCache.set(key, next);
  writeGitPanelDraftStorage(key, next);
}

function applyGitPanelDraft(
  projectPath: string,
  apply: (draft: GitPanelDraftEntry) => void
) {
  const draft = getGitPanelDraft(projectPath);
  apply(draft);
}

function isGitPanelCacheFresh(cache: GitPanelCacheEntry | null): boolean {
  if (!cache) return false;
  if (Date.now() - cache.updatedAt >= GIT_PANEL_CACHE_TTL_MS) return false;
  if (cache.isGitRepo === true && cache.commits.length === 0) return false;
  return true;
}

function joinRepoPath(root: string, rel: string): string {
  const norm = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  const base = root.replace(/[/\\]+$/, '');
  if (root.includes('\\')) {
    return `${base}\\${norm.replace(/\//g, '\\')}`;
  }
  return `${base}/${norm}`;
}

/** 与 VS Code SCM 资源装饰类似的字母含义（颜色区分类型） */
export type ScmBadgeVariant =
  | 'untracked'
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechanged'
  | 'conflict'
  | 'other';

type DisplayRow = {
  kind: 'staged' | 'unstaged' | 'untracked';
  filePath: string;
  displayPath: string;
  scmLetter: string;
  scmVariant: ScmBadgeVariant;
};

function rowKey(row: DisplayRow): string {
  return `${row.kind}:${row.filePath}`;
}

function scmFromIndexColumn(x: string): { letter: string; variant: ScmBadgeVariant } {
  const ch = x.trim();
  switch (ch) {
    case 'M':
      return { letter: 'M', variant: 'modified' };
    case 'A':
      return { letter: 'A', variant: 'added' };
    case 'D':
      return { letter: 'D', variant: 'deleted' };
    case 'R':
      return { letter: 'R', variant: 'renamed' };
    case 'C':
      return { letter: 'C', variant: 'copied' };
    case 'T':
      return { letter: 'T', variant: 'typechanged' };
    case 'U':
      return { letter: 'U', variant: 'conflict' };
    default:
      return { letter: ch || '?', variant: 'other' };
  }
}

function scmFromWorktreeColumn(y: string): { letter: string; variant: ScmBadgeVariant } {
  const ch = y.trim();
  switch (ch) {
    case 'M':
      return { letter: 'M', variant: 'modified' };
    case 'D':
      return { letter: 'D', variant: 'deleted' };
    case 'A':
      return { letter: 'A', variant: 'added' };
    default:
      return { letter: ch || '?', variant: 'other' };
  }
}

type GitScmHintSlice = {
  scmHintUntracked: string;
  scmHintAdded: string;
  scmHintModified: string;
  scmHintDeleted: string;
  scmHintRenamed: string;
  scmHintCopied: string;
  scmHintTypeChanged: string;
  scmHintConflict: string;
  scmHintOther: string;
};

function scmBadgeHint(variant: ScmBadgeVariant, g: GitScmHintSlice): string {
  switch (variant) {
    case 'untracked':
      return g.scmHintUntracked;
    case 'added':
      return g.scmHintAdded;
    case 'modified':
      return g.scmHintModified;
    case 'deleted':
      return g.scmHintDeleted;
    case 'renamed':
      return g.scmHintRenamed;
    case 'copied':
      return g.scmHintCopied;
    case 'typechanged':
      return g.scmHintTypeChanged;
    case 'conflict':
      return g.scmHintConflict;
    default:
      return g.scmHintOther;
  }
}

function commitFileStatusVariant(status: string): ScmBadgeVariant {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'added' || normalized === 'new') return 'added';
  if (normalized === 'deleted' || normalized === 'removed') return 'deleted';
  if (normalized === 'renamed') return 'renamed';
  if (normalized === 'copied') return 'copied';
  if (normalized === 'typechanged' || normalized === 'type_changed') return 'typechanged';
  if (normalized === 'modified') return 'modified';
  return 'modified';
}

function scmStripeClass(variant: ScmBadgeVariant): string {
  switch (variant) {
    case 'untracked':
      return styles.stripeUntracked;
    case 'added':
      return styles.stripeAdded;
    case 'modified':
      return styles.stripeModified;
    case 'deleted':
      return styles.stripeDeleted;
    case 'renamed':
      return styles.stripeRenamed;
    case 'copied':
      return styles.stripeCopied;
    case 'typechanged':
      return styles.stripeTypeChanged;
    case 'conflict':
      return styles.stripeConflict;
    default:
      return styles.stripeOther;
  }
}

function GitResourceStripe({ variant, title }: { variant: ScmBadgeVariant; title: string }) {
  return (
    <div className={`${styles.resourceStripe} ${scmStripeClass(variant)}`} title={title} aria-hidden />
  );
}

type GitScmPathLabelProps = { fullPath: string } & ComponentPropsWithoutRef<'span'>;

/** 按可用宽度优先完整路径，溢出再用完整首尾段，极窄时中段省略 */
function GitScmPathLabel({ fullPath, className, ...rest }: GitScmPathLabelProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const compact = useMemo(() => compactGitPathHeadTail(fullPath), [fullPath]);
  const [label, setLabel] = useState(fullPath);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      setLabel(fullPath);
      return;
    }

    const measureAndSet = () => {
      if (!fullPath) {
        setLabel('');
        return;
      }
      const w = node.getBoundingClientRect().width;
      if (w < 2) {
        setLabel(fullPath);
        return;
      }

      /* scrollWidth 与布局宽度常有亚像素差，过严会误判溢出 */
      const fits = (s: string) => {
        node.textContent = s;
        return node.scrollWidth <= w + 1.5;
      };

      if (fits(fullPath)) {
        setLabel(fullPath);
        return;
      }
      let best = fits(compact) ? compact : truncatePathMiddle(fullPath, 12);
      let lo = Math.max(1, best.length + 1);
      let hi = fullPath.length;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const t = truncatePathMiddle(fullPath, mid);
        node.textContent = t;
        if (node.scrollWidth <= w + 1.5) {
          best = t;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      setLabel(best);
    };

    measureAndSet();
    const ro = new ResizeObserver(() => {
      measureAndSet();
    });
    ro.observe(node);
    let cancelled = false;
    void document.fonts?.ready?.then(() => {
      if (!cancelled) {
        measureAndSet();
      }
    });
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [fullPath, compact]);

  return (
    <span ref={ref} className={className} {...rest}>
      {label}
    </span>
  );
}

/** 已删除项磁盘上一般无文件，不展示「打开」（与常见 IDE 行为一致） */
function shouldHideOpenFileForRow(row: DisplayRow): boolean {
  return row.scmVariant === 'deleted';
}

function toDisplayRows(entries: GitStatusEntry[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  for (const e of entries) {
    if (e.conflict) {
      continue;
    }
    if (e.untracked) {
      rows.push({
        kind: 'untracked',
        filePath: e.filePath,
        displayPath: e.displayPath,
        scmLetter: 'U',
        scmVariant: 'untracked',
      });
      continue;
    }
    if (e.indexStatus !== ' ' && e.indexStatus !== '?') {
      const { letter, variant } = scmFromIndexColumn(e.indexStatus);
      rows.push({
        kind: 'staged',
        filePath: e.filePath,
        displayPath: e.displayPath,
        scmLetter: letter,
        scmVariant: variant,
      });
    }
    if (e.worktreeStatus !== ' ' && e.worktreeStatus !== '?') {
      const { letter, variant } = scmFromWorktreeColumn(e.worktreeStatus);
      rows.push({
        kind: 'unstaged',
        filePath: e.filePath,
        displayPath: e.displayPath,
        scmLetter: letter,
        scmVariant: variant,
      });
    }
  }
  return rows;
}

type GitPanelFileCtxPayload =
  | { section: 'staged'; row: DisplayRow }
  | { section: 'unstaged'; row: DisplayRow }
  | { section: 'untracked'; row: DisplayRow }
  | { section: 'conflict'; filePath: string };

type FileContextMenuState = { x: number; y: number } & GitPanelFileCtxPayload;

type ChangesTab = 'staged' | 'unstaged' | 'untracked';

function pathBaseName(displayPath: string): string {
  const norm = displayPath.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function scmIconColorClass(variant: ScmBadgeVariant): string {
  switch (variant) {
    case 'untracked':
      return styles.iconTextUntracked;
    case 'added':
      return styles.iconTextAdded;
    case 'modified':
      return styles.iconTextModified;
    case 'deleted':
      return styles.iconTextDeleted;
    case 'renamed':
      return styles.iconTextRenamed;
    case 'copied':
      return styles.iconTextCopied;
    case 'typechanged':
      return styles.iconTextTypeChanged;
    case 'conflict':
      return styles.iconTextConflict;
    default:
      return styles.iconTextOther;
  }
}

function formatTimelineCommitWhen(
  dateStr: string,
  labels: { justNow: string; minutesAgo: string; hoursAgo: string }
): string {
  const parsed = Date.parse(dateStr);
  if (Number.isNaN(parsed)) return dateStr;
  const elapsedMs = Date.now() - parsed;
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return labels.justNow;
  if (minutes < 60) return labels.minutesAgo.replace('{minutes}', String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return labels.hoursAgo.replace('{hours}', String(hours));
  return dateStr;
}

function tabLabelWithCount(label: string, count: number): string {
  return count > 0 ? `${label} · ${count}` : label;
}

export interface GitPanelProps {
  projectPath: string;
  isActive?: boolean;
  onCollapse: () => void;
  onOpenFile: (absolutePath: string) => void;
  /** 打开文件并跳转到指定行（复用全局搜索/Monaco 定位逻辑） */
  onOpenFileAtLine?: (absolutePath: string, line: number) => void;
  onWorkspaceChanged?: () => void;
  /** 在主编辑区打开并排差异标签页（已暂存/未暂存文件路径点击时调用） */
  onOpenDiffInEditor?: (payload: {
    name: string;
    originalContent: string;
    modifiedContent: string;
    language: string;
    leftLabel: string;
    rightLabel: string;
  }) => void;
}

export default function GitPanel({
  projectPath,
  isActive = true,
  onCollapse,
  onOpenFile,
  onOpenFileAtLine,
  onWorkspaceChanged,
  onOpenDiffInEditor,
}: GitPanelProps) {
  const t = useTranslation();
  const { showError, showSuccess, showWarning } = useNotification();
  const cachedState = getCachedGitPanelState(projectPath);
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(cachedState?.isGitRepo ?? null);
  const [status, setStatus] = useState<GitWorkspaceStatus | null>(cachedState?.status ?? null);
  const [branches, setBranches] = useState<GitBranchInfo[]>(cachedState?.branches ?? []);
  const [commits, setCommits] = useState<GitLogEntry[]>(cachedState?.commits ?? []);
  const [conflicted, setConflicted] = useState<string[]>(cachedState?.conflicted ?? []);
  const [loading, setLoading] = useState(false);
  const [commitSummary, setCommitSummary] = useState(
    () => getGitPanelDraft(projectPath).commitSummary
  );
  const [commitDescription, setCommitDescription] = useState(
    () => getGitPanelDraft(projectPath).commitDescription
  );
  const [recentCommitNotice, setRecentCommitNotice] = useState<RecentCommitNotice | null>(
    () => getGitPanelDraft(projectPath).recentCommitNotice
  );
  const [recentCommitNow, setRecentCommitNow] = useState(() => Date.now());
  const [pushError, setPushError] = useState<PushErrorState | null>(null);
  const [branchBusy, setBranchBusy] = useState(false);
  const [openingRowKey, setOpeningRowKey] = useState<string | null>(null);
  const [gitignoreBusy, setGitignoreBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [pushStartedAt, setPushStartedAt] = useState<number | null>(null);
  const [pushElapsedSec, setPushElapsedSec] = useState(0);
  const [undoBusy, setUndoBusy] = useState(false);
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenuState | null>(null);
  const [commitLogLimit, setCommitLogLimit] = useState(COMMIT_LOG_PAGE_SIZE);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<GitCommitDetail | null>(null);
  const [commitDetailLoading, setCommitDetailLoading] = useState(false);
  const commitDetailCacheRef = useRef<Map<string, GitCommitDetail>>(new Map());
  const [blameState, setBlameState] = useState<BlameState | null>(null);
  const [stashList, setStashList] = useState<GitStashEntry[]>([]);
  const [stashLoading, setStashLoading] = useState(false);
  const [stashMessage, setStashMessage] = useState(() => getGitPanelDraft(projectPath).stashMessage);
  const [branchFormMode, setBranchFormMode] = useState<'create' | 'rename' | 'delete' | null>(null);
  const [branchFormValue, setBranchFormValue] = useState('');
  const [branchFormTarget, setBranchFormTarget] = useState('');
  const [commitsLoadingMore, setCommitsLoadingMore] = useState(false);
  const [hasMoreCommits, setHasMoreCommits] = useState(true);
  const [changesTab, setChangesTab] = useState<ChangesTab>('unstaged');
  const [showAllCommits, setShowAllCommits] = useState(true);
  const openingDiffLockRef = useRef(false);
  const blamePanelRef = useRef<HTMLDivElement>(null);
  const commitsSectionRef = useRef<HTMLDivElement>(null);
  const changesSectionRef = useRef<HTMLDivElement>(null);
  const warnedReservedRef = useRef<Set<string>>(new Set());
  const projectPathRef = useRef(projectPath);
  const wasActiveRef = useRef(isActive);
  projectPathRef.current = projectPath;
  const refreshGenerationRef = useRef(0);

  const restoreGitPanelDraft = useCallback((repoPath: string) => {
    applyGitPanelDraft(repoPath, (draft) => {
      setCommitSummary(draft.commitSummary);
      setCommitDescription(draft.commitDescription);
      setStashMessage(draft.stashMessage);
      setRecentCommitNotice(draft.recentCommitNotice);
    });
  }, []);

  useEffect(() => {
    setGitPanelDraft(projectPathRef.current, {
      commitSummary,
      commitDescription,
      stashMessage,
      recentCommitNotice,
    });
  }, [commitDescription, commitSummary, stashMessage, recentCommitNotice]);

  useEffect(() => {
    restoreGitPanelDraft(projectPath);
  }, [projectPath, restoreGitPanelDraft]);

  useEffect(() => {
    if (isActive && !wasActiveRef.current && projectPath) {
      restoreGitPanelDraft(projectPath);
    }
    wasActiveRef.current = isActive;
  }, [isActive, projectPath, restoreGitPanelDraft]);

  const notifyGitError = useCallback(
    (error: unknown) => {
      showError(formatFriendlyGitError(String(error), t.git));
    },
    [showError, t.git]
  );

  const warnWindowsReservedRepoFiles = useCallback(
    async (repoPath: string) => {
      if (!repoPath || warnedReservedRef.current.has(repoPath)) return;
      try {
        const names = await invoke<string[]>('find_windows_reserved_repo_files', { path: repoPath });
        if (names.length === 0) return;
        warnedReservedRef.current.add(repoPath);
        const command = names
          .map((name) => buildWindowsReservedDeleteCommand(repoPath, name))
          .join(' && ');
        const message = [
          t.git.windowsReservedNamesMessage.replace('{names}', names.join(', ')),
          t.git.windowsReservedNamesDeleteHint.replace('{command}', command),
        ].join('\n\n');
        showWarning(message, t.git.windowsReservedNamesTitle);
      } catch {
        // ignore scan failures
      }
    },
    [showWarning, t.git]
  );

  const applyCache = useCallback(
    (cache: GitPanelCacheEntry | null) => {
      setIsGitRepo(cache?.isGitRepo ?? null);
      setStatus(cache?.status ?? null);
      setBranches(cache?.branches ?? []);
      setCommits(cache?.commits ?? []);
      setConflicted(cache?.conflicted ?? []);
    },
    []
  );

  useEffect(() => {
    if (!pushBusy || pushStartedAt === null) {
      setPushElapsedSec(0);
      return;
    }
    setPushElapsedSec(Math.max(0, Math.floor((Date.now() - pushStartedAt) / 1000)));
    const timer = window.setInterval(() => {
      setPushElapsedSec(Math.max(0, Math.floor((Date.now() - pushStartedAt) / 1000)));
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [pushBusy, pushStartedAt]);

  useEffect(() => {
    if (!recentCommitNotice) return;
    setRecentCommitNow(Date.now());
    const timer = window.setInterval(() => {
      setRecentCommitNow(Date.now());
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [recentCommitNotice]);

  useEffect(() => {
    if (!recentCommitNotice) return;
    const timer = window.setTimeout(() => {
      setRecentCommitNotice((current) =>
        current?.committedAt === recentCommitNotice.committedAt ? null : current
      );
    }, RECENT_COMMIT_NOTICE_TTL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [recentCommitNotice]);

  const refresh = useCallback(async (options?: { force?: boolean }) => {
    if (!projectPath) return;
    const cache = getCachedGitPanelState(projectPath);
    if (!options?.force && isGitPanelCacheFresh(cache)) {
      applyCache(cache);
      return;
    }

    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    setLoading(true);
    try {
      const snapshot = await invoke<GitWorkspaceSnapshot>('git_workspace_snapshot', {
        repoPath: projectPath,
        limit: commitLogLimit,
      });
      if (refreshGenerationRef.current !== generation) return;
      setIsGitRepo(snapshot.isRepo);
      setStatus(snapshot.status);
      setBranches(snapshot.branches);
      setCommits(snapshot.commits);
      setConflicted(snapshot.conflicted);
      setHasMoreCommits(snapshot.commits.length >= commitLogLimit);
      setCachedGitPanelState(projectPath, {
        isGitRepo: snapshot.isRepo,
        status: snapshot.status,
        branches: snapshot.branches,
        commits: snapshot.commits,
        conflicted: snapshot.conflicted,
        updatedAt: Date.now(),
      });
      if (snapshot.isRepo) {
        void warnWindowsReservedRepoFiles(projectPath);
      }
    } catch (e) {
      if (refreshGenerationRef.current !== generation) return;
      notifyGitError(e);
    } finally {
      if (refreshGenerationRef.current === generation) {
        setLoading(false);
      }
    }
  }, [applyCache, commitLogLimit, notifyGitError, projectPath, warnWindowsReservedRepoFiles]);

  const refreshStashList = useCallback(async () => {
    if (!projectPath) return;
    setStashLoading(true);
    try {
      const list = await invoke<GitStashEntry[]>('git_workspace_stash_list', { repoPath: projectPath });
      setStashList(list);
    } catch (e) {
      showError(String(e));
    } finally {
      setStashLoading(false);
    }
  }, [projectPath, showError]);

  useEffect(() => {
    if (!isActive || !projectPath || isGitRepo !== true) return;
    void refreshStashList();
  }, [isActive, isGitRepo, projectPath, refreshStashList]);

  useEffect(() => {
    const cache = getCachedGitPanelState(projectPath);
    if (isGitPanelCacheFresh(cache)) {
      applyCache(cache);
    } else if (projectPath) {
      setIsGitRepo(null);
      setStatus(null);
      setBranches([]);
      setCommits([]);
      setConflicted([]);
    } else {
      applyCache(null);
    }
    setCommitLogLimit(COMMIT_LOG_PAGE_SIZE);
    setSelectedCommitHash(null);
    setCommitDetail(null);
    commitDetailCacheRef.current = new Map();
    setBlameState(null);
    setStashList([]);
    setBranchFormMode(null);
    setBranchFormValue('');
    setBranchFormTarget('');
    setHasMoreCommits(true);
    setShowAllCommits(true);
  }, [applyCache, projectPath]);

  useEffect(() => {
    if (!isActive || !projectPath || isGitRepo !== true) return;
    void warnWindowsReservedRepoFiles(projectPath);
  }, [isActive, isGitRepo, projectPath, warnWindowsReservedRepoFiles]);

  useEffect(() => {
    if (!projectPath) return;

    const cache = getCachedGitPanelState(projectPath);
    if (isActive && isGitPanelCacheFresh(cache)) {
      applyCache(cache);
    }

    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [applyCache, isActive, projectPath, refresh]);

  const stagedRows = useMemo(() => {
    if (!status) return [];
    return toDisplayRows(status.entries).filter((r) => r.kind === 'staged');
  }, [status]);

  const unstagedRows = useMemo(() => {
    if (!status) return [];
    return toDisplayRows(status.entries).filter((r) => r.kind === 'unstaged');
  }, [status]);

  const untrackedRows = useMemo(() => {
    if (!status) return [];
    return toDisplayRows(status.entries).filter((r) => r.kind === 'untracked');
  }, [status]);

  const activeChangeRows = useMemo(() => {
    if (changesTab === 'staged') return stagedRows;
    if (changesTab === 'untracked') return untrackedRows;
    return unstagedRows;
  }, [changesTab, stagedRows, unstagedRows, untrackedRows]);

  const timelineCommits = useMemo(
    () => (showAllCommits ? commits : commits.slice(0, 5)),
    [commits, showAllCommits]
  );

  const conflictEntries = useMemo(() => {
    if (!status) return [];
    const fromStatus = status.entries.filter((e) => e.conflict);
    const paths = new Set(fromStatus.map((e) => e.filePath));
    for (const p of conflicted) {
      paths.add(p);
    }
    return [...paths].map((filePath) => ({
      filePath,
      displayPath: fromStatus.find((e) => e.filePath === filePath)?.displayPath ?? filePath,
    }));
  }, [status, conflicted]);

  const hasStaged = stagedRows.length > 0;

  const afterMutation = useCallback(async () => {
    await refresh({ force: true });
    onWorkspaceChanged?.();
    await refreshStashList();
  }, [refresh, onWorkspaceChanged, refreshStashList]);

  const gitOpsDisabled = Boolean(status?.mergeInProgress || status?.rebaseInProgress);

  const handleLoadMoreCommits = useCallback(async () => {
    if (!projectPath) return;
    const newLimit = commitLogLimit + COMMIT_LOG_PAGE_SIZE;
    setCommitsLoadingMore(true);
    try {
      const result = await invoke<{ commits: GitLogEntry[] }>('git_workspace_log', {
        repoPath: projectPath,
        limit: newLimit,
      });
      setCommits(result.commits);
      setCommitLogLimit(newLimit);
      setHasMoreCommits(result.commits.length >= newLimit);
      const cache = getCachedGitPanelState(projectPath);
      if (cache) {
        setCachedGitPanelState(projectPath, { ...cache, commits: result.commits, updatedAt: Date.now() });
      }
    } catch (e) {
      showError(String(e));
    } finally {
      setCommitsLoadingMore(false);
    }
  }, [commitLogLimit, projectPath, showError]);

  const handleToggleCommitDetail = useCallback(
    async (hash: string) => {
      if (selectedCommitHash === hash) {
        setSelectedCommitHash(null);
        setCommitDetail(null);
        return;
      }
      setSelectedCommitHash(hash);
      const cached = commitDetailCacheRef.current.get(hash);
      if (cached) {
        setCommitDetail(cached);
        return;
      }
      if (!projectPath) return;
      setCommitDetailLoading(true);
      setCommitDetail(null);
      try {
        const detail = await invoke<GitCommitDetail>('git_workspace_commit_detail', {
          repoPath: projectPath,
          hash,
        });
        commitDetailCacheRef.current.set(hash, detail);
        setCommitDetail(detail);
      } catch (e) {
        showError(String(e));
        setSelectedCommitHash(null);
      } finally {
        setCommitDetailLoading(false);
      }
    },
    [projectPath, selectedCommitHash, showError]
  );

  const handleOpenCommitFileDiff = useCallback(
    async (commitHash: string, filePath: string) => {
      if (!projectPath || !onOpenDiffInEditor || openingDiffLockRef.current) return;
      openingDiffLockRef.current = true;
      try {
        const prepared = await invoke<GitPreparedDiff>('git_workspace_prepare_diff', {
          options: {
            repoPath: projectPath,
            filePath,
            kind: 'commit',
            commitHash,
          },
        });
        const base = filePath.split(/[/\\]/).pop() || filePath;
        onOpenDiffInEditor({
          name: `${base} · ${t.git.diffEditorTabSuffix}`,
          originalContent: prepared.originalContent,
          modifiedContent: prepared.modifiedContent,
          language: getLanguage(base),
          leftLabel: t.git.diffLabelParent,
          rightLabel: t.git.diffLabelCommit,
        });
      } catch (e) {
        showError(String(e));
      } finally {
        openingDiffLockRef.current = false;
      }
    },
    [onOpenDiffInEditor, projectPath, showError, t.git.diffEditorTabSuffix, t.git.diffLabelCommit, t.git.diffLabelParent]
  );

  const handleViewBlame = useCallback(
    async (filePath: string) => {
      if (!projectPath) return;
      setFileContextMenu(null);
      setBlameState({ filePath, lines: [], loading: true, error: null });
      try {
        const lines = await invoke<BlameLine[]>('git_workspace_blame', {
          repoPath: projectPath,
          filePath,
        });
        setBlameState({ filePath, lines, loading: false, error: null });
      } catch (e) {
        const message = String(e);
        showError(message);
        setBlameState({ filePath, lines: [], loading: false, error: message });
      }
    },
    [projectPath, showError]
  );

  useEffect(() => {
    if (!blameState || blameState.loading) return;
    blamePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [blameState]);

  const handleBlameLineClick = useCallback(
    (lineNo: number) => {
      if (!blameState || !projectPath) return;
      const abs = joinRepoPath(projectPath, blameState.filePath);
      if (onOpenFileAtLine) {
        onOpenFileAtLine(abs, lineNo);
        return;
      }
      onOpenFile(abs);
    },
    [blameState, onOpenFile, onOpenFileAtLine, projectPath]
  );

  const handleBlameCommitClick = useCallback(
    async (commitHash: string) => {
      if (!blameState) return;
      void handleOpenCommitFileDiff(commitHash, blameState.filePath);
      if (selectedCommitHash !== commitHash) {
        await handleToggleCommitDetail(commitHash);
      }
      commitsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    [blameState, handleOpenCommitFileDiff, handleToggleCommitDetail, selectedCommitHash]
  );

  const handleCreateBranch = useCallback(async () => {
    const name = branchFormValue.trim();
    if (!isValidBranchName(name)) {
      showWarning(t.git.invalidBranchName);
      return;
    }
    if (!projectPath) return;
    setBranchBusy(true);
    try {
      await invoke('git_workspace_create_branch', {
        options: { repoPath: projectPath, name },
      });
      showSuccess(t.git.createBranchSucceeded);
      setBranchFormMode(null);
      setBranchFormValue('');
      await afterMutation();
    } catch (e) {
      showError(String(e));
    } finally {
      setBranchBusy(false);
    }
  }, [afterMutation, branchFormValue, projectPath, showError, showSuccess, showWarning, t.git]);

  const handleRenameBranch = useCallback(async () => {
    const name = branchFormValue.trim();
    if (!isValidBranchName(name)) {
      showWarning(t.git.invalidBranchName);
      return;
    }
    if (!projectPath) return;
    setBranchBusy(true);
    try {
      await invoke('git_workspace_rename_branch', {
        options: { repoPath: projectPath, newName: name },
      });
      showSuccess(t.git.renameBranchSucceeded);
      setBranchFormMode(null);
      setBranchFormValue('');
      await afterMutation();
    } catch (e) {
      showError(String(e));
    } finally {
      setBranchBusy(false);
    }
  }, [afterMutation, branchFormValue, projectPath, showError, showSuccess, showWarning, t.git]);

  const handleDeleteBranch = useCallback(async () => {
    const name = branchFormTarget.trim();
    if (!name || !projectPath) return;
    if (name === status?.branch) {
      showWarning(t.git.invalidBranchName);
      return;
    }
    const ok = await confirm(t.git.confirmDeleteBranch);
    if (!ok) return;
    setBranchBusy(true);
    try {
      const invokeDelete = (force: boolean) =>
        invoke('git_workspace_delete_branch', {
          options: { repoPath: projectPath, name, force },
        });
      try {
        await invokeDelete(false);
      } catch (e) {
        const msg = String(e);
        if (!isUnmergedBranchDeleteError(msg)) {
          throw e;
        }
        const forceOk = await confirm(t.git.confirmForceDeleteBranch);
        if (!forceOk) return;
        await invokeDelete(true);
      }
      showSuccess(t.git.deleteBranchSucceeded);
      setBranchFormMode(null);
      setBranchFormTarget('');
      await afterMutation();
    } catch (e) {
      showError(String(e));
    } finally {
      setBranchBusy(false);
    }
  }, [afterMutation, branchFormTarget, projectPath, showError, showSuccess, showWarning, status?.branch, t.git]);

  const handleStashSave = useCallback(async () => {
    if (!projectPath || gitOpsDisabled) return;
    try {
      const msg = stashMessage.trim();
      await invoke('git_workspace_stash_save', {
        options: { repoPath: projectPath, message: msg || undefined },
      });
      showSuccess(t.git.stashSaved);
      setStashMessage('');
      await afterMutation();
    } catch (e) {
      showError(String(e));
    }
  }, [afterMutation, gitOpsDisabled, projectPath, showError, showSuccess, stashMessage, t.git]);

  const handleStashApply = useCallback(
    async (index: number) => {
      if (!projectPath || gitOpsDisabled) return;
      try {
        await invoke('git_workspace_stash_apply', { options: { repoPath: projectPath, index } });
        await afterMutation();
      } catch (e) {
        showError(String(e));
      }
    },
    [afterMutation, gitOpsDisabled, projectPath, showError]
  );

  const handleStashPop = useCallback(
    async (index: number) => {
      if (!projectPath || gitOpsDisabled) return;
      const ok = await confirm(t.git.confirmStashPop);
      if (!ok) return;
      try {
        await invoke('git_workspace_stash_pop', { options: { repoPath: projectPath, index } });
        await afterMutation();
      } catch (e) {
        showError(String(e));
      }
    },
    [afterMutation, gitOpsDisabled, projectPath, showError, t.git]
  );

  const handleStashDrop = useCallback(
    async (index: number) => {
      if (!projectPath || gitOpsDisabled) return;
      const ok = await confirm(t.git.confirmStashDrop);
      if (!ok) return;
      try {
        await invoke('git_workspace_stash_drop', { options: { repoPath: projectPath, index } });
        await afterMutation();
      } catch (e) {
        showError(String(e));
      }
    },
    [afterMutation, gitOpsDisabled, projectPath, showError, t.git]
  );

  const gitignoreActionLockRef = useRef(false);

  const handleOpenOrCreateGitignore = useCallback(async () => {
    if (!projectPath || gitignoreActionLockRef.current) return;
    gitignoreActionLockRef.current = true;
    setGitignoreBusy(true);
    const abs = joinRepoPath(projectPath, '.gitignore');
    try {
      const info = await invoke<{ exists: boolean; file_type: string }>('get_file_info', { path: abs });
      if (info.exists && info.file_type === 'directory') {
        showWarning(t.git.gitignoreBlockedByDir);
        return;
      }
      if (!info.exists) {
        await invoke('write_file_content', {
          filePath: abs,
          content: DEFAULT_GITIGNORE_TEMPLATE,
        });
        showSuccess(t.git.gitignoreCreated);
        await afterMutation();
      }
      onOpenFile(abs);
    } catch (e) {
      showError(String(e));
    } finally {
      gitignoreActionLockRef.current = false;
      setGitignoreBusy(false);
    }
  }, [projectPath, afterMutation, onOpenFile, showError, showSuccess, showWarning, t.git]);

  const openGitFileContextMenu = useCallback((e: ReactMouseEvent, ctx: GitPanelFileCtxPayload) => {
    e.preventDefault();
    e.stopPropagation();
    setFileContextMenu({ x: e.clientX, y: e.clientY, ...ctx });
  }, []);

  const appendRelPathToGitignore = useCallback(
    async (relPathRaw: string) => {
      if (!projectPath || gitignoreActionLockRef.current) return;
      const rule = normalizePathForGitignore(relPathRaw);
      if (!rule || isUnsafeGitignoreRelativePath(relPathRaw)) {
        showWarning(t.git.addToGitignoreUnsafe);
        return;
      }
      const gitignoreAbs = joinRepoPath(projectPath, '.gitignore');
      gitignoreActionLockRef.current = true;
      setGitignoreBusy(true);
      try {
        const info = await invoke<{ exists: boolean; file_type: string }>('get_file_info', { path: gitignoreAbs });
        if (info.exists && info.file_type === 'directory') {
          showWarning(t.git.gitignoreBlockedByDir);
          return;
        }
        let content = '';
        if (info.exists) {
          content = await invoke<string>('read_file_content', { filePath: gitignoreAbs }).catch(() => '');
        }
        if (gitignoreAlreadyHasRule(content, rule)) {
          showWarning(t.git.addToGitignoreAlready);
          return;
        }
        const next = appendGitignoreRule(content, rule);
        await invoke('write_file_content', { filePath: gitignoreAbs, content: next });
        showSuccess(t.git.addToGitignoreDone.replace('{path}', rule));
        await afterMutation();
      } catch (e) {
        showError(String(e));
      } finally {
        gitignoreActionLockRef.current = false;
        setGitignoreBusy(false);
      }
    },
    [projectPath, afterMutation, showError, showSuccess, showWarning, t.git]
  );

  const openRepoFileIfPresent = useCallback(
    async (absolutePath: string) => {
      try {
        const info = await invoke<{ exists: boolean; file_type: string }>('get_file_info', {
          path: absolutePath,
        });
        if (!info.exists || info.file_type === 'directory') {
          showWarning(t.git.openFileMissing);
          return;
        }
        onOpenFile(absolutePath);
      } catch (e) {
        showError(String(e));
      }
    },
    [onOpenFile, showError, showWarning, t.git]
  );

  const openDiffOrFileForRow = useCallback(
    async (row: DisplayRow) => {
      if (!projectPath) return;

      if (row.kind === 'untracked') {
        await openRepoFileIfPresent(joinRepoPath(projectPath, row.filePath));
        return;
      }

      if (!onOpenDiffInEditor) {
        await openRepoFileIfPresent(joinRepoPath(projectPath, row.filePath));
        return;
      }

      if (openingDiffLockRef.current) return;
      openingDiffLockRef.current = true;
      const k = rowKey(row);
      setOpeningRowKey(k);
      try {
        const rel = row.filePath;
        let leftLabel = '';
        let rightLabel = '';

        if (row.kind === 'staged') {
          leftLabel = t.git.diffLabelHead;
          rightLabel = t.git.diffLabelStaged;
        } else {
          leftLabel = t.git.diffLabelIndex;
          rightLabel = t.git.diffLabelWorking;
        }

        const prepared = await invoke<GitPreparedDiff>('git_workspace_prepare_diff', {
          options: { repoPath: projectPath, filePath: rel, kind: row.kind },
        });

        const base = rel.split(/[/\\]/).pop() || rel;
        onOpenDiffInEditor({
          name: `${base} · ${t.git.diffEditorTabSuffix}`,
          originalContent: prepared.originalContent,
          modifiedContent: prepared.modifiedContent,
          language: getLanguage(base),
          leftLabel,
          rightLabel,
        });
      } catch (e) {
        showError(String(e));
      } finally {
        openingDiffLockRef.current = false;
        setOpeningRowKey((cur) => (cur === k ? null : cur));
      }
    },
    [
      projectPath,
      onOpenDiffInEditor,
      openRepoFileIfPresent,
      t.git.diffEditorTabSuffix,
      t.git.diffLabelHead,
      t.git.diffLabelIndex,
      t.git.diffLabelStaged,
      t.git.diffLabelWorking,
      showError,
    ]
  );

  const handleStage = async (path: string) => {
    try {
      await invoke('git_workspace_stage', { options: { repoPath: projectPath, paths: [path] } });
      await afterMutation();
    } catch (e) {
      showError(String(e));
    }
  };

  const handleUnstage = async (path: string) => {
    try {
      await invoke('git_workspace_unstage', { options: { repoPath: projectPath, paths: [path] } });
      await afterMutation();
    } catch (e) {
      showError(String(e));
    }
  };

  const handleStageAll = async () => {
    try {
      await invoke('git_workspace_stage_all', { repoPath: projectPath });
      await afterMutation();
    } catch (e) {
      showError(String(e));
    }
  };

  const handleUnstageAll = async () => {
    try {
      await invoke('git_workspace_unstage_all', { repoPath: projectPath });
      await afterMutation();
    } catch (e) {
      showError(String(e));
    }
  };

  const handleDiscard = async (path: string) => {
    const ok = await confirm(t.git.confirmDiscard);
    if (!ok) return;
    try {
      await invoke('undo_changes', {
        options: { repo_path: projectPath, file_paths: [path] },
      });
      await afterMutation();
    } catch (e) {
      showError(String(e));
    }
  };

  const handleDiscardUntracked = async (path: string) => {
    try {
      await invoke('delete_file_or_folder', {
        path: joinRepoPath(projectPath, path),
        permanent: false,
      });
      await afterMutation();
    } catch (e) {
      showError(String(e));
    }
  };

  const handleDiscardAll = async () => {
    const ok = await confirm(t.git.confirmDiscardAll);
    if (!ok) return;
    try {
      await invoke('git_workspace_discard_all', { repoPath: projectPath });
      await afterMutation();
    } catch (e) {
      showError(String(e));
    }
  };

  const handleCommit = async () => {
    const summary = commitSummary.trim();
    if (!summary) {
      showWarning(t.git.commitSummaryRequired);
      return;
    }
    if (!hasStaged) {
      showWarning(t.git.nothingToCommit);
      return;
    }
    const msg = buildCommitMessage(summary, commitDescription);
    try {
      await invoke('git_workspace_commit', { options: { repoPath: projectPath, message: msg } });
      const notice = { subject: summary, committedAt: Date.now() };
      setCommitSummary('');
      setCommitDescription('');
      setRecentCommitNotice(notice);
      setGitPanelDraft(projectPath, {
        commitSummary: '',
        commitDescription: '',
        recentCommitNotice: notice,
      });
      await afterMutation();
    } catch (e) {
      showError(formatGitCommitFailureMessage(String(e), t.git));
    }
  };

  const dismissRecentCommitNotice = useCallback(() => {
    setRecentCommitNotice(null);
    setGitPanelDraft(projectPath, { recentCommitNotice: null });
  }, [projectPath]);

  const handlePush = async () => {
    if (!projectPath) return;
    if (status?.mergeInProgress || status?.rebaseInProgress) return;
    setPushBusy(true);
    setPushStartedAt(Date.now());
    setPushError(null);
    try {
      await invoke('git_workspace_push', { options: { repoPath: projectPath } });
      setPushError(null);
      dismissRecentCommitNotice();
      showSuccess(t.git.pushSucceeded);
      await afterMutation();
    } catch (e) {
      const formatted = formatGitPushFailureMessage(String(e), t.git);
      setPushError(formatted);
      showError(formatted.summary);
      await afterMutation().catch(() => undefined);
    } finally {
      setPushBusy(false);
      setPushStartedAt(null);
    }
  };

  const handleSyncRemote = async () => {
    if (!projectPath || !status?.upstreamName) return;
    if (status.mergeInProgress || status.rebaseInProgress) return;
    setSyncBusy(true);
    try {
      const result = await invoke<GitSyncRemoteResult>('git_workspace_sync_remote', {
        options: { repoPath: projectPath },
      });
      if (result.pulled && result.pushed) {
        showSuccess(t.git.syncRemotePulledAndPushed);
      } else if (result.pulled) {
        showSuccess(t.git.syncRemotePulled);
      } else if (result.pushed) {
        showSuccess(t.git.syncRemotePushed);
      } else {
        showSuccess(t.git.syncRemoteAlreadyUpToDate);
      }
      if (result.pushed) {
        dismissRecentCommitNotice();
      }
      setPushError(null);
      await afterMutation();
    } catch (e) {
      showError(String(e));
      await afterMutation().catch(() => undefined);
    } finally {
      setSyncBusy(false);
    }
  };

  const handleCopyPushError = useCallback(async () => {
    if (!pushError) return;
    try {
      await navigator.clipboard.writeText(pushError.detail);
      showSuccess(t.common.copied);
    } catch {
      showError(t.errors.copyFailed);
    }
  }, [pushError, showError, showSuccess, t.common.copied, t.errors.copyFailed]);

  const handleUndoLastCommit = async () => {
    if (!projectPath || commits.length === 0) return;
    if (status?.mergeInProgress || status?.rebaseInProgress) return;
    const ok = await confirm(t.git.confirmUndoLastCommit);
    if (!ok) return;
    setUndoBusy(true);
    try {
      await invoke('git_workspace_undo_last_commit', { repoPath: projectPath });
      showSuccess(t.git.undoLastCommitSucceeded);
      dismissRecentCommitNotice();
      await afterMutation();
    } catch (e) {
      showError(String(e));
    } finally {
      setUndoBusy(false);
    }
  };

  const handleCheckout = async (branchName: string) => {
    if (!branchName || branchName === status?.branch) return;
    setBranchBusy(true);
    try {
      await invoke('git_workspace_checkout', { options: { repoPath: projectPath, branch: branchName } });
      await afterMutation();
    } catch (e) {
      showError(String(e));
    } finally {
      setBranchBusy(false);
    }
  };

  const handleAbortMerge = async () => {
    try {
      await invoke('git_workspace_abort_merge', { repoPath: projectPath });
      await afterMutation();
    } catch (e) {
      showError(String(e));
    }
  };

  const handleContinueMerge = async () => {
    try {
      await invoke('git_workspace_merge_continue', { repoPath: projectPath });
      await afterMutation();
    } catch (e) {
      showError(String(e));
    }
  };

  const upstreamHint = useMemo(() => {
    if (!status?.upstreamName) return null;
    return t.git.aheadBehind
      .replace(/\{ahead\}/g, String(status.ahead))
      .replace(/\{behind\}/g, String(status.behind));
  }, [status, t.git.aheadBehind]);

  const canSyncRemote = Boolean(
    status?.upstreamName && (status.ahead > 0 || status.behind > 0)
  );

  const pushElapsedLabel = useMemo(() => {
    const mins = Math.floor(pushElapsedSec / 60);
    const secs = pushElapsedSec % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, [pushElapsedSec]);

  const recentCommitLabel = useMemo(() => {
    if (!recentCommitNotice) return null;
    const elapsedMs = recentCommitNow - recentCommitNotice.committedAt;
    if (elapsedMs < 60_000) {
      return t.git.committedJustNow;
    }
    const elapsedMinutes = Math.floor(elapsedMs / 60_000);
    if (elapsedMinutes < 60) {
      return t.git.committedMinutesAgo.replace('{minutes}', String(elapsedMinutes));
    }
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    return t.git.committedHoursAgo.replace('{hours}', String(elapsedHours));
  }, [recentCommitNotice, recentCommitNow, t.git.committedHoursAgo, t.git.committedJustNow, t.git.committedMinutesAgo]);

  const latestCommit = commits[0] ?? null;
  const hasUnpushedCommits = (status?.ahead ?? 0) > 0;
  const showBottomCommitNotice = Boolean(recentCommitNotice || (hasUnpushedCommits && latestCommit));

  const bottomCommitWhenLabel = useMemo(() => {
    if (!showBottomCommitNotice) return null;
    if (recentCommitNotice && recentCommitLabel) return recentCommitLabel;
    if (!latestCommit) return null;
    return formatTimelineCommitWhen(latestCommit.date, {
      justNow: t.git.timelineJustNow,
      minutesAgo: t.git.committedMinutesAgo,
      hoursAgo: t.git.committedHoursAgo,
    });
  }, [
    latestCommit,
    recentCommitLabel,
    recentCommitNotice,
    showBottomCommitNotice,
    t.git.committedHoursAgo,
    t.git.committedMinutesAgo,
    t.git.timelineJustNow,
  ]);

  const bottomCommitSubject = showBottomCommitNotice
    ? recentCommitNotice?.subject ?? latestCommit?.subject ?? null
    : null;

  const gitPanelCtxEntries: GitPanelMenuEntry[] = (() => {
    if (!fileContextMenu || !projectPath) return [];
    const ctx = fileContextMenu;
    const giBlock = (fp: string): GitPanelMenuEntry[] => [
      { kind: 'sep', key: `sep-gi-${fp}` },
      {
        kind: 'item',
        key: `gi-${fp}`,
        label: t.git.addToGitignore,
        onSelect: () => void appendRelPathToGitignore(fp),
      },
    ];
    const openOriginal = (fp: string): GitPanelMenuEntry => ({
      kind: 'item',
      key: `open-${fp}`,
      label: t.git.openOriginalFile,
      onSelect: () => void openRepoFileIfPresent(joinRepoPath(projectPath, fp)),
    });
    const viewBlame = (fp: string): GitPanelMenuEntry => ({
      kind: 'item',
      key: `blame-${fp}`,
      label: t.git.viewBlame,
      onSelect: () => void handleViewBlame(fp),
    });
    const blameIfTracked = (row: DisplayRow, fp: string): GitPanelMenuEntry[] =>
      row.scmVariant !== 'deleted' && row.kind !== 'untracked' ? [viewBlame(fp)] : [];

    if (ctx.section === 'conflict') {
      return [openOriginal(ctx.filePath), viewBlame(ctx.filePath), ...giBlock(ctx.filePath)];
    }

    const row = ctx.row;
    const fp = row.filePath;

    if (ctx.section === 'staged') {
      const items: GitPanelMenuEntry[] = [
        {
          kind: 'item',
          key: `unstage-${fp}`,
          label: t.git.unstage,
          onSelect: () => void handleUnstage(fp),
        },
      ];
      if (!shouldHideOpenFileForRow(row)) {
        items.push(openOriginal(fp));
      }
      return [...items, ...blameIfTracked(row, fp), ...giBlock(fp)];
    }

    if (ctx.section === 'unstaged') {
      const items: GitPanelMenuEntry[] = [
        {
          kind: 'item',
          key: `stage-${fp}`,
          label: t.git.stage,
          onSelect: () => void handleStage(fp),
        },
        {
          kind: 'item',
          key: `discard-${fp}`,
          label: t.git.discard,
          onSelect: () => void handleDiscard(fp),
          danger: true,
        },
      ];
      if (!shouldHideOpenFileForRow(row)) {
        items.push(openOriginal(fp));
      }
      return [...items, ...blameIfTracked(row, fp), ...giBlock(fp)];
    }

    const items: GitPanelMenuEntry[] = [
      {
        kind: 'item',
        key: `stage-u-${fp}`,
        label: t.git.stage,
        onSelect: () => void handleStage(fp),
      },
      {
        kind: 'item',
        key: `discard-u-${fp}`,
        label: t.git.discard,
        onSelect: () => void handleDiscardUntracked(fp),
        danger: true,
      },
    ];
    if (!shouldHideOpenFileForRow(row)) {
      items.push(openOriginal(fp));
    }
    return [...items, ...blameIfTracked(row, fp), ...giBlock(fp)];
  })();

  const handleChangesTabSelect = useCallback((tab: ChangesTab) => {
    setChangesTab(tab);
    requestAnimationFrame(() => {
      changesSectionRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, []);

  const showChangesCardHeader =
    (changesTab === 'unstaged' && unstagedRows.length > 0) ||
    (changesTab === 'staged' && stagedRows.length > 0);

  const blameDateLabel = useCallback((epochStr: string) => formatBlameEpochDate(epochStr), []);

  if (!projectPath) {
    return (
      <div className={styles.container}>
        <div className={styles.topBar}>
          <div className={styles.topBarTitleGroup}>
            <span className={styles.topBarTitle}>{t.git.workspaceTitle}</span>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.iconButton} onClick={onCollapse} title={t.git.collapseSidebar}>
              ‹
            </button>
          </div>
        </div>
        <div className={styles.mainScroll}>
          <div className={styles.empty}>{t.git.openFolderFirst}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {fileContextMenu && gitPanelCtxEntries.length > 0 && (
        <GitPanelContextMenu
          x={fileContextMenu.x}
          y={fileContextMenu.y}
          onClose={() => setFileContextMenu(null)}
          entries={gitPanelCtxEntries}
        />
      )}
      <div className={styles.topBar}>
        <div className={styles.topBarTitleGroup}>
          <span className={styles.topBarTitle}>{t.git.workspaceTitle}</span>
        </div>
        <div className={styles.headerActions}>
          {isGitRepo === true && (
            <button
              type="button"
              className={styles.headerGitignoreBtn}
              onClick={() => void handleOpenOrCreateGitignore()}
              disabled={loading || gitignoreBusy}
              title={t.git.openGitignoreTooltip}
              aria-label={t.git.openGitignoreTooltip}
            >
              {t.git.openGitignore}
            </button>
          )}
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => void refresh({ force: true })}
            disabled={loading}
            title={t.git.refresh}
            aria-label={t.git.refresh}
          >
            <span className={loading ? styles.spin : undefined}>↻</span>
          </button>
          <button type="button" className={styles.iconButton} onClick={onCollapse} title={t.git.collapseSidebar}>
            ‹
          </button>
        </div>
      </div>

      <div className={styles.mainScroll}>
        {isGitRepo === false && <div className={styles.empty}>{t.git.notAGitRepo}</div>}

        {isGitRepo === true && status && (
          <>
            {blameState && (
              <div ref={blamePanelRef} className={styles.blamePanel}>
                <div className={styles.blameHeader}>
                  <span
                    className={styles.blameTitle}
                    title={gitPathPreferSeparators(projectPath, blameState.filePath)}
                  >
                    {t.git.blameTitle}: {gitPathPreferSeparators(projectPath, blameState.filePath)}
                  </span>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => setBlameState(null)}
                  >
                    {t.git.blameClose}
                  </button>
                </div>
                {blameState.loading ? (
                  <div className={styles.meta}>{t.git.blameLoading}</div>
                ) : blameState.error ? (
                  <div className={styles.blameError}>{blameState.error}</div>
                ) : blameState.lines.length === 0 ? (
                  <div className={styles.meta}>—</div>
                ) : (
                  <div className={styles.blameList}>
                    {blameState.lines.map((line) => (
                      <div key={`${line.lineNo}-${line.commitHash}`} className={styles.blameLine}>
                        <button
                          type="button"
                          className={styles.blameLineNoBtn}
                          title={t.git.blameGoToLineTooltip}
                          onClick={() => handleBlameLineClick(line.lineNo)}
                        >
                          {line.lineNo}
                        </button>
                        <button
                          type="button"
                          className={styles.blameContentBtn}
                          title={line.content || t.git.blameGoToLineTooltip}
                          onClick={() => handleBlameLineClick(line.lineNo)}
                        >
                          {line.content || ' '}
                        </button>
                        <button
                          type="button"
                          className={styles.blameMetaBtn}
                          title={`${t.git.blameOpenCommitTooltip}\n${line.author} · ${line.commitHash} · ${blameDateLabel(line.date)}`}
                          onClick={() => void handleBlameCommitClick(line.commitHash)}
                        >
                          <span className={styles.blameHash}>{line.commitHash.slice(0, 7)}</span>
                          <span className={styles.blameAuthor}>
                            {line.author} · {blameDateLabel(line.date)}
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(status.mergeInProgress || status.rebaseInProgress) && (
              <div className={styles.banner}>
                <div className={styles.bannerRow}>
                  {status.mergeInProgress && <span>{t.git.mergeInProgress}</span>}
                  {status.rebaseInProgress && <span>{t.git.rebaseInProgress}</span>}
                </div>
                <div className={styles.bannerRow}>
                  <button type="button" className={styles.dangerButton} onClick={() => void handleAbortMerge()}>
                    {t.git.abortMerge}
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void handleContinueMerge()}
                    disabled={conflicted.length > 0}
                    title={conflicted.length > 0 ? t.git.conflicts : t.git.continueMerge}
                  >
                    {t.git.continueMerge}
                  </button>
                </div>
              </div>
            )}

            {conflictEntries.length > 0 && (
              <div className={styles.conflictsCard}>
                <div className={styles.changesCardHeader}>
                  <span className={styles.sectionTitle}>{t.git.conflicts}</span>
                </div>
                <div className={styles.fileList}>
                  {conflictEntries.map((c) => (
                    <div
                      key={c.filePath}
                      className={styles.fileRow}
                      onContextMenu={(e) =>
                        openGitFileContextMenu(e, { section: 'conflict', filePath: c.filePath })
                      }
                    >
                      <GitResourceStripe variant="conflict" title={t.git.scmHintConflict} />
                      <GitScmPathLabel
                        key={c.filePath}
                        fullPath={gitPathPreferSeparators(projectPath, c.displayPath)}
                        className={`${styles.filePath} ${styles.gitPathSlot}`}
                        title={gitPathPreferSeparators(projectPath, c.displayPath)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.heroCard}>
              <div className={styles.heroTop}>
                <div className={styles.branchPill}>
                  <GitBranchSelect
                    branches={branches}
                    currentBranch={status.branch}
                    disabled={branchBusy || loading}
                    switchBranchLabel={t.git.switchBranch}
                    localGroupLabel={t.git.branchGroupLocal}
                    remoteGroupLabel={t.git.branchGroupRemote}
                    onSelect={(branchName) => void handleCheckout(branchName)}
                  />
                </div>
                <span className={styles.heroRemote} title={status.upstreamName ?? undefined}>
                  {status.upstreamName ?? '—'}
                </span>
              </div>
              <div className={styles.statsRow}>
                <div className={styles.statTile}>
                  <span className={styles.statValueAhead}>{status.ahead}</span>
                  <span className={styles.statLabel}>{t.git.aheadLabel}</span>
                </div>
                <div className={styles.statTile}>
                  <span className={styles.statValueBehind}>{status.behind}</span>
                  <span className={styles.statLabel}>{t.git.behindLabel}</span>
                </div>
              </div>
              <div className={styles.heroActions}>
                <button
                  type="button"
                  className={styles.heroActionBtn}
                  disabled={branchBusy || loading || gitOpsDisabled}
                  title={t.git.createBranch}
                  aria-label={t.git.createBranch}
                  onClick={() => {
                    setBranchFormMode('create');
                    setBranchFormValue('');
                  }}
                >
                  {t.git.branchActionNew}
                </button>
                <button
                  type="button"
                  className={styles.heroActionBtn}
                  disabled={branchBusy || loading || gitOpsDisabled}
                  title={t.git.renameBranch}
                  aria-label={t.git.renameBranch}
                  onClick={() => {
                    setBranchFormMode('rename');
                    setBranchFormValue(status.branch);
                  }}
                >
                  {t.git.branchActionRename}
                </button>
                <button
                  type="button"
                  className={`${styles.heroActionBtn} ${styles.heroActionBtnDanger}`}
                  disabled={branchBusy || loading || gitOpsDisabled}
                  title={t.git.deleteBranch}
                  aria-label={t.git.deleteBranch}
                  onClick={() => {
                    setBranchFormMode('delete');
                    const local = branches.find((b) => !b.isRemote && !b.isCurrent);
                    setBranchFormTarget(local?.name ?? '');
                  }}
                >
                  {t.git.branchActionDelete}
                </button>
              </div>
              {branchFormMode && (
                <div className={styles.branchForm}>
                  {branchFormMode === 'delete' ? (
                    <select
                      className={styles.branchSelect}
                      value={branchFormTarget}
                      disabled={branchBusy}
                      onChange={(e) => setBranchFormTarget(e.target.value)}
                    >
                      {branches
                        .filter((b) => !b.isRemote && !b.isCurrent)
                        .map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <input
                      className={styles.branchInput}
                      type="text"
                      value={branchFormValue}
                      placeholder={t.git.branchNamePlaceholder}
                      disabled={branchBusy}
                      onChange={(e) => setBranchFormValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (branchFormMode === 'create') void handleCreateBranch();
                          else void handleRenameBranch();
                        }
                        if (e.key === 'Escape') setBranchFormMode(null);
                      }}
                    />
                  )}
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.linkButton}
                      disabled={branchBusy}
                      onClick={() => setBranchFormMode(null)}
                    >
                      {t.git.branchFormCancel}
                    </button>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={branchBusy}
                      onClick={() => {
                        if (branchFormMode === 'create') void handleCreateBranch();
                        else if (branchFormMode === 'rename') void handleRenameBranch();
                        else void handleDeleteBranch();
                      }}
                    >
                      {t.git.branchFormConfirm}
                    </button>
                  </div>
                </div>
              )}
              {upstreamHint && (
                <div className={styles.meta}>
                  {status.upstreamName} · {upstreamHint}
                </div>
              )}
              {canSyncRemote && (
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => void handleSyncRemote()}
                    disabled={
                      loading ||
                      syncBusy ||
                      pushBusy ||
                      Boolean(status.mergeInProgress || status.rebaseInProgress)
                    }
                    title={t.git.syncRemoteTooltip}
                  >
                    {syncBusy ? t.git.syncRemoteInProgress : t.git.syncRemote}
                  </button>
                </div>
              )}
            </div>

            <div className={styles.changesSection} ref={changesSectionRef}>
              <div className={styles.tabBar} role="tablist" aria-label={t.git.changes}>
                {(
                  [
                    ['unstaged', t.git.changesTabWorking, unstagedRows.length] as const,
                    ['staged', t.git.changesTabStaged, stagedRows.length] as const,
                    ['untracked', t.git.changesTabUntracked, untrackedRows.length] as const,
                  ] as const
                ).map(([tab, label, count]) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={changesTab === tab}
                    aria-controls="git-changes-panel"
                    className={`${styles.tabButton} ${changesTab === tab ? styles.tabButtonActive : ''}`}
                    onClick={() => handleChangesTabSelect(tab)}
                  >
                    {tabLabelWithCount(label, count)}
                  </button>
                ))}
              </div>

              <div className={styles.changesCard} id="git-changes-panel" role="tabpanel">
                {showChangesCardHeader && (
                  <div
                    className={`${styles.changesCardHeader} ${changesTab !== 'unstaged' ? styles.changesCardHeaderActionsOnly : ''}`}
                  >
                    {changesTab === 'unstaged' && (
                      <span className={styles.changesCardHint} title={t.git.changesCardHint}>
                        {t.git.changesCardHint}
                      </span>
                    )}
                    <div className={styles.changesCardHeaderActions}>
                      {changesTab === 'staged' && (
                        <button
                          type="button"
                          className={styles.changesCardActionLink}
                          onClick={() => void handleUnstageAll()}
                        >
                          {t.git.unstageAll}
                        </button>
                      )}
                      {changesTab === 'unstaged' && (
                        <>
                          <button
                            type="button"
                            className={styles.changesCardActionLink}
                            onClick={() => void handleStageAll()}
                          >
                            {t.git.stageAll}
                          </button>
                          <span className={styles.changesCardActionSep} aria-hidden="true">
                            ·
                          </span>
                          <button
                            type="button"
                            className={styles.changesCardActionLink}
                            onClick={() => void handleDiscardAll()}
                            disabled={stagedRows.length === 0 && unstagedRows.length === 0}
                          >
                            {t.git.discardAll}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
                <div className={styles.changesCardBody}>
                  {activeChangeRows.length === 0 ? (
                    <div className={styles.meta} style={{ padding: '12px' }}>
                      {t.git.changesEmpty}
                    </div>
                  ) : (
                    activeChangeRows.map((r) => {
                      const ctxSection =
                        changesTab === 'staged' ? 'staged' : changesTab === 'untracked' ? 'untracked' : 'unstaged';
                      return (
                        <div
                          key={`${changesTab}-${r.filePath}`}
                          className={styles.changeFileRow}
                          onContextMenu={(e) => openGitFileContextMenu(e, { section: ctxSection, row: r })}
                        >
                          <div className={`${styles.fileIconBox} ${scmIconColorClass(r.scmVariant)}`}>
                            {r.scmLetter}
                          </div>
                          <div className={styles.fileMeta}>
                            <button
                              type="button"
                              className={styles.fileName}
                              title={gitPathPreferSeparators(projectPath, r.displayPath)}
                              onClick={() => void openDiffOrFileForRow(r)}
                              style={{ opacity: openingRowKey === rowKey(r) ? 0.65 : undefined }}
                            >
                              {pathBaseName(r.displayPath)}
                            </button>
                            <span className={styles.fileStatus}>{scmBadgeHint(r.scmVariant, t.git)}</span>
                          </div>
                          <div className={styles.fileRowActions}>
                            {changesTab === 'staged' && (
                              <button
                                type="button"
                                className={styles.fileRowActionBtn}
                                onClick={() => void handleUnstage(r.filePath)}
                              >
                                {t.git.unstage}
                              </button>
                            )}
                            {changesTab === 'unstaged' && (
                              <>
                                <button
                                  type="button"
                                  className={styles.fileRowActionBtn}
                                  onClick={() => void handleStage(r.filePath)}
                                >
                                  {t.git.stage}
                                </button>
                                <button
                                  type="button"
                                  className={`${styles.fileRowActionBtn} ${styles.fileRowActionMuted}`}
                                  onClick={() => void handleDiscard(r.filePath)}
                                >
                                  {t.git.discard}
                                </button>
                              </>
                            )}
                            {changesTab === 'untracked' && (
                              <>
                                <button
                                  type="button"
                                  className={styles.fileRowActionBtn}
                                  onClick={() => void handleStage(r.filePath)}
                                >
                                  {t.git.stage}
                                </button>
                                <button
                                  type="button"
                                  className={`${styles.fileRowActionBtn} ${styles.fileRowActionMuted}`}
                                  onClick={() => void appendRelPathToGitignore(r.filePath)}
                                >
                                  {t.git.ignoreFile}
                                </button>
                                <button
                                  type="button"
                                  className={styles.fileRowActionBtn}
                                  onClick={() => void handleDiscardUntracked(r.filePath)}
                                >
                                  {t.git.discard}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className={styles.timelineSection} ref={commitsSectionRef}>
              <div className={styles.timelineHead}>
                <span className={styles.sectionTitle}>{t.git.timelineTitle}</span>
                {!showAllCommits && commits.length > 5 && (
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => setShowAllCommits(true)}
                  >
                    {t.git.viewAllCommits}
                  </button>
                )}
              </div>
              {commits.length === 0 ? (
                <div className={styles.meta}>{t.git.noCommits}</div>
              ) : (
                <div className={styles.timelineCard}>
                  {timelineCommits.map((c, index) => (
                    <div key={c.hash} className={styles.timelineRow}>
                      <div className={styles.timelineRail}>
                        <span className={styles.timelineDot} aria-hidden="true" />
                        {index < timelineCommits.length - 1 && (
                          <span className={styles.timelineLine} aria-hidden="true" />
                        )}
                      </div>
                      <div className={styles.timelineBody}>
                        <button
                          type="button"
                          className={styles.timelineRowButton}
                          title={`${c.subject}\n${c.author} · ${c.date}`}
                          aria-label={`${c.hash.slice(0, 7)} ${c.subject}`}
                          aria-expanded={selectedCommitHash === c.hash}
                          onClick={() => void handleToggleCommitDetail(c.hash)}
                        >
                          <div className={styles.timelineTop}>
                            <span className={styles.timelineHash}>{c.hash.slice(0, 7)}</span>
                            <span className={styles.timelineWhen}>
                              {formatTimelineCommitWhen(c.date, {
                                justNow: t.git.timelineJustNow,
                                minutesAgo: t.git.committedMinutesAgo,
                                hoursAgo: t.git.committedHoursAgo,
                              })}
                            </span>
                          </div>
                          <span className={styles.timelineSubject}>{c.subject}</span>
                        </button>
                        {selectedCommitHash === c.hash && (
                          <div className={styles.commitDetail}>
                            {commitDetailLoading && (
                              <div className={styles.meta}>{t.git.commitDetailLoading}</div>
                            )}
                            {commitDetail && commitDetail.meta.hash === c.hash && (
                              <>
                                <div className={styles.commitDetailMeta}>
                                  <div>{commitDetail.meta.author}</div>
                                  <div>{commitDetail.meta.date}</div>
                                  {commitDetail.meta.body && (
                                    <div className={styles.commitDetailBody}>{commitDetail.meta.body}</div>
                                  )}
                                  {commitDetail.truncated && (
                                    <div className={styles.meta}>{t.git.commitTruncated}</div>
                                  )}
                                </div>
                                <div className={styles.sectionTitle}>{t.git.commitFilesChanged}</div>
                                <div className={styles.fileList}>
                                  {commitDetail.files.map((f) => {
                                    const fileVariant = commitFileStatusVariant(f.status);
                                    return (
                                    <div
                                      key={f.path}
                                      className={styles.fileRow}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => void handleOpenCommitFileDiff(c.hash, f.path)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          void handleOpenCommitFileDiff(c.hash, f.path);
                                        }
                                      }}
                                    >
                                      <GitResourceStripe
                                        variant={fileVariant}
                                        title={scmBadgeHint(fileVariant, t.git)}
                                      />
                                      <GitScmPathLabel
                                        fullPath={gitPathPreferSeparators(projectPath, f.path)}
                                        className={`${styles.filePath} ${styles.gitPathSlot} ${styles.clickablePath}`}
                                      />
                                      <span className={styles.commitFileStats}>
                                        <span className={styles.commitFileAdditions}>+{f.additions}</span>
                                        <span className={styles.commitFileDeletions}>-{f.deletions}</span>
                                      </span>
                                    </div>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {showAllCommits && hasMoreCommits && (
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={commitsLoadingMore || loading}
                  onClick={() => void handleLoadMoreCommits()}
                >
                  {t.git.loadMoreCommits}
                </button>
              )}
            </div>

            <div className={styles.stashSection}>
              <div className={styles.stashSectionHead}>
                <span className={styles.sectionTitle}>{t.git.stashList}</span>
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={stashLoading || gitOpsDisabled}
                  onClick={() => void handleStashSave()}
                >
                  {t.git.stashSave}
                </button>
              </div>
              {stashList.length === 0 ? (
                <div className={styles.meta}>{t.git.noStashEntries}</div>
              ) : (
                <div className={styles.stashListCompact}>
                  {stashList.map((s) => (
                    <div key={s.index} className={styles.stashRow}>
                      <div className={styles.stashMeta}>
                        <span className={styles.logHash}>
                          stash@{'{'}
                          {s.index}
                          {'}'}
                        </span>
                        <span className={styles.logSubject} title={s.message}>
                          {s.message}
                        </span>
                        <span className={styles.meta}>{s.date}</span>
                      </div>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.linkButton}
                          disabled={gitOpsDisabled}
                          onClick={() => void handleStashApply(s.index)}
                        >
                          {t.git.stashApply}
                        </button>
                        <button
                          type="button"
                          className={styles.linkButton}
                          disabled={gitOpsDisabled}
                          onClick={() => void handleStashPop(s.index)}
                        >
                          {t.git.stashPop}
                        </button>
                        <button
                          type="button"
                          className={`${styles.linkButton} ${styles.dangerLink}`}
                          disabled={gitOpsDisabled}
                          onClick={() => void handleStashDrop(s.index)}
                        >
                          {t.git.stashDrop}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {isGitRepo === null && <div className={styles.empty}>{t.git.loading}</div>}
      </div>
      {isGitRepo === true && status && (
        <div className={styles.bottomDock}>
          <div className={styles.dockCommitForm}>
            <input
              className={styles.dockSummaryInput}
              type="text"
              value={commitSummary}
              placeholder={t.git.commitSummaryPlaceholder}
              disabled={loading || gitOpsDisabled}
              aria-label={t.git.commitSummaryPlaceholder}
              onChange={(e) => setCommitSummary(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void handleCommit();
                }
              }}
            />
            <textarea
              className={styles.dockCommitField}
              placeholder={t.git.commitDescriptionPlaceholder}
              value={commitDescription}
              disabled={loading || gitOpsDisabled}
              aria-label={t.git.commitDescriptionPlaceholder}
              onChange={(e) => setCommitDescription(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void handleCommit();
                }
              }}
            />
          </div>
          <div className={styles.dockActions}>
            <button
              type="button"
              className={styles.dockPrimaryBtn}
              onClick={() => void handleCommit()}
              disabled={!hasStaged || loading}
            >
              {t.git.commit}
            </button>
            <button
              type="button"
              className={styles.dockSecondaryBtn}
              onClick={() => void handlePush()}
              disabled={
                loading ||
                pushBusy ||
                syncBusy ||
                Boolean(status.mergeInProgress || status.rebaseInProgress)
              }
              title={t.git.pushTooltip}
            >
              {t.git.push}
            </button>
          </div>
          {bottomCommitSubject && bottomCommitWhenLabel && (
            <div className={styles.commitNotice} role="status" aria-live="polite">
              <div className={styles.commitNoticeMain}>
                <div className={styles.commitNoticeWhen}>
                  {recentCommitNotice ? bottomCommitWhenLabel : `${t.git.latestCommitLabel} · ${bottomCommitWhenLabel}`}
                </div>
                <div className={styles.commitNoticeSubject} title={bottomCommitSubject}>
                  {bottomCommitSubject}
                </div>
              </div>
              <button
                type="button"
                className={styles.commitNoticeUndo}
                onClick={() => void handleUndoLastCommit()}
                disabled={
                  loading ||
                  undoBusy ||
                  commits.length === 0 ||
                  Boolean(status.mergeInProgress || status.rebaseInProgress)
                }
                title={t.git.confirmUndoLastCommit}
              >
                {t.git.undoLastCommit}
              </button>
            </div>
          )}
          {!bottomCommitSubject && (
            <div className={styles.dockUndoRow}>
              <button
                type="button"
                className={styles.dockUndoLink}
                onClick={() => void handleUndoLastCommit()}
                disabled={
                  loading ||
                  undoBusy ||
                  commits.length === 0 ||
                  Boolean(status.mergeInProgress || status.rebaseInProgress)
                }
                title={t.git.confirmUndoLastCommit}
              >
                {t.git.undoLastCommit}
              </button>
            </div>
          )}
          {pushBusy && (
            <div className={styles.progressCard} role="status" aria-live="polite">
              <div className={styles.progressHeader}>
                <span className={styles.progressTitle}>{t.git.pushInProgress}</span>
                <span className={styles.progressMeta}>{pushElapsedLabel}</span>
              </div>
              <div className={styles.progressBar} aria-hidden="true">
                <span className={styles.progressBarFill} />
              </div>
              <div className={styles.progressHint}>{t.git.pushProgressHint}</div>
            </div>
          )}
          {pushError && !pushBusy && (
            <div className={styles.pushErrorCard} role="alert">
              <div className={styles.pushErrorTitle}>{t.git.pushFailedTitle}</div>
              <div className={styles.pushErrorSummary}>{pushError.summary}</div>
              <div className={styles.pushErrorActions}>
                <button
                  type="button"
                  className={`${styles.linkButton} ${styles.commitSecondaryButton}`}
                  onClick={() => void handlePush()}
                  disabled={loading || Boolean(status?.mergeInProgress || status?.rebaseInProgress)}
                >
                  {t.git.pushRetry}
                </button>
                <button
                  type="button"
                  className={`${styles.linkButton} ${styles.commitSecondaryButton}`}
                  onClick={() => void handleCopyPushError()}
                >
                  {t.git.pushCopyError}
                </button>
              </div>
              <div className={styles.pushErrorDetail} title={pushError.detail}>
                {pushError.detail}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
