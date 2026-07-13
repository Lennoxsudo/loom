import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  conversationIdFromPlanEditorPath,
  getPlanEditorPath,
  isPlanEditorPath,
  isVirtualEditorPath,
  onPlanEditorContentChange,
} from '../planEditorBridge';
import {
  clearPlan,
  inferPlanTitle,
  peekPlan,
  PLAN_UPDATED_EVENT,
  setPlan,
} from '../../features/agent-engine/planStore';

describe('planEditorBridge', () => {
  it('builds a virtual markdown path for conversation ids', () => {
    const path = getPlanEditorPath('conv-123');
    expect(isPlanEditorPath(path)).toBe(true);
    expect(isVirtualEditorPath(path)).toBe(true);
    expect(path.endsWith('.md')).toBe(true);
    expect(conversationIdFromPlanEditorPath(path)).toBe('conv-123');
  });

  it('round-trips conversation ids with special characters', () => {
    const id = 'proj/abc:def';
    const path = getPlanEditorPath(id);
    expect(conversationIdFromPlanEditorPath(path)).toBe(id);
  });

  it('accepts backslash-normalized plan paths', () => {
    const path = getPlanEditorPath('conv-bs');
    expect(isPlanEditorPath(path.replace(/\//g, '\\'))).toBe(true);
  });

  it('rejects non-plan paths', () => {
    expect(isPlanEditorPath('D:/repo/README.md')).toBe(false);
    expect(isVirtualEditorPath('D:/repo/README.md')).toBe(false);
    expect(conversationIdFromPlanEditorPath('D:/repo/README.md')).toBeNull();
  });

  it('treats other virtual editor tabs as non-disk paths', () => {
    expect(isVirtualEditorPath('__diff__/abc')).toBe(true);
    expect(isVirtualEditorPath('__agent__')).toBe(true);
    expect(isVirtualEditorPath('__settings__')).toBe(true);
  });

  describe('onPlanEditorContentChange', () => {
    const conversationId = 'conv-editor-sync';

    beforeEach(() => {
      clearPlan(conversationId);
      setPlan(conversationId, {
        content: '# original\n',
        title: 'Original',
        status: 'accepted',
      });
    });

    afterEach(() => {
      clearPlan(conversationId);
    });

    it('writes editor buffer into planStore and emits PLAN_UPDATED', () => {
      const path = getPlanEditorPath(conversationId);
      const listener = vi.fn();
      window.addEventListener(PLAN_UPDATED_EVENT, listener);

      const ok = onPlanEditorContentChange(path, '# edited from main editor\n');
      expect(ok).toBe(true);
      expect(peekPlan(conversationId).content).toBe('# edited from main editor\n');
      expect(peekPlan(conversationId).status).toBe('accepted');
      expect(listener).toHaveBeenCalled();

      const detail = listener.mock.calls[0][0].detail as {
        conversationId: string;
        plan: { content: string };
      };
      expect(detail.conversationId).toBe(conversationId);
      expect(detail.plan.content).toBe('# edited from main editor\n');

      window.removeEventListener(PLAN_UPDATED_EVENT, listener);
    });
  });
});

describe('inferPlanTitle', () => {
  it('prefers explicit title', () => {
    expect(inferPlanTitle('# Body heading\nmore', 'Explicit')).toBe('Explicit');
  });

  it('extracts first markdown heading', () => {
    expect(
      inferPlanTitle('# 给 README 增加一段安装说明 - 实现计划\n\n## 项目概况\n- a'),
    ).toBe('给 README 增加一段安装说明');
  });

  it('falls back to first prose line', () => {
    expect(inferPlanTitle('先改 README\n再验证')).toBe('先改 README');
  });
});
