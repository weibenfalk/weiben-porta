import { describe, expect, it } from 'vitest';
import { analyseCal } from '../src/audio/analyse.js';

const sr = 48000;
/** A recording of `n` clicks `gap` seconds apart, each arriving `delay` seconds late. */
function recording(n: number, gap: number, delay: number, amp = 0.5) {
  const raw = new Float32Array(Math.round((n * gap + 0.3) * sr));
  for (let k = 0; k < n; k++) {
    const at = Math.round((k * gap + delay) * sr);
    for (let i = 0; i < 200; i++)
      raw[at + i] = amp * Math.sin((2 * Math.PI * 3000 * i) / sr) * Math.exp(-i / 60);
  }
  return raw;
}

describe('analyseCal (sync measurement)', () => {
  it('finds the delay of five clicks', () => {
    const d = analyseCal(recording(5, 0.45, 0.023), sr, 5, 0.45);
    expect(d).not.toBeNull();
    expect(d!).toBeCloseTo(0.023, 3);
  });

  it('works with a quiet signal', () => {
    const d = analyseCal(recording(5, 0.45, 0.04, 0.01), sr, 5, 0.45);
    expect(d!).toBeCloseTo(0.04, 3);
  });

  it('returns null for silence', () => {
    expect(analyseCal(new Float32Array(sr * 3), sr, 5, 0.45)).toBeNull();
  });

  it('returns null when fewer than three clicks are heard', () => {
    expect(analyseCal(recording(2, 0.45, 0.02), sr, 5, 0.45)).toBeNull();
  });
});
