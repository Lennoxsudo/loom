import { describe, expect, it } from 'vitest';
import {
  parseBgTaskLines,
  summarizeKillBgTask,
  summarizeListBgTasks,
  summarizeSearchBoth,
} from './toolResultSummaries';

describe('summarizeSearchBoth', () => {
  it('parses dual-section output with query from args', () => {
    const text = [
      '文件名匹配 (3 个):',
      '- src/auth.ts',
      '- src/auth.test.ts',
      '',
      '---',
      '',
      '找到 2 个文件包含 "auth":',
      '',
      '📄 src/auth.ts',
    ].join('\n');

    const summary = summarizeSearchBoth(text, { query: 'auth' });
    expect(summary.query).toBe('auth');
    expect(summary.fileCount).toBe(3);
    expect(summary.placeCount).toBe(2);
    expect(summary.noMatches).toBe(false);
    expect(summary.expandable).toBe(true);
  });

  it('detects no matches', () => {
    const summary = summarizeSearchBoth('未找到匹配 "missing" 的文件或内容', { query: 'missing' });
    expect(summary.noMatches).toBe(true);
    expect(summary.expandable).toBe(false);
  });
});

describe('summarizeListBgTasks', () => {
  it('parses mixed running and completed tasks', () => {
    const text = [
      'Background tasks:',
      '- bg-1: "npm run dev" [running pid=1234]',
      '- bg-2: "sleep 10" [completed exit=0 1200ms] pid=5678',
    ].join('\n');

    const summary = summarizeListBgTasks(text);
    expect(summary.total).toBe(2);
    expect(summary.running).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.empty).toBe(false);
    expect(summary.tasks[0]?.command).toBe('npm run dev');
  });

  it('detects empty task list', () => {
    const summary = summarizeListBgTasks('No background tasks.');
    expect(summary.empty).toBe(true);
    expect(summary.total).toBe(0);
  });
});

describe('parseBgTaskLines', () => {
  it('extracts task rows', () => {
    const tasks = parseBgTaskLines('- abc123: "echo hi" [running pid=99]');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: 'abc123', command: 'echo hi', status: 'running' });
  });
});

describe('summarizeKillBgTask', () => {
  it('reads task id from args', () => {
    const summary = summarizeKillBgTask('Background task abc123 has been terminated.', {
      terminal_id: 'abc123',
    });
    expect(summary.taskId).toBe('abc123');
    expect(summary.terminated).toBe(true);
  });

  it('falls back to output text for task id', () => {
    const summary = summarizeKillBgTask('Background task task-xyz has been terminated.');
    expect(summary.taskId).toBe('task-xyz');
  });
});
