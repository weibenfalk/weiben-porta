/* Sync: play five clicks through the speakers and measure how late they arrive from the microphone. */

/**
 * Find the delay of the clicks in a recording. `N` clicks were played `gap` seconds apart; returns the
 * delay in seconds, or null if the clicks could not be heard clearly.
 */
export function analyseCal(raw: Float32Array, sr: number, N: number, gap: number) {
  const W = Math.round(gap * sr),
    F = Math.max(8, Math.round(sr * 0.005)),
    e: number[] = [];
  for (let i = 0; i + F <= raw.length; i += F) {
    let s = 0;
    for (let j = 0; j < F; j++) s += raw[i + j] * raw[i + j];
    e.push(Math.sqrt(s / F));
  }
  e.sort((a, b) => a - b);
  const floor = e[Math.floor(e.length * 0.3)] || 0,
    hits: number[] = [];
  for (let k = 0; k < N; k++) {
    const a = k * W,
      b = Math.min(raw.length, a + W);
    let p = 0;
    for (let i = a; i < b; i++) {
      const v = Math.abs(raw[i]);
      if (v > p) p = v;
    }
    if (p < Math.max(2e-4, floor * 8)) continue;
    const th = p * 0.35;
    for (let i = a; i < b; i++)
      if (Math.abs(raw[i]) >= th) {
        hits.push((i - a) / sr);
        break;
      }
  }
  if (hits.length < 3) return null;
  hits.sort((a, b) => a - b);
  const med = hits[hits.length >> 1],
    close = hits.filter(x => Math.abs(x - med) < 0.004);
  if (close.length < 3) return null;
  return close.reduce((a, b) => a + b, 0) / close.length;
}
