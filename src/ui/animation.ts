import { trimOf } from '../audio/engine.js';
import { contentEnd, curPos, stop } from '../audio/transport.js';
import { TAPE } from '../config.js';
import { rt } from '../runtime.js';
import { S } from '../state.js';
import { $, clamp, reduceMotion } from '../util.js';
import { say } from './display.js';
import { needles } from './mixerUI.js';
import { drawMap, head, mapwrap } from './tapeMap.js';
/* ---------- animation: counter, reels, needles ---------- */
const digits = [...$('counter').querySelectorAll('span:not(.sep)')];
const reelL = $('reelL'),
  reelR = $('reelR'),
  packL = $('packL'),
  packR = $('packR');
const reelMarkup = (cx: number) => {
  let t = `<circle cx="${cx}" cy="114" r="24.500" fill="#0a0c0d"/><circle cx="${cx}" cy="114" r="24.500" fill="none" stroke="#7d7969" stroke-width="1.200"/>`;
  for (let k = 0; k < 6; k++)
    t += `<rect x="${cx - 3.5}" y="${114 - 25}" width="7" height="10.500" rx="1.500" fill="#f6f3e8" stroke="#8c8878" stroke-width=".6" transform="rotate(${k * 60} ${cx} 114)"/>`;
  for (let k = 0; k < 3; k++)
    t += `<rect x="${cx - 2}" y="${114 - 41}" width="4" height="12" rx="2" fill="#8f8b7a" transform="rotate(${k * 120 + 30} ${cx} 114)"/>`;
  return t;
};
reelL.innerHTML = reelMarkup(115.5);
reelR.innerHTML = reelMarkup(284.5);
let lastTs = 0,
  angL = 0,
  angR = 0,
  lastCount = -1,
  lastView = 60,
  peakHold = 0;
const needleAng = [-46, -46, -46, -46];
const anBuf = new Float32Array(1024);
/** [rms, peak] of what an analyser currently hears. */
function levelOf(an: AnalyserNode) {
  an.getFloatTimeDomainData(anBuf);
  let s = 0,
    p = 0;
  for (let i = 0; i < anBuf.length; i++) {
    const v = anBuf[i];
    s += v * v;
    const a = v < 0 ? -v : v;
    if (a > p) p = a;
  }
  return [Math.sqrt(s / anBuf.length), p];
}
const VU = [
  [-30, -46],
  [-20, -40],
  [-10, -22],
  [-7, -12],
  [-5, -4],
  [-3, 6],
  [0, 20],
  [3, 40],
  [5, 46],
];
/** Needle angle for an rms level, following the printed scale on the VU face. */
function vuAngle(rms: number) {
  if (rms < 1e-5) return -46;
  const db = clamp(20 * Math.log10(rms) + 14, -30, 5);
  for (let i = 1; i < VU.length; i++)
    if (db <= VU[i][0]) {
      const [d0, a0] = VU[i - 1],
        [d1, a1] = VU[i];
      return a0 + ((a1 - a0) * (db - d0)) / (d1 - d0);
    }
  return 46;
}
/** One animation frame: tape counter, reels, playhead, VU needles and the peak lamp. Runs every frame. */
export function frame(ts: number) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000 || 0);
  lastTs = ts;
  let p = rt.pos,
    speed = 0;
  if (rt.ctx && rt.transport !== 'stop') {
    p = curPos();
    speed = rt.ctx.currentTime >= rt.t0 ? 1 : 0;
    if (p >= TAPE) {
      stop().then(() => say('end of tape. press to start.'));
    } else if (rt.transport === 'play' && p > contentEnd() + 1.2) stop();
  } else if (rt.winding) {
    rt.pos = clamp(rt.pos + rt.winding * dt * 30, 0, TAPE);
    p = rt.pos;
    speed = rt.winding * 14;
  }
  const sec = Math.floor(p);
  if (sec !== lastCount) {
    lastCount = sec;
    const m = Math.floor(sec / 60),
      s = sec % 60;
    digits[0].textContent = String(Math.floor(m / 10));
    digits[1].textContent = String(m % 10);
    digits[2].textContent = String(Math.floor(s / 10));
    digits[3].textContent = String(s % 10);
  }
  const fr = p / TAPE,
    rL = Math.sqrt(2116 + (8464 - 2116) * (1 - fr)),
    rR = Math.sqrt(2116 + (8464 - 2116) * fr);
  packL.setAttribute('r', rL.toFixed(1));
  packR.setAttribute('r', rR.toFixed(1));
  if (speed && !reduceMotion) {
    angL -= (speed * dt * 12600) / rL;
    angR -= (speed * dt * 12600) / rR;
    reelL.setAttribute('transform', `rotate(${(angL % 360).toFixed(1)} 115.5 114)`);
    reelR.setAttribute('transform', `rotate(${(angR % 360).toFixed(1)} 284.5 114)`);
  }
  const need = clamp(Math.ceil((Math.max(contentEnd(), p) + 8) / 30) * 30, 60, TAPE);
  if (need !== lastView) {
    lastView = need;
    drawMap();
  }
  head.style.transform = `translateX(${(clamp(p / rt.viewLen, 0, 1) * (mapwrap.clientWidth - 2)).toFixed(1)}px)`;
  let inLv = null;
  if (rt.ctx && rt.micOK && rt.ctx.state === 'running') {
    inLv = [];
    for (let k = 0; k < rt.nIn; k++) {
      const l = levelOf(rt.rawAn[k]);
      inLv.push(l);
      rt.pkIn[k] = Math.max(l[1], rt.pkIn[k] * 0.995);
    }
  }
  for (let i = 0; i < 4; i++) {
    let target = -46;
    if (rt.ctx && rt.ctx.state === 'running') {
      const showInput =
        inLv && S.arm[i] && (rt.transport === 'stop' || (rt.transport === 'rec' && rt.recTracks.includes(i)));
      target = vuAngle(
        showInput ? (inLv![S.tracks[i].src] || [0])[0] * trimOf(i) : levelOf(rt.live.ch[i].an!)[0]
      );
    }
    needleAng[i] += (target - needleAng[i]) * Math.min(1, dt * 9);
    needles[i].setAttribute('transform', `rotate(${needleAng[i].toFixed(1)} 50 80)`);
  }
  if (inLv) {
    let pk = 0;
    for (let i = 0; i < 4; i++)
      if (S.arm[i]) pk = Math.max(pk, (inLv[S.tracks[i].src] || [0, 0])[1] * trimOf(i));
    if (pk > 0.9) peakHold = ts + 700;
    $('peakLamp').classList.toggle('lit', ts < peakHold);
  }
  requestAnimationFrame(frame);
}
