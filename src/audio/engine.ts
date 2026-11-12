import { rt } from '../runtime.js';
import { S, tape } from '../state.js';
import { say } from '../ui/display.js';
import { paintLamps, paintSwitches } from '../ui/mixerUI.js';
import { $, dbToGain } from '../util.js';
import { applyMix, buildMixer, makeIR } from './graph.js';
import { rec } from './recorder.js';
import { stop } from './transport.js';
import type { Samples } from '../types.js';
import { resample } from './resample.js';
/* The audio engine: creates the audio context and the graph around the mixer, and routes the
   sound card inputs to the four tracks. */

/**
 * Put recorded audio on a track, as both samples and an AudioBuffer for playback.
 *
 * `data` is kept as our own array and only *copied* into the AudioBuffer. Do not keep the array from
 * `buf.getChannelData()` instead: when a buffer is given to a source node, the Web Audio spec says the
 * arrays handed out earlier are detached, and Firefox does that. The tape would turn empty after the
 * first playback (playback stopped after a second, and "the tape is empty").
 */
export function setTrackData(i: number, data: Samples | null) {
  if (!data || !data.length) {
    tape[i] = null;
    return;
  }
  const sr = rt.ctx.sampleRate,
    buf = rt.ctx.createBuffer(1, data.length, sr);
  buf.copyToChannel(data, 0);
  tape[i] = { data, sr, buf };
}
/** Switch the audio on (once): builds the context, the mixer and the recorder. Resolves when the recorder is ready. */
export function ensureCtx() {
  if (rt.ctx) {
    if (rt.ctx.state !== 'running') rt.ctx.resume();
    document.body.classList.add('on');
    $('power').setAttribute('aria-pressed', 'true');
    return rt.ctxReady;
  }
  const AC = window.AudioContext || window.webkitAudioContext!;
  const saved = tape.find(t => t);
  try {
    rt.ctx = new AC(
      saved ? { sampleRate: saved.sr, latencyHint: 'interactive' } : { latencyHint: 'interactive' }
    );
  } catch (e) {
    rt.ctx = new AC();
  }
  if (rt.ctx.sampleRate > 48000) {
    // a sound card set to 96 or 192 kHz would only waste processor time here
    try {
      const c2 = new AC({ sampleRate: 48000, latencyHint: 'interactive' });
      rt.ctx.close();
      rt.ctx = c2;
    } catch (e) {}
  }
  rt.ctx.resume();
  rt.speakerBus = rt.ctx.createGain();
  rt.speakerBus.connect(rt.ctx.destination);
  rt.clickBus = rt.ctx.createGain();
  rt.clickBus.gain.value = 0.5;
  rt.clickBus.connect(rt.speakerBus);
  rt.live = buildMixer(rt.ctx, rt.speakerBus);
  applyMix(rt.live, rt.ctx, true);
  rt.live.rev.buffer = makeIR(rt.ctx, S.revLen);
  rt.live.ch.forEach(c => {
    c.an = rt.ctx.createAnalyser();
    c.an.fftSize = 1024;
    c.input.connect(c.an);
  });
  rt.splitIn = rt.ctx.createChannelSplitter(4);
  rt.recMerge = rt.ctx.createChannelMerger(4);
  for (let k = 0; k < 4; k++) {
    const a = rt.ctx.createAnalyser();
    a.fftSize = 1024;
    rt.splitIn.connect(a, k);
    rt.rawAn.push(a);
    const g = rt.ctx.createGain();
    g.channelCount = 1;
    g.channelCountMode = 'explicit';
    g.gain.value = dbToGain(S.tracks[k].trim);
    g.connect(rt.recMerge, 0, k);
    rt.trackIn.push(g);
    const m = rt.ctx.createGain();
    m.gain.value = 0;
    g.connect(m);
    m.connect(rt.live.ch[k].input);
    rt.mon.push(m);
  }
  routeInputs();
  tape.forEach((t, i) => {
    if (t) setTrackData(i, resample(t.data, t.sr, rt.ctx.sampleRate));
  });
  document.body.classList.add('on');
  $('power').setAttribute('aria-pressed', 'true');
  rt.ctxReady = rec.init().then(() => {
    rt.recMerge.connect(rec.node!);
  });
  return rt.ctxReady;
}
/** Use `node` (a microphone stream, or a test signal) as the source for the four inputs. */
export function setInputNode(node: AudioNode) {
  if (rt.inputSrc) {
    try {
      rt.inputSrc.disconnect(rt.splitIn);
    } catch (e) {}
  }
  rt.inputSrc = node;
  node.connect(rt.splitIn);
}
/** Connect each track's input to the sound card input it has chosen. */
export function routeInputs() {
  if (!rt.ctx) return;
  S.tracks.forEach((tr, i) => {
    if (!(tr.src < rt.nIn)) tr.src = 0;
    try {
      rt.splitIn.disconnect(rt.trackIn[i]);
    } catch (e) {}
    rt.splitIn.connect(rt.trackIn[i], tr.src);
  });
  setMonitors();
}
/** Monitoring: armed tracks are heard live while the monitor switch is on. */
export function setMonitors() {
  if (!rt.ctx) return;
  rt.mon.forEach((m, i) =>
    m.gain.setTargetAtTime(
      S.monitor && S.arm[i] && rt.micOK && !rt.monMute ? 1 : 0,
      rt.ctx.currentTime,
      0.015
    )
  );
}
/** Apply each track's trim (input gain). It acts before recording. */
export function setTrim() {
  if (!rt.ctx) return;
  rt.trackIn.forEach((n, i) => n.gain.setTargetAtTime(dbToGain(S.tracks[i].trim), rt.ctx.currentTime, 0.02));
}
export const trimOf = (i: number) => dbToGain(S.tracks[i].trim);
export const armed = () => [0, 1, 2, 3].filter(i => S.arm[i]);
/** "track 2" or "tracks 1, 2 and 3", for messages. */
export const names = (list: number[]) =>
  list.length === 1
    ? `track ${list[0] + 1}`
    : 'tracks ' +
      list
        .slice(0, -1)
        .map(i => i + 1)
        .join(', ') +
      ' and ' +
      (list[list.length - 1] + 1);
export async function powerOff() {
  await stop();
  if (rt.stream) {
    rt.stream.getTracks().forEach(t => {
      t.onended = null;
      t.stop();
    });
    rt.stream = null;
  }
  if (rt.inputSrc) {
    try {
      rt.inputSrc.disconnect();
    } catch (e) {}
    rt.inputSrc = null;
  }
  rt.micOK = false;
  S.monitor = false;
  setMonitors();
  paintSwitches();
  paintLamps();
  if (rt.ctx) rt.ctx.suspend();
  document.body.classList.remove('on');
  $('power').setAttribute('aria-pressed', 'false');
  say('switched off. the tape stays in.');
}
