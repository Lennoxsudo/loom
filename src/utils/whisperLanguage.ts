import type { VoiceInputLanguage } from '../types/settings';

/** Map app locale to whisper.cpp `-l` language code. */
export function whisperLanguageFromLocale(locale: string | null | undefined): string {
  const raw = locale?.trim().toLowerCase() ?? '';
  if (!raw) return 'auto';
  if (raw.startsWith('zh')) return 'zh';
  if (raw.startsWith('en')) return 'en';
  const base = raw.split(/[-_]/)[0];
  return base || 'auto';
}

/** Resolve STT language from independent setting, falling back to UI locale when `auto`. */
export function resolveWhisperLanguage(
  voiceInputLanguage: VoiceInputLanguage | null | undefined,
  locale: string | null | undefined
): string {
  if (voiceInputLanguage === 'zh' || voiceInputLanguage === 'en') {
    return voiceInputLanguage;
  }
  return whisperLanguageFromLocale(locale);
}
