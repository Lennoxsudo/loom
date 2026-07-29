/** Prefer formats Whisper-friendly frontends commonly produce. */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function isVoiceRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  );
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function floatTo16BitPcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function downsampleToMono(buffer: AudioBuffer, targetSampleRate: number): Float32Array {
  const channelCount = buffer.numberOfChannels;
  const length = buffer.length;
  const mono = new Float32Array(length);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / channelCount;
    }
  }

  if (buffer.sampleRate === targetSampleRate) {
    return mono;
  }

  const ratio = buffer.sampleRate / targetSampleRate;
  const newLength = Math.max(1, Math.round(mono.length / ratio));
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(mono.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += mono[j] ?? 0;
      count += 1;
    }
    result[i] = count > 0 ? sum / count : (mono[start] ?? 0);
  }
  return result;
}

/** Encode decoded audio as 16 kHz mono 16-bit PCM WAV (Whisper-friendly). */
export function encodeWavFromAudioBuffer(buffer: AudioBuffer, sampleRate = 16000): ArrayBuffer {
  const samples = downsampleToMono(buffer, sampleRate);
  const pcm = floatTo16BitPcm(samples);
  const dataLength = pcm.length * 2;
  const arrayBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i += 1) {
    view.setInt16(offset, pcm[i] ?? 0, true);
    offset += 2;
  }
  return arrayBuffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function mediaBlobToWavBase64(blob: Blob): Promise<string> {
  if (blob.size === 0) {
    throw new Error('empty-recording');
  }
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const wav = encodeWavFromAudioBuffer(decoded, 16000);
    return arrayBufferToBase64(wav);
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

export type VoiceRecorderSession = {
  stop: () => Promise<Blob>;
  cancel: () => void;
  /** Live mic levels in 0..1 for visualization. */
  sampleLevels: (barCount: number) => number[];
};

/** Fold analyser frequency bins into `barCount` normalized 0..1 levels. */
export function foldFrequencyLevels(
  frequencyData: ArrayLike<number>,
  barCount: number,
  options?: { gain?: number; noiseFloor?: number }
): number[] {
  const count = Math.max(1, Math.floor(barCount));
  const bins = frequencyData.length;
  if (bins === 0) return Array.from({ length: count }, () => 0);

  // Balanced noise floor (55): filters room silence while ensuring human speech is never suppressed
  // even when browser AEC attenuates signal during background speaker playback.
  const noiseFloor = options?.noiseFloor ?? 55;
  const gain = options?.gain ?? 1.35;
  const denom = Math.max(1, 255 - noiseFloor);

  const levels = new Array<number>(count);
  // Focus exclusively on human vocal formant frequencies (~375Hz - ~3375Hz).
  // This filters out sub-bass speaker thumps (<375Hz) and high-pitch computer audio trebles (>3375Hz).
  const binStart = 2;
  const binEnd = Math.min(bins, 18);
  const usable = binEnd - binStart;
  for (let i = 0; i < count; i += 1) {
    const start = binStart + Math.floor((i * usable) / count);
    const end = binStart + Math.floor(((i + 1) * usable) / count);
    let peak = 0;
    for (let j = start; j < end; j += 1) {
      const value = frequencyData[j] ?? 0;
      if (value > peak) peak = value;
    }
    const gated = Math.max(0, peak - noiseFloor) / denom;
    // Ambient noise below gate stays 0; speech climbs.
    if (gated < 0.05) {
      levels[i] = 0;
      continue;
    }
    const t = (gated - 0.05) / 0.95;
    levels[i] = Math.min(1, Math.pow(t * gain, 0.65));
  }
  return levels;
}

/** Append one amplitude sample; older samples shift left off the start. */
export function pushScrollingLevel(
  history: number[],
  next: number,
  length: number
): number[] {
  const size = Math.max(1, Math.floor(length));
  const value = Math.max(0, Math.min(1, next));
  if (history.length >= size) {
    const out = history.slice(history.length - size + 1);
    out.push(value);
    return out;
  }
  const out = history.slice();
  while (out.length < size - 1) out.push(0);
  out.push(value);
  return out;
}

/** Collapse multi-band levels into one 0..1 amplitude for the scrolling meter. */
export function aggregateVoiceLevel(levels: number[]): number {
  if (levels.length === 0) return 0;
  let peak = 0;
  for (const level of levels) {
    if (level > peak) peak = level;
  }
  // Gate room noise for a clean flat baseline during silence.
  if (peak < 0.08) return 0;
  const t = (peak - 0.08) / 0.92;
  return Math.min(1, Math.pow(t, 0.6));
}

/** Exponential blend for calmer left-scrolling envelopes. */
export function smoothVoiceLevel(previous: number, next: number, alpha = 0.4): number {
  const a = Math.max(0, Math.min(1, alpha));
  return previous * (1 - a) + Math.max(0, Math.min(1, next)) * a;
}

export async function startVoiceRecorder(): Promise<VoiceRecorderSession> {
  if (!isVoiceRecordingSupported()) {
    throw new Error('unsupported');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      // Enable Acoustic Echo Cancellation (AEC) to filter out computer speaker audio,
      // Noise Suppression (ANS) for background noise, and AGC for speech normalization.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const mimeType = pickRecorderMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];

  const audioContext = new AudioContext();
  if (audioContext.state === 'suspended') {
    await audioContext.resume().catch(() => undefined);
  }
  const audioTrack = stream.getAudioTracks()[0];
  const processedStream = audioTrack ? new MediaStream([audioTrack]) : stream;
  const source = audioContext.createMediaStreamSource(processedStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.55;
  source.connect(analyser);
  const frequencyBuffer = new Uint8Array(analyser.frequencyBinCount);

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const stopTracks = () => {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };

  const teardownAudio = () => {
    try {
      source.disconnect();
    } catch {
      // ignore
    }
    void audioContext.close().catch(() => undefined);
  };

  let stopPromise: Promise<Blob> | null = null;
  let closed = false;

  recorder.start(250);

  return {
    sampleLevels: (barCount) => {
      if (closed) return Array.from({ length: Math.max(1, barCount) }, () => 0);
      analyser.getByteFrequencyData(frequencyBuffer);
      return foldFrequencyLevels(frequencyBuffer, barCount);
    },
    stop: () => {
      if (stopPromise) return stopPromise;
      stopPromise = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => {
          closed = true;
          teardownAudio();
          stopTracks();
          reject(new Error('recorder-error'));
        };
        recorder.onstop = () => {
          closed = true;
          teardownAudio();
          stopTracks();
          const type = recorder.mimeType || mimeType || 'audio/webm';
          resolve(new Blob(chunks, { type }));
        };
        try {
          if (recorder.state === 'inactive') {
            closed = true;
            teardownAudio();
            stopTracks();
            resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
            return;
          }
          // Ensure the final chunk is flushed before stop (WebView2 can otherwise yield empty blobs).
          if (recorder.state === 'recording') {
            try {
              recorder.requestData();
            } catch {
              // ignore
            }
          }
          recorder.stop();
        } catch (error) {
          closed = true;
          teardownAudio();
          stopTracks();
          reject(error instanceof Error ? error : new Error('recorder-error'));
        }
      });
      return stopPromise;
    },
    cancel: () => {
      closed = true;
      try {
        if (recorder.state !== 'inactive') {
          recorder.ondataavailable = null;
          recorder.onstop = null;
          recorder.stop();
        }
      } catch {
        // ignore
      }
      teardownAudio();
      stopTracks();
    },
  };
}
