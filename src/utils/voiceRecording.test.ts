import { describe, expect, it } from 'vitest';
import {
  aggregateVoiceLevel,
  encodeWavFromAudioBuffer,
  foldFrequencyLevels,
  pushScrollingLevel,
  smoothVoiceLevel,
} from './voiceRecording';

class FakeAudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  private channels: Float32Array[];

  constructor(channels: Float32Array[], sampleRate: number) {
    this.channels = channels;
    this.numberOfChannels = channels.length;
    this.length = channels[0]?.length ?? 0;
    this.sampleRate = sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel] ?? new Float32Array(this.length);
  }
}

describe('encodeWavFromAudioBuffer', () => {
  it('writes a valid mono 16 kHz wav header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buffer = new FakeAudioBuffer([samples], 16000) as unknown as AudioBuffer;
    const wav = encodeWavFromAudioBuffer(buffer, 16000);
    const view = new DataView(wav);
    const header = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    const format = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    );
    expect(header).toBe('RIFF');
    expect(format).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(wav.byteLength).toBe(44 + samples.length * 2);
  });
});

describe('foldFrequencyLevels', () => {
  it('maps louder bins to taller levels', () => {
    const quiet = foldFrequencyLevels(new Array(64).fill(10), 8);
    const loud = foldFrequencyLevels(new Array(64).fill(220), 8);
    expect(quiet).toHaveLength(8);
    expect(loud).toHaveLength(8);
    expect(loud[0]!).toBeGreaterThan(quiet[0]!);
    expect(loud.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('keeps ambient noise near zero instead of filling the meter', () => {
    const ambient = foldFrequencyLevels(new Array(64).fill(50), 8);
    expect(Math.max(...ambient)).toBe(0);

    const speech = foldFrequencyLevels(new Array(64).fill(210), 8);
    expect(Math.min(...speech)).toBeGreaterThan(0.5);
  });
});

describe('pushScrollingLevel', () => {
  it('shifts older samples left and appends the newest on the right', () => {
    const first = pushScrollingLevel([0.1, 0.2, 0.3], 0.9, 3);
    expect(first).toEqual([0.2, 0.3, 0.9]);

    const growing = pushScrollingLevel([], 0.5, 4);
    expect(growing).toEqual([0, 0, 0, 0.5]);
  });
});

describe('aggregateVoiceLevel', () => {
  it('gates hiss and stretches speech toward full height', () => {
    expect(aggregateVoiceLevel([0.03, 0.05])).toBe(0);
    expect(aggregateVoiceLevel([0.1, 0.7, 0.2])).toBeGreaterThan(0.6);
    expect(aggregateVoiceLevel([0.1, 0.95, 0.2])).toBeGreaterThan(0.9);
    expect(aggregateVoiceLevel([])).toBe(0);
  });
});

describe('smoothVoiceLevel', () => {
  it('blends toward the next sample', () => {
    expect(smoothVoiceLevel(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothVoiceLevel(0.2, 0.8, 0.38)).toBeCloseTo(0.2 * 0.62 + 0.8 * 0.38);
  });
});
