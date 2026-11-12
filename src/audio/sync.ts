import { MIX_DELAY } from '../config.js';
import { rt } from '../runtime.js';
import { S } from '../state.js';
import { say } from '../ui/display.js';
import { paintSync } from '../ui/mixerUI.js';
import { sleep } from '../util.js';
import { setMonitors } from './engine.js';

import { rec } from './recorder.js';
import { analyseCal } from './analyse.js';
import { nice } from './devices.js';
/** localStorage key for the measured delay of the current input device at the current sample rate. */
export const syncKey = () => 'weibenporta.sync.' + rt.micLabel + '.' + rt.ctx.sampleRate;
/** The browser's own idea of the round trip delay, in ms. Used until a measurement exists. */
export function browserEstimate() {
  let est = rt.ctx.outputLatency || rt.ctx.baseLatency || 0.02;
  try {
    const st = rt.stream && rt.stream.getAudioTracks()[0].getSettings();
    est += (st && (st as MediaTrackSettings & { latency?: number }).latency) || 0.01;
  } catch (e) {
    est += 0.01;
  }
  return Math.round(est * 1000);
}
let calBuf: AudioBuffer | null = null;
function calClickAt(t: number) {
  const sr = rt.ctx.sampleRate;
  if (!calBuf) {
    const n = Math.round(sr * 0.004);
    calBuf = rt.ctx.createBuffer(1, n, sr);
    const d = calBuf.getChannelData(0);
    for (let i = 0; i < n; i++)
      d[i] = 0.5 * Math.sin((2 * Math.PI * 3000 * i) / sr + Math.PI / 2) * Math.exp(-i / (sr * 0.0012));
  }
  const s = rt.ctx.createBufferSource();
  s.buffer = calBuf;
  s.connect(rt.speakerBus);
  s.start(t);
}
export async function calibrate() {
  if (rt.busy || rt.transport !== 'stop' || !rt.micOK) return null;
  rt.busy = true;
  say('measuring the delay. five clicks coming up.');
  const sr = rt.ctx.sampleRate,
    N = 5,
    gap = 0.45;
  rt.monMute = true;
  setMonitors();
  const f0 = Math.round((rt.ctx.currentTime + 0.3) * sr);
  rec.start(f0, [true, true, true, true]);
  for (let k = 0; k < N; k++) calClickAt(f0 / sr + k * gap);
  await sleep((0.3 + N * gap + 0.25) * 1000);
  const raws = await rec.stop();
  rt.monMute = false;
  setMonitors();
  rt.busy = false;
  let r = null; // listen on the armed tracks' inputs first, then the others
  for (const k of [0, 1, 2, 3].sort((a, b) => (S.arm[b] ? 1 : 0) - (S.arm[a] ? 1 : 0))) {
    r = analyseCal(raws[k], sr, N, gap);
    if (r != null) break;
  }
  if (r == null) {
    if (!rt.syncMeasured) rt.syncMs = browserEstimate();
    paintSync();
    say(
      `heard no clicks on ${nice(rt.micLabel)}. using ${rt.syncMs} ms for now. hold an earcup to the mic, or patch the sound card output to its input, then press sync.`
    );
    return null;
  }
  rt.syncMs = Math.round(r * 1000);
  rt.syncMeasured = true;
  paintSync();
  try {
    localStorage.setItem(syncKey(), String(rt.syncMs));
  } catch (e) {}
  say(
    rt.syncMs > 120
      ? `${nice(rt.micLabel)}: in sync, ${rt.syncMs} ms. a delay that long usually means bluetooth. takes still land in time, but keep monitor off.`
      : `${nice(rt.micLabel)}: in sync, ${rt.syncMs} ms. press record when you are ready.`
  );
  return rt.syncMs;
}
export const totalLatency = () => (rt.syncMs == null ? browserEstimate() : rt.syncMs) / 1000 + MIX_DELAY;
