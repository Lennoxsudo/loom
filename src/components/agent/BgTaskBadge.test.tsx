import { describe, expect, it } from 'vitest';
import { filterBackgroundTasksForConversation } from './BgTaskBadge';
import type { BackgroundTaskSummary } from '../../types/ai';

const task = (overrides: Partial<BackgroundTaskSummary>): BackgroundTaskSummary => ({
  task_id: 'bg0',
  pid: 1,
  command: 'npm run dev',
  completed: false,
  exit_code: null,
  duration_ms: null,
  ...overrides,
});

describe('filterBackgroundTasksForConversation', () => {
  it('shows only tasks for the current conversation', () => {
    const tasks = [
      task({ task_id: 'bg1', conversation_id: 'conv-a' }),
      task({ task_id: 'bg2', conversation_id: 'conv-b' }),
    ];

    const filtered = filterBackgroundTasksForConversation(tasks, 'conv-a');
    expect(filtered.map((item) => item.task_id)).toEqual(['bg1']);
  });

  it('hides tagged tasks when no conversation is selected', () => {
    const tasks = [
      task({ conversation_id: 'conv-a' }),
      task({ task_id: 'bg-legacy' }),
    ];

    const filtered = filterBackgroundTasksForConversation(tasks, null);
    expect(filtered.map((item) => item.task_id)).toEqual(['bg-legacy']);
  });
});
