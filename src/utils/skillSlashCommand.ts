/**
 * Skill slash commands: /skill-name [args] autocomplete + link-style send.
 *
 * Send does NOT expand skill body into the user message. The message stays a
 * short /name args link; the model should call load_skill for full content.
 */

import { loadSkillContent, type SkillEntry } from './skills';

const SLASH_NAME_RE = /^\/([\w-]+)(?:\s+([\s\S]*))?$/;
const SLASH_TOKEN_RE = /(^|\s)\/([\w-]*)$/;

export interface SlashSkillInvocation {
  name: string;
  args: string;
  /** full match from start of trimmed text */
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
      kind: 'linked';
      original: string;
      skillName: string;
      args: string;
      /** Short form kept as user message body (not expanded skill content) */
      linkedText: string;
      description: string;
      scope: 'global' | 'project';
    }
  | { kind: 'unknown'; original: string; skillName: string; args: string };

export function formatSlashCommandDisplay(name: string, args: string): string {
  const trimmedArgs = args.trim();
  return trimmedArgs ? `/${name} ${trimmedArgs}` : `/${name}`;
}

/**
 * Build the user-visible / model-visible link text for a skill invocation.
 * Does not include skill body — model loads via load_skill.
 */
export function formatSkillLinkMessage(name: string, args: string): string {
  const display = formatSlashCommandDisplay(name, args);
  const argLine = args.trim()
    ? `User arguments: ${args.trim()}`
    : 'User arguments: (none)';
  return [
    display,
    '',
    `[Skill link] Call load_skill with skill_name="${name}" to load full instructions. ${argLine}`,
  ].join('\n');
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
 * Resolve a user message that is exactly a /skill invocation.
 * Link style: does not expand skill body into the message.
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

  const linkedText = formatSkillLinkMessage(invocation.name, invocation.args);
  return {
    kind: 'linked',
    original,
    skillName: invocation.name,
    args: invocation.args,
    linkedText,
    description: loaded.description,
    scope: loaded.scope,
  };
}
