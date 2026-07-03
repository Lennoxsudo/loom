/**
 * Tests for Automation task model: type validation, trigger serialization, event shapes.
 */

import { describe, it, expect } from 'vitest';
import type {
  AutomationTask,
  AutomationTrigger,
  AutomationRunRecord,
  AutomationTriggeredEvent,
  AutomationRunStatus,
} from '../../types/automation';

describe('Automation types', () => {
  describe('AutomationTrigger', () => {
    it('interval trigger has type and minutes', () => {
      const trigger: AutomationTrigger = { type: 'interval', minutes: 30 };
      expect(trigger.type).toBe('interval');
      if (trigger.type === 'interval') {
        expect(trigger.minutes).toBe(30);
      }
    });

    it('cron trigger has type and expression', () => {
      const trigger: AutomationTrigger = { type: 'cron', expression: '0 */6 * * *' };
      expect(trigger.type).toBe('cron');
      if (trigger.type === 'cron') {
        expect(trigger.expression).toBe('0 */6 * * *');
      }
    });

    it('file_change trigger has type and patterns', () => {
      const trigger: AutomationTrigger = { type: 'file_change', patterns: ['**/*.ts', '**/*.tsx'] };
      expect(trigger.type).toBe('file_change');
      if (trigger.type === 'file_change') {
        expect(trigger.patterns).toHaveLength(2);
      }
    });
  });

  describe('AutomationRunRecord', () => {
    it('has required fields', () => {
      const record: AutomationRunRecord = {
        runAt: '2026-01-01T00:00:00Z',
        status: 'succeeded',
      };
      expect(record.runAt).toBe('2026-01-01T00:00:00Z');
      expect(record.status).toBe('succeeded');
      expect(record.summary).toBeUndefined();
    });

    it('supports all status values', () => {
      const statuses: AutomationRunStatus[] = ['succeeded', 'failed', 'blocked_by_approval'];
      for (const status of statuses) {
        const record: AutomationRunRecord = { runAt: '2026-01-01T00:00:00Z', status };
        expect(record.status).toBe(status);
      }
    });
  });

  describe('AutomationTask', () => {
    it('has all required fields', () => {
      const task: AutomationTask = {
        id: 'test-1',
        name: 'Test',
        enabled: true,
        trigger: { type: 'interval', minutes: 30 },
        targetProjectPath: '/tmp/project',
        targetThreadId: null,
        prompt: 'Hello',
        accessMode: 'auto',
        runHistory: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      expect(task.id).toBe('test-1');
      expect(task.enabled).toBe(true);
      expect(task.targetThreadId).toBeNull();
    });

    it('can have optional fields', () => {
      const task: AutomationTask = {
        id: 'test-2',
        name: 'Test with thread',
        enabled: true,
        trigger: { type: 'cron', expression: '0 9 * * 1' },
        targetProjectPath: '/tmp/project',
        targetThreadId: 'thread-123',
        prompt: 'Weekly review',
        accessMode: 'read_only',
        lastRunAt: '2026-01-01T09:00:00Z',
        nextRunAt: '2026-01-08T09:00:00Z',
        runHistory: [
          { runAt: '2026-01-01T09:00:00Z', status: 'succeeded', summary: 'Done' },
        ],
        createdAt: '2025-12-01T00:00:00Z',
        updatedAt: '2026-01-01T09:00:00Z',
      };
      expect(task.targetThreadId).toBe('thread-123');
      expect(task.lastRunAt).toBeDefined();
      expect(task.runHistory).toHaveLength(1);
    });
  });

  describe('AutomationTriggeredEvent', () => {
    it('has the correct shape for frontend consumption', () => {
      const event: AutomationTriggeredEvent = {
        taskId: 'task-1',
        targetThreadId: 'thread-1',
        prompt: 'Run tests',
        targetProjectPath: '/tmp/project',
        accessMode: 'auto',
      };
      expect(event.taskId).toBe('task-1');
      expect(event.targetThreadId).toBe('thread-1');
      expect(event.accessMode).toBe('auto');
    });

    it('supports null targetThreadId', () => {
      const event: AutomationTriggeredEvent = {
        taskId: 'task-2',
        targetThreadId: null,
        prompt: 'Create new thread',
        targetProjectPath: '/tmp/project',
        accessMode: 'read_only',
      };
      expect(event.targetThreadId).toBeNull();
    });
  });
});
