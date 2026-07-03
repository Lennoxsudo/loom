import type { SubagentArtifact } from '../../types/subagent';

export function parseSubagentResult(summary: string): {
  summary: string;
  artifacts?: SubagentArtifact[];
  assumptions?: string[];
} {
  const artifacts: SubagentArtifact[] = [];
  const assumptions: string[] = [];

  const filePathPattern = /(?:^|\s)((?:[\w./\\-]+[/\\])?[\w.-]+\.\w{1,10})(?:\s|$|,|;)/g;
  const seenFiles = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = filePathPattern.exec(summary)) !== null) {
    const ref = match[1];
    if (!seenFiles.has(ref) && ref.length > 3) {
      seenFiles.add(ref);
      artifacts.push({ type: 'file', ref });
    }
  }

  const assumptionsSection = summary.match(
    /(?:假设与阻塞|Assumptions\s*&\s*Blockers|Assumptions)[:\s]*\n([\s\S]*?)(?:\n##|\n- \*\*|$)/i
  );
  if (assumptionsSection?.[1]) {
    for (const line of assumptionsSection[1].split('\n')) {
      const trimmed = line.replace(/^[-*]\s*/, '').trim();
      if (trimmed) assumptions.push(trimmed);
    }
  }

  const actionsSection = summary.match(
    /(?:做了什么|Actions\s*Taken)[:\s]*\n([\s\S]*?)(?:\n##|\n- \*\*|$)/i
  );
  if (actionsSection?.[1]) {
    for (const line of actionsSection[1].split('\n')) {
      const trimmed = line.replace(/^[-*]\s*/, '').trim();
      if (trimmed && /^(ran|executed|npm|git|cargo|pnpm|yarn)\b/i.test(trimmed)) {
        artifacts.push({ type: 'command', ref: trimmed.slice(0, 200) });
      }
    }
  }

  return {
    summary,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
    assumptions: assumptions.length > 0 ? assumptions : undefined,
  };
}
