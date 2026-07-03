/**
 * useEditorSplitResize Hook
 *
 * 处理编辑器分屏 resize 逻辑
 */

import { useEffect } from 'react';
import type { EditorGroupId, EditorGroupState } from '../types/app';

export interface UseEditorSplitResizeOptions {
  isSplit: boolean;
  isEditorSplitResizing: boolean;
  splitDirection: 'row' | 'column';
  splitRatioRow: number;
  splitRatioColumn: number;
  editorSplitContainerRef: React.RefObject<HTMLDivElement | null>;
  editorGroups: EditorGroupState[];
  layoutEditors: () => void;
  setSplitRatioRow: (ratio: number) => void;
  setSplitRatioColumn: (ratio: number) => void;
  setIsEditorSplitResizing: (isResizing: boolean) => void;
  setEditorGroups: React.Dispatch<React.SetStateAction<EditorGroupState[]>>;
  setActiveGroupId: (groupId: EditorGroupId) => void;
  setHoveredTabId: (tabId: string | null) => void;
  editorInstanceByGroupRef: React.MutableRefObject<Partial<Record<EditorGroupId, unknown>>>;
}

export interface UseEditorSplitResizeReturn {
  activeSplitRatio: number;
}

export function useEditorSplitResize({
  isSplit,
  isEditorSplitResizing,
  splitDirection,
  splitRatioRow,
  splitRatioColumn,
  editorSplitContainerRef,
  editorGroups,
  layoutEditors,
  setSplitRatioRow,
  setSplitRatioColumn,
  setIsEditorSplitResizing,
  setEditorGroups,
  setActiveGroupId,
  setHoveredTabId,
  editorInstanceByGroupRef,
}: UseEditorSplitResizeOptions): UseEditorSplitResizeReturn {
  // 编辑器分屏 resize 逻辑
  useEffect(() => {
    if (!isSplit || !isEditorSplitResizing) return;

    let raf = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const el = editorSplitContainerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      if (splitDirection === 'row') {
        const minPx = 180;
        const minRatio = Math.min(0.45, minPx / rect.width);
        const x = e.clientX - rect.left;
        const next = x / rect.width;
        const clamped = Math.max(minRatio, Math.min(1 - minRatio, next));
        setSplitRatioRow(clamped);
      } else {
        const minPx = 140;
        const minRatio = Math.min(0.45, minPx / rect.height);
        const y = e.clientY - rect.top;
        const next = y / rect.height;
        const clamped = Math.max(minRatio, Math.min(1 - minRatio, next));
        setSplitRatioColumn(clamped);
      }

      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          layoutEditors();
        });
      }
    };

    const handleMouseUp = () => {
      setIsEditorSplitResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    isSplit,
    isEditorSplitResizing,
    splitDirection,
    layoutEditors,
    setSplitRatioRow,
    setSplitRatioColumn,
    setIsEditorSplitResizing,
    editorSplitContainerRef,
  ]);

  // 分屏后布局编辑器
  useEffect(() => {
    if (editorGroups.length < 2) {
      delete (editorInstanceByGroupRef.current as Record<string, unknown>)['group-2'];
    }

    let raf1 = 0;
    let raf2 = 0;

    raf1 = requestAnimationFrame(() => {
      layoutEditors();
      raf2 = requestAnimationFrame(() => {
        layoutEditors();
      });
    });

    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [editorGroups.length, splitDirection, layoutEditors, editorInstanceByGroupRef]);

  // 自动关闭空的分屏
  useEffect(() => {
    if (editorGroups.length < 2) return;

    const g1 = editorGroups.find((g) => g.id === 'group-1') || editorGroups[0];
    const g2 = editorGroups.find((g) => g.id === 'group-2') || null;

    const g1Empty = !g1 || g1.tabPaths.length === 0;
    const g2Empty = !g2 || g2.tabPaths.length === 0;

    if (!g1Empty && !g2Empty) return;

    const keep = g1Empty ? g2 : g1;
    const nextTabs = keep?.tabPaths || [];
    const nextActive = keep?.activePath || null;

    setIsEditorSplitResizing(false);
    setEditorGroups([{ id: 'group-1', tabPaths: nextTabs, activePath: nextActive }]);
    setActiveGroupId('group-1');
    setHoveredTabId(null);
  }, [editorGroups, setIsEditorSplitResizing, setEditorGroups, setActiveGroupId, setHoveredTabId]);

  const activeSplitRatio = splitDirection === 'row' ? splitRatioRow : splitRatioColumn;

  return {
    activeSplitRatio,
  };
}
