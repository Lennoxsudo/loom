import { describe, expect, it } from 'vitest';
import type { Message } from './types';
import {
  areUserMsgMarkersEqual,
  computeUserMsgMarkerPositions,
  getItemOffset,
  getItemSize,
  type GroupedChatItem,
  type SizeRange,
  type UserMsgMarker,
} from './userMsgMarkerPositions';

function userMessage(id: string): Message {
  return {
    id,
    role: 'user',
    content: `message ${id}`,
    timestamp: Date.now(),
  };
}

function assistantMessage(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: `reply ${id}`,
    timestamp: Date.now(),
  };
}

describe('getItemOffset', () => {
  it('uses default height when ranges are empty', () => {
    expect(getItemOffset([], 3, 100)).toBe(300);
  });

  it('reads offset from a uniform range', () => {
    const ranges: SizeRange[] = [{ startIndex: 0, endIndex: 4, size: 100 }];
    expect(getItemOffset(ranges, 2, 100)).toBe(200);
  });
});

describe('getItemSize', () => {
  it('returns measured size when index is inside a range', () => {
    const ranges: SizeRange[] = [
      { startIndex: 0, endIndex: 0, size: 80 },
      { startIndex: 1, endIndex: 1, size: 400 },
    ];
    expect(getItemSize(ranges, 1, 80)).toBe(400);
  });
});

describe('computeUserMsgMarkerPositions', () => {
  it('returns empty markers when scroll height is zero', () => {
    const grouped: GroupedChatItem[] = [userMessage('u1')];
    expect(computeUserMsgMarkerPositions(grouped, [], 0)).toEqual([]);
  });

  it('places markers using measured offsets for uniform ranges', () => {
    const grouped: GroupedChatItem[] = [
      userMessage('u1'),
      assistantMessage('a1'),
      userMessage('u2'),
      assistantMessage('a2'),
      userMessage('u3'),
    ];
    const ranges: SizeRange[] = [{ startIndex: 0, endIndex: 4, size: 100 }];
    const markers = computeUserMsgMarkerPositions(grouped, ranges, 500);

    expect(markers).toHaveLength(3);
    expect(markers[0]).toEqual({ id: 'u1', top: 10 });
    expect(markers[1]).toEqual({ id: 'u2', top: 50 });
    expect(markers[2]).toEqual({ id: 'u3', top: 90 });
  });

  it('does not evenly distribute markers when item heights differ', () => {
    const grouped: GroupedChatItem[] = [
      userMessage('u1'),
      assistantMessage('a1'),
      userMessage('u2'),
    ];
    const ranges: SizeRange[] = [
      { startIndex: 0, endIndex: 0, size: 80 },
      { startIndex: 1, endIndex: 1, size: 400 },
      { startIndex: 2, endIndex: 2, size: 80 },
    ];
    const scrollHeight = 560;
    const markers = computeUserMsgMarkerPositions(grouped, ranges, scrollHeight);

    const equalIndexSecondMarkerTop = ((2 + 0.5) / grouped.length) * 100;
    const secondMarkerTop = markers.find((marker) => marker.id === 'u2')?.top ?? 0;

    expect(markers).toHaveLength(2);
    expect(markers[0]?.top).toBeCloseTo((40 / scrollHeight) * 100, 5);
    expect(secondMarkerTop).toBeCloseTo((520 / scrollHeight) * 100, 5);
    expect(secondMarkerTop).not.toBeCloseTo(equalIndexSecondMarkerTop, 1);
  });
});

describe('areUserMsgMarkersEqual', () => {
  const markers: UserMsgMarker[] = [
    { id: 'u1', top: 10.04 },
    { id: 'u2', top: 50.06 },
  ];

  it('returns true for markers with the same ids and rounded tops', () => {
    expect(
      areUserMsgMarkersEqual(markers, [
        { id: 'u1', top: 10.01 },
        { id: 'u2', top: 50.09 },
      ])
    ).toBe(true);
  });

  it('returns false when marker ids differ', () => {
    expect(areUserMsgMarkersEqual(markers, [{ id: 'u1', top: 10 }, { id: 'u3', top: 50 }])).toBe(
      false
    );
  });

  it('returns false when marker tops differ beyond rounding', () => {
    expect(areUserMsgMarkersEqual(markers, [{ id: 'u1', top: 10 }, { id: 'u2', top: 55 }])).toBe(
      false
    );
  });
});
