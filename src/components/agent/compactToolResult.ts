export type CompactToolPlanMeta = {
  title?: string;
  length?: string;
  lead?: string;
};

export function parsePlanToolOutput(text: string): CompactToolPlanMeta | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const titleLine = lines.find((line) => /^Title:\s*/i.test(line));
  const lengthLine = lines.find((line) => /^Length:\s*/i.test(line));
  if (!titleLine && !lengthLine) return null;

  const rawTitle = titleLine?.replace(/^Title:\s*/i, '').trim();
  const title = rawTitle && rawTitle !== '(none)' ? rawTitle : undefined;
  const length = lengthLine?.replace(/^Length:\s*/i, '').trim();
  const lead = lines[0];

  return { title, length, lead };
}

export function resolveCompactToolLabel(
  toolName: string | undefined,
  labels: Record<string, string | undefined>,
  fallback: string
): string {
  const key = (toolName || '').trim();
  if (!key) return fallback;
  return labels[key] || fallback;
}
