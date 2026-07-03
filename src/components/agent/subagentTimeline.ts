import type { SubagentRun, SubagentTimelineEntry } from '../../types/subagent';

/** Resolve timeline entries, falling back for runs created before timeline tracking. */
export function resolveSubagentTimeline(run: SubagentRun): SubagentTimelineEntry[] {
  if (run.timeline && run.timeline.length > 0) {
    return run.timeline;
  }

  const entries: SubagentTimelineEntry[] = [];
  if (run.thinkingText?.trim()) {
    entries.push({
      kind: 'thinking',
      id: 'legacy-thinking',
      text: run.thinkingText,
    });
  }
  for (const event of run.toolEvents ?? []) {
    entries.push({
      kind: 'tool',
      id: event.id,
      toolName: event.toolName,
      status: event.status,
      resultPreview: event.resultPreview,
    });
  }
  return entries;
}
