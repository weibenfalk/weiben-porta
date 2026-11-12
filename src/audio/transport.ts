import { TAPE } from '../config.js';
import { rt } from '../runtime.js';
import { S, saveTrack, tape } from '../state.js';
import { say } from '../ui/display.js';
import { paintTransport } from '../ui/mixerUI.js';
import { drawMap } from '../ui/tapeMap.js';
import { $, clamp } from '../util.js';
import { armed, ensureCtx, names, setTrackData, trimOf } from './engine.js';
import { openMic } from './inputs.js';
import { rec } from './recorder.js';
import { totalLatency } from './sync.js';
import type { Samples, TakeInfo, UndoEntry } from '../types.js';
/* The tape transport: play, record (with punch-in), stop, seek, undo, and the metronome. */

/** Seconds of tape that have something on them. */
export const contentEnd = () => tape.reduce((m, t) => (t ? Math.max(m, t.data.length / t.sr) : m), 0);
/** Where the tape is now, in seconds. */
export const curPos = () =>
  rt.transport === 'stop' ? rt.pos : Math.min(TAPE, rt.pos0 + Math.max(0, rt.ctx.currentTime - rt.t0));

/** One metronome click at audio time `t`. */
function clickAt(t: number, accent: boolean) {
  const o = rt.ctx.createOscillator(),
    g = rt.ctx.createGain();
  o.frequency.value = accent ? 1600 : 1100;
  g.gain.setValueAtTime(accent ? 1 : 0.7, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  o.connect(g);
  g.connect(rt.clickBus);
  o.start(t);
  o.stop(t + 0.05);
}
/** Schedule the metronome from the current tape position, with four count-in beats before recording. */
function startClicks(countIn: boolean) {
  stopClicks();
  if (!S.click) return;
  rt.nextK = Math.ceil((rt.pos0 - (countIn ? 4 * rt.beatLen : 0)) / rt.beatLen - 1e-6);
  const tick = () => {
    const horizon = rt.ctx.currentTime + 0.2;
    for (;;) {
      const t = rt.t0 + (rt.nextK * rt.beatLen - rt.pos0);
      if (t > horizon) break;
      if (t >= rt.ctx.currentTime - 0.005)
        clickAt(Math.max(t, rt.ctx.currentTime), ((rt.nextK % 4) + 4) % 4 === 0);
      rt.nextK++;
    }
  };
  tick();
  rt.clickTimer = window.setInterval(tick, 50);
}
function stopClicks() {
  clearInterval(rt.clickTimer);
  rt.clickTimer = 0;
}

/** Start the tape rolling at `rt.pos`. Returns true if a count-in is played first. */
function startRun(recording: boolean) {
  const sr = rt.ctx.sampleRate;
  rt.beatLen = 60 / clamp(S.bpm || 100, 40, 240);
  const countIn = recording && S.click ? 4 * rt.beatLen : 0;
  rt.pos0 = rt.pos;
  rt.t0 = Math.round((rt.ctx.currentTime + 0.12 + countIn) * sr) / sr;
  tape.forEach((t, i) => {
    rt.srcs[i] = null;
    if (!t || !t.buf || (recording && S.arm[i]) || rt.pos0 >= t.buf.duration) return;
    const s = rt.ctx.createBufferSource();
    s.buffer = t.buf;
    s.connect(rt.live.ch[i].input);
    s.start(rt.t0, rt.pos0);
    rt.srcs[i] = s;
  });
  if (recording) {
    rt.recTracks = armed();
    rt.recPos0 = rt.pos0;
    rec.start(Math.round(rt.t0 * sr), S.arm.slice());
  }
  startClicks(countIn > 0);
  rt.transport = recording ? 'rec' : 'play';
  paintTransport();
  return countIn > 0;
}
export async function play() {
  if (rt.busy || rt.transport !== 'stop') return;
  const end = contentEnd();
  if (!end) {
    say('the tape is empty. press record.');
    return;
  }
  await ensureCtx();
  if (rt.pos >= end - 0.05) rt.pos = 0;
  startRun(false);
  say('playing.', { quiet: true });
}
export async function record() {
  if (rt.busy || rt.transport === 'rec') return;
  if (!rt.micOK) {
    if (await openMic()) {
      /* the dial already says what to do next */
    }
    return;
  }
  if (!armed().length) {
    say('no track is switched on for recording. press 1, 2, 3 or 4 first.');
    return;
  }
  if (rt.transport === 'play') {
    // punch in while the tape rolls
    const sr = rt.ctx.sampleRate,
      f = Math.round((rt.ctx.currentTime + 0.03) * sr),
      tp = f / sr;
    rt.recTracks = armed();
    rt.recPos0 = rt.pos0 + (tp - rt.t0);
    rt.recTracks.forEach(i => {
      if (rt.srcs[i]) {
        try {
          rt.srcs[i].stop(tp);
        } catch (e) {}
      }
    });
    rec.start(f, S.arm.slice());
    rt.transport = 'rec';
    paintTransport();
    say(`recording on ${names(rt.recTracks)}.`, { quiet: true });
    return;
  }
  if (rt.pos >= TAPE - 0.5) {
    say('end of tape. press to start.');
    return;
  }
  const counted = startRun(true);
  say(
    counted
      ? `four clicks, then you are recording on ${names(rt.recTracks)}.`
      : `recording on ${names(rt.recTracks)}.`,
    { quiet: true }
  );
}
/** Stop the tape. If it was recording, the take is processed and put on the tape. */
export async function stop() {
  if (rt.transport === 'stop') return;
  const was = rt.transport;
  rt.pos = curPos();
  rt.srcs.forEach(s => {
    if (s) {
      try {
        s.stop();
      } catch (e) {}
    }
  });
  rt.srcs = [null, null, null, null];
  stopClicks();
  rt.transport = 'stop';
  paintTransport();
  if (was === 'rec') {
    rt.busy = true;
    try {
      await finishRecording();
    } finally {
      rt.busy = false;
    }
  } else say('stopped.', { quiet: true });
}
/** Cut the recorded audio onto the tape, compensating for the measured delay, and report what happened. */
async function finishRecording() {
  const raws = await rec.stop(),
    sr = rt.ctx.sampleRate,
    L = Math.round(totalLatency() * sr);
  const stt = rec.stats,
    done: number[] = [],
    silent: number[] = [],
    undoList: UndoEntry[] = [],
    info: TakeInfo[] = [];
  let clipped = false,
    hot = false,
    short = false;
  for (const i of rt.recTracks) {
    const raw = raws[i] || new Float32Array(0),
      take = raw.subarray(Math.min(L, raw.length));
    if (take.length < sr * 0.1) {
      short = true;
      continue;
    }
    const start = Math.round(rt.recPos0 * sr),
      n = Math.min(take.length, TAPE * sr - start);
    let peak = 0,
      clipN = 0;
    for (let k = 0; k < n; k++) {
      const a = Math.abs(take[k]);
      if (a > peak) peak = a;
      if (a / trimOf(i) >= 0.985) clipN++;
    }
    info.push({ track: i, src: S.tracks[i].src, sec: n / sr, peak, clipN });
    if (peak < 0.0005) {
      silent.push(i);
      continue;
    }
    const old = tape[i],
      data = new Float32Array(Math.max(old ? old.data.length : 0, start + n));
    if (old) data.set(old.data);
    const fade = Math.min(Math.round(sr * 0.004), n >> 1);
    for (let k = 0; k < n; k++) {
      let g = 1;
      if (k < fade) g = k / fade;
      else if (k > n - fade) g = (n - k) / fade;
      data[start + k] = take[k] * g;
    }
    undoList.push({ track: i, prev: old });
    setTrackData(i, data);
    saveTrack(i);
    done.push(i);
    if (clipN > 20) clipped = true;
    else if (peak > 1) hot = true;
  }
  if (info.length)
    rt.lastTake = {
      tracks: info,
      drops: stt ? stt.d : null,
      zero: stt ? stt.z : null,
      blocks: stt ? stt.b : null,
    };
  if (undoList.length) {
    rt.undo = undoList;
    $<HTMLButtonElement>('undo').disabled = false;
  }
  drawMap();
  if (!done.length && !silent.length) {
    say(short ? 'that take was too short. press record and try again.' : 'nothing was recorded.');
    return;
  }
  const loud = rt.pkIn.findIndex((pk, k) => k < rt.nIn && pk > 0.01);
  const tip =
    silent.length && loud >= 0 && silent.some(i => S.tracks[i].src !== loud)
      ? ` there is sound on in ${loud + 1}: choose in ${loud + 1} under the track number.`
      : ' check the input chosen under the track number, and the gain on the sound card.';
  if (!done.length) {
    say(`nothing reached ${names(silent)}: the input was silent.${tip}`);
    return;
  }
  let msg = `${names(done)} recorded.`;
  if (silent.length) msg += ` ${names(silent)} heard nothing.${tip}`;
  if (clipped)
    msg +=
      ' the signal was already clipping when it arrived: turn down the input gain on the sound card or in the system sound settings.';
  else if (hot) msg += ' it was recorded too hot: turn the trim knob down and record again.';
  else if ((rt.lastTake?.drops ?? 0) > 2)
    msg += ` the sound dropped out ${rt.lastTake!.drops} times: close other audio programs, then open settings and copy the diagnostics.`;
  else if (!silent.length) msg += ' press to start and listen, or switch on the next track.';
  say(msg);
}
/** Move the tape to `p` seconds. */
export function seek(p: number) {
  p = clamp(p, 0, TAPE);
  if (rt.transport === 'rec' || rt.busy) return;
  if (rt.transport === 'play') {
    rt.srcs.forEach(s => {
      if (s) {
        try {
          s.stop();
        } catch (e) {}
      }
    });
    stopClicks();
    rt.transport = 'stop';
    rt.pos = p;
    startRun(false);
  } else rt.pos = p;
}
export function undoTake() {
  if (!rt.undo || rt.transport !== 'stop' || rt.busy) return;
  rt.undo.forEach(u => {
    tape[u.track] = u.prev;
    saveTrack(u.track);
  });
  say(`the last take on ${names(rt.undo.map(u => u.track))} is removed.`, { quiet: true });
  rt.undo = null;
  $<HTMLButtonElement>('undo').disabled = true;
  drawMap();
}
/** Move the armed tracks `ms` milliseconds later (positive) or earlier. */
export function nudge(ms: number) {
  const list = armed().filter(i => tape[i]);
  if (!list.length || rt.transport !== 'stop' || rt.busy || !rt.ctx) {
    say('switch on a track that has a recording, and stop the tape first.');
    return;
  }
  list.forEach(i => {
    const t = tape[i]!,
      n = Math.round((Math.abs(ms) / 1000) * t.sr);
    let d: Samples;
    if (ms > 0) {
      d = new Float32Array(t.data.length + n);
      d.set(t.data, n);
    } else d = t.data.slice(n);
    setTrackData(i, d);
    saveTrack(i);
  });
  drawMap();
  say(`${names(list)} moved ${Math.abs(ms)} ms ${ms > 0 ? 'later' : 'earlier'}.`, { quiet: true });
}
