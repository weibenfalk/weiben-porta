import { armed, ensureCtx, routeInputs, setInputNode, setTrackData } from './audio/engine.js';

import { encodeMp3, renderMix } from './audio/mixdown.js';
import { rec } from './audio/recorder.js';
import { calibrate } from './audio/sync.js';
import { curPos, play, record, seek, stop } from './audio/transport.js';
import { rt } from './runtime.js';
import { S, tape } from './state.js';
import { diagText } from './ui/diagnostics.js';
import { paintLamps, paintSources, toggleArm } from './ui/mixerUI.js';
import { drawMap } from './ui/tapeMap.js';
import type { Samples } from './types.js';
import { chooseInput } from './audio/devices.js';
import { analyseCal } from './audio/analyse.js';
import { encodeWav } from './audio/wav.js';
/**
 * Hooks used by the external automated test (it drives the machine through `window.__fyr`).
 * Not used by the app itself. Keep the names.
 */
window.__fyr = {
  S,
  tape,
  analyseCal,
  chooseInput,
  diagText,
  encodeMp3,
  putTrack(i: number, d: Samples) {
    setTrackData(i, d);
  },
  monitorTap(n: AudioNode, i?: number) {
    rt.mon[i || 0].connect(n);
  },
  armed,
  toggleArm,
  get nIn() {
    return rt.nIn;
  },
  ensureCtx,
  calibrate,
  play,
  record,
  stop,
  seek,
  renderMix,
  encodeWav,
  drawMap,
  get ctx() {
    return rt.ctx;
  },
  get pos() {
    return curPos();
  },
  get transport() {
    return rt.transport;
  },
  get syncMs() {
    return rt.syncMs;
  },
  get recMode() {
    return rec.mode;
  },
  loopback(delay: number) {
    const d = rt.ctx.createDelay(1);
    d.delayTime.value = delay;
    rt.speakerBus.connect(d);
    setInputNode(d);
    rt.micOK = true;
    rt.micLabel = 'loop';
    rt.nIn = 2;
    paintLamps();
    paintSources();
    routeInputs();
  },
  tones(freqs: number[]) {
    const m = rt.ctx.createChannelMerger(freqs.length);
    freqs.forEach((f, k) => {
      const o = rt.ctx.createOscillator();
      o.frequency.value = f;
      const g = rt.ctx.createGain();
      g.gain.value = 0.3;
      o.connect(g);
      g.connect(m, 0, k);
      o.start();
    });
    setInputNode(m);
    rt.micOK = true;
    rt.micLabel = 'test tones';
    rt.nIn = freqs.length;
    paintLamps();
    paintSources();
    routeInputs();
  },
};
