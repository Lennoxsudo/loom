import type { Message, PendingFileChange } from './types';

export type GroupedChatItem =
  | Message
  | { type: 'tool_group'; id: string; messages: Message[] }
  | { type: 'pending_changes'; id: string; changes: PendingFileChange[] };

export interface SizeRange {
  startIndex: number;
  endIndex: number;
  size: number;
}

export interface UserMsgMarker {
  top: number;
  id: string;
}

export const DEFAULT_ITEM_HEIGHT = 80;

export function getItemOffset(
  ranges: SizeRange[],
  index: number,
  defaultSize = DEFAULT_ITEM_HEIGHT
): number {
  if (ranges.length === 0) {
    return index * defaultSize;
  }

  let offset = 0;
  let nextIndex = 0;

  for (const range of ranges) {
    if (index < range.startIndex) {
      return offset + (index - nextIndex) * defaultSize;
    }

    if (range.startIndex > nextIndex) {
      offset += (range.startIndex - nextIndex) * defaultSize;
      nextIndex = range.startIndex;
    }

    if (index <= range.endIndex) {
      return offset + (index - range.startIndex) * range.size;
    }

    offset += (range.endIndex - range.startIndex + 1) * range.size;
    nextIndex = range.endIndex + 1;
  }

  if (index >= nextIndex) {
    return offset + (index - nextIndex) * defaultSize;
  }

  return offset;
}

export function getItemSize(
  ranges: SizeRange[],
  index: number,
  defaultSize = DEFAULT_ITEM_HEIGHT
): number {
  for (const range of ranges) {
    if (index >= range.startIndex && index <= range.endIndex) {
      return range.size;
    }
  }
  return defaultSize;
}

export function computeUserMsgMarkerPositions(
  grouped: GroupedChatItem[],
  ranges: SizeRange[],
  scrollHeight: number,
  defaultItemHeight = DEFAULT_ITEM_HEIGHT
): UserMsgMarker[] {
  if (scrollHeight <= 0 || grouped.length === 0) {
    return [];
  }

  const markers: UserMsgMarker[] = [];
  for (let i = 0; i < grouped.length; i++) {
    const item = grouped[i];
    if (!('type' in item) && item.role === 'user') {
      const offset = getItemOffset(ranges, i, defaultItemHeight);
      const size = getItemSize(ranges, i, defaultItemHeight);
      markers.push({
        id: item.id,
        top: ((offset + size / 2) / scrollHeight) * 100,
      });
    }
  }
  return markers;
}

function roundMarkerTop(top: number): number {
  return Math.round(top * 10) / 10;
}

export function areUserMsgMarkersEqual(a: UserMsgMarker[], b: UserMsgMarker[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (roundMarkerTop(a[i].top) !== roundMarkerTop(b[i].top)) return false;
  }
  return true;
}
