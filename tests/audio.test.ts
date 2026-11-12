import { describe, expect, it } from 'vitest';
import { resample } from '../src/audio/resample.js';
import { encodeWav } from '../src/audio/wav.js';

describe('resample', () => {
  it('returns the same samples at the same rate', () => {
    const d = new Float32Array([0, 1, 2]);
    expect(resample(d, 48000, 48000)).toBe(d);
  });

  it('changes the length by the rate ratio and interpolates', () => {
    const d = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const out = resample(d, 8000, 16000);
    expect(out).toHaveLength(16);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(0.5);
    expect(out[4]).toBeCloseTo(2);
  });
});

describe('encodeWav', () => {
  const buf = (ch: Float32Array[], sampleRate = 44100) =>
    ({
      length: ch[0].length,
      numberOfChannels: ch.length,
      sampleRate,
      getChannelData: (c: number) => ch[c],
    }) as AudioBuffer;

  it('writes a 16-bit pcm header and clips to full scale', async () => {
    const blob = encodeWav(buf([new Float32Array([0, 0.5, -1, 2]), new Float32Array([0, 0, 0, -2])]));
    const v = new DataView(await blob.arrayBuffer());
    const tag = (o: number) =>
      String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    expect(blob.size).toBe(44 + 4 * 2 * 2);
    expect([tag(0), tag(8), tag(36)]).toEqual(['RIFF', 'WAVE', 'data']);
    expect(v.getUint16(22, true)).toBe(2); // channels
    expect(v.getUint32(24, true)).toBe(44100); // sample rate
    expect(v.getInt16(44 + 2 * 2, true)).toBe(16383); // 0.5 on the left
    expect(v.getInt16(44 + 4 * 2, true)).toBe(-32768); // -1 on the left
    expect(v.getInt16(44 + 6 * 2, true)).toBe(32767); // 2 is clipped
    expect(v.getInt16(44 + 6 * 2 + 2, true)).toBe(-32768); // -2 is clipped
  });
});
