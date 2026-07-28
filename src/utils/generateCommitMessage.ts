/**
 * Draft a Conventional Commits message from staged git diff via AI.
 */

import { invoke } from '@tauri-apps/api/core';
import type { AIProvider } from './agentPersistence';
import {
  BUILTIN_PROFILE_ID,
  BUILTIN_TRANSPORT_PROVIDER,
  isBuiltinProtocol,
} from './builtinGateway';
import { getActiveProfileRuntime, type LoadedAiConfig } from './aiProviderRuntime';

export const COMMIT_MESSAGE_DIFF_MAX_CHARS = 50_000;

export type CommitMessageDraft = {
  summary: string;
  description: string;
};

export type GitDiffInvokeResult = {
  files: Array<{ path: string; status?: string; additions?: number; deletions?: number }>;
  summary?: { total_files?: number; total_additions?: number; total_deletions?: number };
  raw_diff: string;
  truncated?: boolean;
};

export class GenerateCommitMessageError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_STAGED' | 'NO_AI_CONFIG' | 'EMPTY_RESULT' | 'FAILED'
  ) {
    super(message);
    this.name = 'GenerateCommitMessageError';
  }
}

/** Strip fences/quotes and split first line / body. */
export function parseCommitMessageDraft(raw: string): CommitMessageDraft {
  let text = (raw || '').trim();
  const fence = text.match(/^```(?:\w+)?\s*([\s\S]*?)```$/);
  if (fence?.[1]) {
    text = fence[1].trim();
  }
  text = text.replace(/^["'`]+|["'`]+$/g, '').trim();

  if (!text) {
    return { summary: '', description: '' };
  }

  const lines = text.split(/\r?\n/);
  let summary = (lines[0] || '').trim();
  if (summary.length > 72) {
    summary = summary.slice(0, 72).trimEnd();
  }

  let bodyStart = 1;
  while (bodyStart < lines.length && lines[bodyStart].trim() === '') {
    bodyStart += 1;
  }
  const description = lines.slice(bodyStart).join('\n').trim();

  return { summary, description };
}

export function truncateDiffText(diff: string, maxChars = COMMIT_MESSAGE_DIFF_MAX_CHARS): string {
  if (diff.length <= maxChars) return diff;
  return `${diff.slice(0, maxChars)}\n\n... [diff truncated for commit message generation]`;
}

export function buildFileSummaryFromDiff(result: GitDiffInvokeResult): string {
  const lines: string[] = [];
  if (result.summary) {
    lines.push(
      `files=${result.summary.total_files ?? result.files.length} +${result.summary.total_additions ?? 0} -${result.summary.total_deletions ?? 0}`
    );
  }
  for (const file of result.files.slice(0, 40)) {
    const stats =
      file.additions != null || file.deletions != null
        ? ` (+${file.additions ?? 0} -${file.deletions ?? 0})`
        : '';
    lines.push(`- ${file.status ? `${file.status} ` : ''}${file.path}${stats}`);
  }
  if (result.files.length > 40) {
    lines.push(`- … and ${result.files.length - 40} more`);
  }
  return lines.join('\n');
}

export function resolveCommitMessageAiRuntime(config: LoadedAiConfig): {
  provider: string;
  model: string;
  profileId?: string;
} {
  if (config.autoRouting?.enabled && (config.autoRouting.entries?.length ?? 0) > 0) {
    const entry = config.autoRouting.entries![0];
    const provider = isBuiltinProtocol(entry.provider)
      ? BUILTIN_TRANSPORT_PROVIDER
      : entry.provider;
    if (!entry.model?.trim()) {
      throw new GenerateCommitMessageError('No AI model configured', 'NO_AI_CONFIG');
    }
    return {
      provider,
      model: entry.model.trim(),
      profileId: entry.profileId || undefined,
    };
  }

  const selected = (config.selectedProvider || 'openai').trim();
  if (isBuiltinProtocol(selected)) {
    const items = config.profiles?.openai?.items ?? [];
    const builtin = items.find((item) => item.id === BUILTIN_PROFILE_ID);
    const model = builtin?.models?.map((m) => m.trim()).find(Boolean);
    if (!model) {
      throw new GenerateCommitMessageError('No AI model configured', 'NO_AI_CONFIG');
    }
    return {
      provider: BUILTIN_TRANSPORT_PROVIDER,
      model,
      profileId: BUILTIN_PROFILE_ID,
    };
  }

  const provider = (
    ['openai', 'anthropic', 'ollama'].includes(selected) ? selected : 'openai'
  ) as AIProvider;
  const active = getActiveProfileRuntime(config, provider);
  if (!active?.defaultModel) {
    throw new GenerateCommitMessageError('No AI model configured', 'NO_AI_CONFIG');
  }
  return {
    provider,
    model: active.defaultModel,
    profileId: active.profileId || undefined,
  };
}

export async function generateCommitMessageFromStagedDiff(
  repoPath: string
): Promise<CommitMessageDraft> {
  const trimmedRepo = repoPath.trim();
  if (!trimmedRepo) {
    throw new GenerateCommitMessageError('No repository path', 'FAILED');
  }

  const diffResult = await invoke<GitDiffInvokeResult>('get_git_diff', {
    options: {
      repo_path: trimmedRepo,
      file_path: null,
      cached: true,
      max_lines: null,
    },
  });

  if (!diffResult?.files?.length || !diffResult.raw_diff?.trim()) {
    throw new GenerateCommitMessageError('No staged changes', 'NO_STAGED');
  }

  const configStr = await invoke<string>('load_ai_config');
  if (!configStr?.trim()) {
    throw new GenerateCommitMessageError('No AI model configured', 'NO_AI_CONFIG');
  }

  let config: LoadedAiConfig;
  try {
    config = JSON.parse(configStr) as LoadedAiConfig;
  } catch {
    throw new GenerateCommitMessageError('No AI model configured', 'NO_AI_CONFIG');
  }

  const runtime = resolveCommitMessageAiRuntime(config);
  const fileSummary = buildFileSummaryFromDiff(diffResult);
  const diffText = truncateDiffText(diffResult.raw_diff);

  let raw: string;
  try {
    raw = await invoke<string>('generate_commit_message', {
      provider: runtime.provider,
      model: runtime.model,
      diffText,
      fileSummary,
      profileId: runtime.profileId ?? null,
    });
  } catch (error) {
    throw new GenerateCommitMessageError(
      error instanceof Error ? error.message : String(error),
      'FAILED'
    );
  }

  const draft = parseCommitMessageDraft(raw);
  if (!draft.summary) {
    throw new GenerateCommitMessageError('Empty commit message from model', 'EMPTY_RESULT');
  }
  return draft;
}
