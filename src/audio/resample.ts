import type { Samples } from '../types.js';

/** Convert audio recorded at one sample rate to another (linear interpolation). */
export function resample(data: Samples, from: number, to: number) {
  if (from === to) return data;
  const n = Math.floor((data.length * to) / from),
    out = new Float32Array(n),
    r = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * r,
      j = Math.floor(x),
      f = x - j;
    out[i] = data[j] * (1 - f) + (data[j + 1] || 0) * f;
  }
  return out;
}
