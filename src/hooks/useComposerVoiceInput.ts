import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useLocale } from '../i18n';
import { useVoiceInputLanguage } from '../stores';
import { insertComposerText } from '../utils/composerTextInsert';
import { notifyError } from '../utils/notification';
import {
  isVoiceRecordingSupported,
  mediaBlobToWavBase64,
  startVoiceRecorder,
  aggregateVoiceLevel,
  pushScrollingLevel,
  smoothVoiceLevel,
  type VoiceRecorderSession,
} from '../utils/voiceRecording';
import { resolveWhisperLanguage } from '../utils/whisperLanguage';

const VOICE_METER_BARS = 72;
const VOICE_METER_SAMPLE_MS = 60;

export type ComposerVoiceState = 'idle' | 'recording' | 'transcribing';

export interface ComposerVoiceLabels {
  start: string;
  stop: string;
  transcribing: string;
  unsupported: string;
  permissionDenied: string;
  emptyRecording: string;
  transcribeFailed: string;
  desktopOnly: string;
}

export interface UseComposerVoiceInputOptions {
  disabled?: boolean;
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  labels: ComposerVoiceLabels;
}

function mapVoiceError(error: unknown, labels: ComposerVoiceLabels): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : labels.transcribeFailed;
  const lower = raw.toLowerCase();
  if (raw === 'unsupported' || lower.includes('not supported')) {
    return labels.unsupported;
  }
  if (
    raw === 'permission-denied' ||
    lower.includes('permission') ||
    lower.includes('notallowed') ||
    lower.includes('denied')
  ) {
    return labels.permissionDenied;
  }
  if (
    raw === 'empty-recording' ||
    lower.includes('empty') ||
    raw.includes('未检测到语音') ||
    lower.includes('no speech')
  ) {
    return labels.emptyRecording;
  }
  if (lower.includes('sidecar') || lower.includes('whisper') || raw.includes('未找到')) {
    return raw || labels.transcribeFailed;
  }
  return raw || labels.transcribeFailed;
}

export function useComposerVoiceInput({
  disabled = false,
  inputValue,
  setInputValue,
  textareaRef,
  labels,
}: UseComposerVoiceInputOptions) {
  const locale = useLocale();
  const voiceInputLanguage = useVoiceInputLanguage();
  const [state, setState] = useState<ComposerVoiceState>('idle');
  const [levels, setLevels] = useState<number[]>(() =>
    Array.from({ length: VOICE_METER_BARS }, () => 0)
  );
  const sessionRef = useRef<VoiceRecorderSession | null>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const inputValueRef = useRef(inputValue);
  const labelsRef = useRef(labels);
  const localeRef = useRef(locale);
  const voiceInputLanguageRef = useRef(voiceInputLanguage);
  const levelsHistoryRef = useRef<number[]>(Array.from({ length: VOICE_METER_BARS }, () => 0));
  const smoothedLevelRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  useEffect(() => {
    voiceInputLanguageRef.current = voiceInputLanguage;
  }, [voiceInputLanguage]);

  useEffect(() => {
    inputValueRef.current = inputValue;
  }, [inputValue]);

  useEffect(() => {
    labelsRef.current = labels;
  }, [labels]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current?.cancel();
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (state !== 'recording') {
      levelsHistoryRef.current = Array.from({ length: VOICE_METER_BARS }, () => 0);
      smoothedLevelRef.current = 0;
      setLevels(levelsHistoryRef.current);
      return;
    }

    let frame = 0;
    let lastPush = 0;
    const tick = (now: number) => {
      const session = sessionRef.current;
      if (session && now - lastPush >= VOICE_METER_SAMPLE_MS) {
        lastPush = now;
        const raw = aggregateVoiceLevel(session.sampleLevels(8));
        // Rise fast / fall slower so speech peaks pop against a quiet baseline.
        const alpha = raw >= smoothedLevelRef.current ? 0.75 : 0.35;
        smoothedLevelRef.current = smoothVoiceLevel(smoothedLevelRef.current, raw, alpha);
        levelsHistoryRef.current = pushScrollingLevel(
          levelsHistoryRef.current,
          smoothedLevelRef.current,
          VOICE_METER_BARS
        );
        setLevels(levelsHistoryRef.current);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state]);

  const captureSelection = useCallback(() => {
    const el = textareaRef.current;
    const fallback = inputValueRef.current.length;
    selectionRef.current = {
      start: el?.selectionStart ?? fallback,
      end: el?.selectionEnd ?? fallback,
    };
  }, [textareaRef]);

  const applyTranscript = useCallback(
    (transcript: string) => {
      const { start, end } = selectionRef.current;
      const { nextValue, cursor } = insertComposerText(
        inputValueRef.current,
        transcript,
        start,
        end
      );
      setInputValue(nextValue);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(cursor, cursor);
      });
    },
    [setInputValue, textareaRef]
  );

  const stopAndTranscribe = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    captureSelection();
    setState('transcribing');
    try {
      const blob = await session.stop();
      const audioBase64 = await mediaBlobToWavBase64(blob);
      if (!isTauri()) {
        throw new Error(labelsRef.current.desktopOnly);
      }
      const transcript = await invoke<string>('transcribe_audio', {
        audioBase64,
        mimeType: 'audio/wav',
        language: resolveWhisperLanguage(voiceInputLanguageRef.current, localeRef.current),
      });
      if (!mountedRef.current) return;
      applyTranscript(transcript ?? '');
      setState('idle');
    } catch (error) {
      if (!mountedRef.current) return;
      setState('idle');
      notifyError(mapVoiceError(error, labelsRef.current), error);
    }
  }, [applyTranscript, captureSelection]);

  const startRecording = useCallback(async () => {
    if (disabled || state !== 'idle') return;
    if (!isVoiceRecordingSupported()) {
      notifyError(labelsRef.current.unsupported);
      return;
    }
    if (!isTauri()) {
      notifyError(labelsRef.current.desktopOnly);
      return;
    }
    captureSelection();
    try {
      const session = await startVoiceRecorder();
      sessionRef.current = session;
      if (!mountedRef.current) {
        session.cancel();
        return;
      }
      setState('recording');
    } catch (error) {
      notifyError(mapVoiceError(error, labelsRef.current), error);
      setState('idle');
    }
  }, [captureSelection, disabled, state]);

  const toggle = useCallback(() => {
    if (disabled) return;
    if (state === 'transcribing') return;
    if (state === 'recording') {
      void stopAndTranscribe();
      return;
    }
    void startRecording();
  }, [disabled, startRecording, state, stopAndTranscribe]);

  const title =
    state === 'recording'
      ? labels.stop
      : state === 'transcribing'
        ? labels.transcribing
        : labels.start;

  return {
    state,
    title,
    toggle,
    levels,
    isBusy: state !== 'idle',
    isRecording: state === 'recording',
    isTranscribing: state === 'transcribing',
  };
}
