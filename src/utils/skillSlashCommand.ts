/**
 * Skill slash commands: /skill-name [args] autocomplete + send-time expansion.
 */

import { loadSkillContent, type SkillEntry } from './skills';

const SLASH_NAME_RE = /^\/([\w-]+)(?:\s+([\s\S]*))?$/;
const SLASH_TOKEN_RE = /(^|\s)\/([\w-]*)$/;

export interface SlashSkillInvocation {
  name: string;
  args: string;
  /** full match length from start of trimmed text */
  raw: string;
}

export interface SlashTokenAtCursor {
  /** absolute start index of the '/' in value */
  start: number;
  /** absolute end index of the partial token (usually cursor) */
  end: number;
  /** partial name after '/', may be empty */
  query: string;
}

export type ExpandSkillSlashResult =
  | { kind: 'plain'; original: string }
  | {
      kind: 'expanded';
      original: string;
      skillName: string;
      args: string;
      expandedText: string;
      description: string;
      scope: 'global' | 'project';
    }
  | { kind: 'unknown'; original: string; skillName: string; args: string };

export function formatSlashCommandDisplay(name: string, args: string): string {
  const trimmedArgs = args.trim();
  return trimmedArgs ? `/${name} ${trimmedArgs}` : `/${name}`;
}

/** Detect a leading /skill invocation for the whole message (after trim). */
export function parseSlashSkillInvocation(text: string): SlashSkillInvocation | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const match = trimmed.match(SLASH_NAME_RE);
  if (!match) return null;
  return {
    name: match[1],
    args: (match[2] ?? '').trimEnd(),
    raw: trimmed,
  };
}

/**
 * Detect an in-progress /token at the cursor for autocomplete.
 * Only triggers when the token starts after start-of-string or whitespace
 * and the cursor is at the end of that token.
 */
export function parseLeadingSlashToken(
  value: string,
  cursor: number
): SlashTokenAtCursor | null {
  if (cursor < 0 || cursor > value.length) return null;
  const before = value.slice(0, cursor);
  const match = before.match(SLASH_TOKEN_RE);
  if (!match) return null;
  const slashIndex = before.lastIndexOf('/');
  if (slashIndex < 0) return null;
  // Do not treat already-completed multi-word commands as a partial token
  // when cursor is mid-args: SLASH_TOKEN_RE already requires end-of-before.
  return {
    start: slashIndex,
    end: cursor,
    query: match[2] ?? '',
  };
}

export function filterSkillsForSlashQuery(
  skills: SkillEntry[],
  query: string
): SkillEntry[] {
  const q = query.trim().toLowerCase();
  const invocable = skills.filter((s) => s.userInvocable !== false);
  if (!q) return invocable;
  return invocable.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
  );
}

export function replaceSlashToken(
  value: string,
  token: SlashTokenAtCursor,
  skillName: string
): { nextValue: string; cursor: number } {
  const insertion = `/${skillName} `;
  const nextValue = value.slice(0, token.start) + insertion + value.slice(token.end);
  const cursor = token.start + insertion.length;
  return { nextValue, cursor };
}

export function applySkillArguments(body: string, args: string): string {
  return body.replaceAll('$ARGUMENTS', args);
}

/**
 * Expand a user message that is exactly a /skill invocation.
 * Non-matching text is returned as plain.
 */
export async function expandSkillSlashCommand(
  text: string,
  projectPath: string
): Promise<ExpandSkillSlashResult> {
  const original = text;
  const invocation = parseSlashSkillInvocation(text);
  if (!invocation) {
    return { kind: 'plain', original };
  }

  const loaded = await loadSkillContent(invocation.name, projectPath || '');
  if (!loaded) {
    return {
      kind: 'unknown',
      original,
      skillName: invocation.name,
      args: invocation.args,
    };
  }

  // Non-user-invocable skills still expand if the user typed the name explicitly
  // (they just won't appear in the autocomplete list).
  const expandedText = applySkillArguments(loaded.content, invocation.args);
  return {
    kind: 'expanded',
    original,
    skillName: invocation.name,
    args: invocation.args,
    expandedText,
    description: loaded.description,
    scope: loaded.scope,
  };
}
