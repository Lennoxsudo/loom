/**
 * 拖拽放置区域组件
 */

import { useDroppable } from '@dnd-kit/core';
import {
  SPLIT_ZONE_RIGHT_ID,
  SPLIT_ZONE_DOWN_ID,
  OPEN_ZONE_LEFT_ID,
  EDITOR_TAB_BAR_HEIGHT_PX,
} from '../../types/app';

interface DropZoneProps {
  active: boolean;
}

/**
 * 右侧分割放置区域
 */
export function SplitRightDropZone({ active }: DropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: SPLIT_ZONE_RIGHT_ID,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        position: 'absolute',
        top: `${EDITOR_TAB_BAR_HEIGHT_PX}px`,
        right: 0,
        bottom: 0,
        width: '50%',
        pointerEvents: active ? 'auto' : 'none',
        backgroundColor: active && isOver ? 'var(--bg-hover)' : 'transparent',
        boxShadow: active && isOver ? 'inset 0 0 0 2px var(--border-focus)' : 'none',
        transition: 'background-color 0.08s, box-shadow 0.08s',
        zIndex: active ? 5 : 0,
      }}
    />
  );
}

/**
 * 下方分割放置区域
 */
export function SplitDownDropZone({ active }: DropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: SPLIT_ZONE_DOWN_ID,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: `calc(${EDITOR_TAB_BAR_HEIGHT_PX}px + (100% - ${EDITOR_TAB_BAR_HEIGHT_PX}px) / 2)`,
        height: `calc((100% - ${EDITOR_TAB_BAR_HEIGHT_PX}px) / 2)`,
        pointerEvents: active ? 'auto' : 'none',
        backgroundColor: active && isOver ? 'var(--bg-hover)' : 'transparent',
        boxShadow: active && isOver ? 'inset 0 0 0 2px var(--border-focus)' : 'none',
        transition: 'background-color 0.08s, box-shadow 0.08s',
        zIndex: active ? 6 : 0,
      }}
    />
  );
}

/**
 * 左侧打开放置区域
 */
export function OpenLeftDropZone({ active }: DropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: OPEN_ZONE_LEFT_ID,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        position: 'absolute',
        top: `${EDITOR_TAB_BAR_HEIGHT_PX}px`,
        left: 0,
        bottom: 0,
        width: '50%',
        pointerEvents: active ? 'auto' : 'none',
        backgroundColor: active && isOver ? 'var(--bg-hover)' : 'transparent',
        boxShadow: active && isOver ? 'inset 0 0 0 2px var(--border-focus)' : 'none',
        transition: 'background-color 0.08s, box-shadow 0.08s',
        zIndex: active ? 4 : 0,
      }}
    />
  );
}
