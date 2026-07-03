export type SubagentHookEvent = 'SubagentStart' | 'SubagentStop';

export async function runSubagentHooks(
  event: SubagentHookEvent,
  payload: { taskId: string; subagentType: string; status?: string }
): Promise<void> {
  try {
    await import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke('run_subagent_hooks', { event, payload })
    );
  } catch {
    // hooks optional — no-op in tests or when command unavailable
  }
}
