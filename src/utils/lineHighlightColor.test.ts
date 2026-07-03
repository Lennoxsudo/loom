import { describe, expect, it, vi } from 'vitest';
import {
  applyCurrentLineHighlightColor,
  buildLineHighlightCss,
  normalizeHexColor,
  parseHexColor,
  previewCurrentLineHighlightColor,
  rgbToHex,
} from './lineHighlightColor';

describe('lineHighlightColor', () => {
  it('normalizeHexColor accepts #RRGGBB and RRGGBB', () => {
    expect(normalizeHexColor('#007ACC')).toBe('#007acc');
    expect(normalizeHexColor('007acc')).toBe('#007acc');
    expect(normalizeHexColor('#fff')).toBeNull();
    expect(normalizeHexColor('blue')).toBeNull();
  });

  it('parseHexColor and rgbToHex round-trip', () => {
    const rgb = parseHexColor('#ff8040');
    expect(rgb).toEqual({ r: 255, g: 128, b: 64 });
    expect(rgbToHex({ r: 255, g: 128, b: 64 })).toBe('#ff8040');
  });

  it('buildLineHighlightCss uses fixed alpha per theme', () => {
    const dark = buildLineHighlightCss('#007acc', true);
    expect(dark).toEqual({
      bg: 'rgba(0, 122, 204, 0.08)',
      border: 'rgba(0, 122, 204, 0.2)',
    });

    const light = buildLineHighlightCss('#007acc', false);
    expect(light).toEqual({
      bg: 'rgba(0, 122, 204, 0.08)',
      border: 'rgba(0, 122, 204, 0.18)',
    });
  });

  it('applyCurrentLineHighlightColor sets and clears CSS variables', () => {
    applyCurrentLineHighlightColor('#ff0000', 'dark');
    expect(document.documentElement.style.getPropertyValue('--editor-line-highlight').trim()).toBe(
      'rgba(255, 0, 0, 0.08)'
    );
    expect(document.documentElement.style.getPropertyValue('--editor-line-highlight-border').trim()).toBe(
      'rgba(255, 0, 0, 0.2)'
    );

    applyCurrentLineHighlightColor(null, 'dark');
    expect(document.documentElement.style.getPropertyValue('--editor-line-highlight')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--editor-line-highlight-border')).toBe('');
  });

  it('previewCurrentLineHighlightColor coalesces updates to one frame', () => {
    const callbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      callbacks.push(cb);
      return callbacks.length;
    });

    previewCurrentLineHighlightColor('#111111', 'dark');
    previewCurrentLineHighlightColor('#222222', 'dark');
    previewCurrentLineHighlightColor('#333333', 'dark');

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(1);
    callbacks[0](0);
    expect(document.documentElement.style.getPropertyValue('--editor-line-highlight').trim()).toBe(
      'rgba(51, 51, 51, 0.08)'
    );

    rafSpy.mockRestore();
  });
});
