function parseYamlList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseYamlScalar(line: string): string {
  return line.trim().replace(/^['"]|['"]$/g, '');
}

export function parseAgentMarkdown(raw: string): {
  frontmatter: Record<string, string | string[] | boolean>;
  body: string;
} {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return { frontmatter: {}, body: raw.trim() };
  }

  const yaml = match[1];
  const body = raw.slice(match[0].length).trim();
  const frontmatter: Record<string, string | string[] | boolean> = {};

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (rawValue === 'true') {
      frontmatter[key] = true;
    } else if (rawValue === 'false') {
      frontmatter[key] = false;
    } else if (rawValue.includes(',')) {
      frontmatter[key] = parseYamlList(rawValue);
    } else {
      frontmatter[key] = parseYamlScalar(rawValue);
    }
  }

  return { frontmatter, body };
}

export function frontmatterToDefinition(
  frontmatter: Record<string, string | string[] | boolean>,
  body: string,
  source: 'project' | 'user',
  filePath: string
): import('./types').SubagentDefinition | null {
  const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
  if (!name) return null;

  const description =
    typeof frontmatter.description === 'string'
      ? frontmatter.description.trim()
      : body.split('\n')[0]?.replace(/^#+\s*/, '').trim().slice(0, 200) || name;

  const toStringList = (v: unknown): string[] | undefined => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'string' && v.trim()) return parseYamlList(v);
    return undefined;
  };

  const maxTurnsRaw = frontmatter.maxTurns;
  const maxTurns =
    typeof maxTurnsRaw === 'string'
      ? parseInt(maxTurnsRaw, 10)
      : typeof maxTurnsRaw === 'number'
        ? maxTurnsRaw
        : undefined;

  return {
    name,
    description,
    prompt: body,
    tools: toStringList(frontmatter.tools),
    disallowedTools: toStringList(frontmatter.disallowedTools),
    model: typeof frontmatter.model === 'string' ? frontmatter.model : undefined,
    maxTurns: Number.isFinite(maxTurns) ? maxTurns : undefined,
    permissionMode:
      typeof frontmatter.permissionMode === 'string'
        ? (frontmatter.permissionMode as import('./types').SubagentPermissionMode)
        : undefined,
    background: frontmatter.background === true,
    color: typeof frontmatter.color === 'string' ? frontmatter.color : undefined,
    skills: toStringList(frontmatter.skills),
    isolation:
      frontmatter.isolation === 'worktree' ? 'worktree' : undefined,
    source,
    filePath,
    canNest: toStringList(frontmatter.tools)?.some(
      (t) => t === 'Agent' || t === 'Task' || t === 'run_subagent'
    ),
  };
}
