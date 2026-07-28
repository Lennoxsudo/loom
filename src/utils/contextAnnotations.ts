/**
 * Lightweight @ path context annotations for Agent/Chat composers.
 * Paths only — no file contents are read.
 */

export type ContextAnnotationKind = 'codebase' | 'file' | 'folder';

export interface ContextAnnotation {
  id: string;
  kind: ContextAnnotationKind;
  /** Absolute or project-relative path; for codebase this is the project root */
  path: string;
  /** Display / @token label (e.g. codebase, src/App.tsx) */
  label: string;
}

export interface AtMentionToken {
  start: number;
  end: number;
  query: string;
}

/** Default markdown heading used when i18n is unavailable */
export const DEFAULT_CONTEXT_ANNOTATION_MARKER = '# 上下文标注\n\n';

const AT_TOKEN_RE = /(^|[\s])@([^\s]*)$/;
const PATH_MENTION_RE = /(?:^|[\s])@(codebase|[^\s]*[/\\][^\s]*)/g;

export function createContextAnnotationId(): string {
  return `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isPathLikeMention(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  if (t === 'codebase') return true;
  return /[/\\]/.test(t);
}

/**
 * Detect an in-progress @token at the cursor for autocomplete.
 */
export function parseAtMentionToken(value: string, cursor: number): AtMentionToken | null {
  if (cursor < 0 || cursor > value.length) return null;
  const before = value.slice(0, cursor);
  const match = before.match(AT_TOKEN_RE);
  if (!match) return null;
  const atIndex = before.lastIndexOf('@');
  if (atIndex < 0) return null;
  return {
    start: atIndex,
    end: cursor,
    query: match[2] ?? '',
  };
}

export function replaceAtMentionToken(
  value: string,
  token: AtMentionToken,
  mentionLabel: string
): { nextValue: string; cursor: number } {
  const insertion = `@${mentionLabel}`;
  const before = value.slice(0, token.start);
  const after = value.slice(token.end);
  const needsTrailingSpace = after.length === 0 || !/^\s/.test(after);
  const text = `${insertion}${needsTrailingSpace ? ' ' : ''}`;
  const nextValue = before + text + after;
  return { nextValue, cursor: before.length + text.length };
}

/**
 * Extract path-like @mentions from free text. Ignores bare @word (skills/mcp).
 */
export function extractPathMentionsFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  PATH_MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_MENTION_RE.exec(text)) !== null) {
    const raw = match[1];
    if (!isPathLikeMention(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

export function dedupeContextAnnotations(annotations: ContextAnnotation[]): ContextAnnotation[] {
  const seen = new Set<string>();
  const out: ContextAnnotation[] = [];
  for (const a of annotations) {
    const key = `${a.kind}:${a.path.replace(/\\/g, '/').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * Merge explicit annotation chips with path-like @tokens found in draft text.
 */
export function mergeAnnotationsFromText(
  annotations: ContextAnnotation[],
  draftText: string,
  projectPath: string
): ContextAnnotation[] {
  const fromText: ContextAnnotation[] = [];
  for (const mention of extractPathMentionsFromText(draftText)) {
    if (mention === 'codebase') {
      fromText.push({
        id: createContextAnnotationId(),
        kind: 'codebase',
        path: projectPath,
        label: 'codebase',
      });
      continue;
    }
    const normalized = mention.replace(/\\/g, '/');
    const isFolder = normalized.endsWith('/');
    fromText.push({
      id: createContextAnnotationId(),
      kind: isFolder ? 'folder' : 'file',
      path: mention,
      label: mention,
    });
  }
  return dedupeContextAnnotations([...annotations, ...fromText]);
}

export function serializeContextAnnotations(
  annotations: ContextAnnotation[],
  projectPath: string,
  marker = DEFAULT_CONTEXT_ANNOTATION_MARKER
): string {
  const list = dedupeContextAnnotations(annotations);
  if (list.length === 0) return '';

  const lines: string[] = [marker.replace(/\n+$/, ''), ''];
  for (const a of list) {
    if (a.kind === 'codebase') {
      const root = (a.path || projectPath).trim();
      lines.push(`- codebase: \`${root}\``);
    } else if (a.kind === 'folder') {
      lines.push(`- folder: \`${a.path}\``);
    } else {
      lines.push(`- file: \`${a.path}\``);
    }
  }
  lines.push('', '---', '', '');
  return lines.join('\n');
}

/**
 * Strip a leading context-annotation block (and optionally a file-context block).
 */
export function splitPrefixedUserMessageContent(
  content: string,
  markers: string[]
): { prefix: string; body: string } {
  let remaining = content || '';
  let prefix = '';

  for (let guard = 0; guard < markers.length + 2 && remaining; guard++) {
    const marker = markers.find((m) => m && remaining.startsWith(m));
    if (!marker) break;
    const splitIndex = remaining.indexOf('\n---\n\n');
    if (splitIndex === -1) break;
    const chunkEnd = splitIndex + '\n---\n\n'.length;
    prefix += remaining.slice(0, chunkEnd);
    remaining = remaining.slice(chunkEnd);
  }

  return { prefix, body: remaining };
}

export function parentFolderPaths(filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return [];
  const folders: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    folders.push(parts.slice(0, i).join('/') + '/');
  }
  return folders;
}

/** Labels for UI chips derived from serialized annotation / file-context prefixes. */
export function extractAnnotationLabelsFromPrefix(prefix: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const line of prefix.split('\n')) {
    const codebase = line.match(/^- codebase:\s*`([^`]+)`/);
    if (codebase) {
      const label = '@codebase';
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
      continue;
    }
    const folder = line.match(/^- folder:\s*`([^`]+)`/);
    if (folder) {
      const label = `@${folder[1]}`;
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
      continue;
    }
    const file = line.match(/^- file:\s*`([^`]+)`/);
    if (file) {
      const label = `@${file[1]}`;
      if (!seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
      continue;
    }
    const fileContext = line.match(/^- (.+?) \(`[^`]+`\)$/);
    if (fileContext) {
      const label = fileContext[1].trim();
      if (label && !seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
  }
  return labels;
}
