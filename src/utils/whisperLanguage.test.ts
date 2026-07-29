import { describe, expect, test } from 'vitest';
import { resolveWhisperLanguage, whisperLanguageFromLocale } from './whisperLanguage';

describe('whisperLanguageFromLocale', () => {
  test('maps app locales to whisper codes', () => {
    expect(whisperLanguageFromLocale(undefined)).toBe('auto');
    expect(whisperLanguageFromLocale('')).toBe('auto');
    expect(whisperLanguageFromLocale('zh-CN')).toBe('zh');
    expect(whisperLanguageFromLocale('zh')).toBe('zh');
    expect(whisperLanguageFromLocale('en-US')).toBe('en');
    expect(whisperLanguageFromLocale('ja-JP')).toBe('ja');
  });
});

describe('resolveWhisperLanguage', () => {
  test('uses explicit voice setting over locale', () => {
    expect(resolveWhisperLanguage('zh', 'en-US')).toBe('zh');
    expect(resolveWhisperLanguage('en', 'zh-CN')).toBe('en');
  });

  test('auto follows UI locale', () => {
    expect(resolveWhisperLanguage('auto', 'zh-CN')).toBe('zh');
    expect(resolveWhisperLanguage('auto', 'en-US')).toBe('en');
    expect(resolveWhisperLanguage(undefined, 'zh-CN')).toBe('zh');
  });
});
