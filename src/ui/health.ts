import { rt } from '../runtime.js';
/* Counters for the diagnostics box, to tell "the screen stalls" from "the sound stalls" when someone reports crackling.
   Both are cheap: one comparison per frame, and one per second for the audio clock. */
export const health = {
  frames: 0,
  /** frames that took longer than 50 ms to arrive */
  slow: 0,
  worstMs: 0,
  /** milliseconds the audio clock fell behind the wall clock, counted when it was more than 40 ms in one second */
  audioLostMs: 0,
  audioSecs: 0,
};
let wall0 = 0,
  audio0 = -1;
/** Called every animation frame with the time since the previous frame. */
export function sampleHealth(now: number, gapMs: number) {
  if (gapMs > 0 && gapMs < 1000) {
    health.frames++;
    if (gapMs > 50) health.slow++;
    if (gapMs > health.worstMs) health.worstMs = Math.round(gapMs);
  }
  if (!rt.ctx || rt.ctx.state !== 'running') {
    audio0 = -1;
    return;
  }
  if (audio0 < 0) {
    wall0 = now;
    audio0 = rt.ctx.currentTime;
  } else if (now - wall0 >= 1000) {
    const lost = now - wall0 - (rt.ctx.currentTime - audio0) * 1000;
    if (now - wall0 < 2000) {
      health.audioSecs++;
      if (lost > 40) health.audioLostMs += Math.round(lost);
    }
    wall0 = now;
    audio0 = rt.ctx.currentTime;
  }
}
