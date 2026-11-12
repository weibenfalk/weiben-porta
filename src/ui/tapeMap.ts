import { contentEnd, seek } from '../audio/transport.js';
import { COLORS, TAPE } from '../config.js';
import { rt } from '../runtime.js';
import { tape } from '../state.js';
import { $, clamp } from '../util.js';
/* The overview of the tape: a waveform lane per track, and a playhead you can drag. */
export const map = $<HTMLCanvasElement>('map'),
  mapwrap = $('mapwrap'),
  head = $('head');
/** Redraw the waveforms. Also sets how many seconds of tape are in view. */
export function drawMap() {
  const w = mapwrap.clientWidth,
    hgt = mapwrap.clientHeight,
    dpr = window.devicePixelRatio || 1;
  if (!w) return;
  map.width = Math.round(w * dpr);
  map.height = Math.round(hgt * dpr);
  const g = map.getContext('2d')!;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, hgt);
  rt.viewLen = clamp(Math.ceil((Math.max(contentEnd(), rt.pos) + 8) / 30) * 30, 60, TAPE);
  const lane = hgt / 4;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(255,255,255,.05)';
    g.fillRect(0, i * lane + lane / 2 - 0.5, w, 1);
    const t = tape[i];
    if (!t) continue;
    g.fillStyle = COLORS[i];
    const per = (rt.viewLen * t.sr) / w,
      stride = Math.max(1, Math.floor(per / 48));
    for (let x = 0; x < w; x++) {
      const a = Math.floor(x * per),
        b = Math.min(t.data.length, Math.floor((x + 1) * per));
      if (a >= t.data.length) break;
      let p = 0;
      for (let k = a; k < b; k += stride) {
        const v = Math.abs(t.data[k]);
        if (v > p) p = v;
      }
      const y = Math.max(1, Math.min(1, Math.sqrt(p)) * (lane - 2));
      g.fillRect(x, i * lane + (lane - y) / 2, 1, y);
    }
  }
}
mapwrap.addEventListener('pointerdown', e => {
  const r = mapwrap.getBoundingClientRect();
  seek(((e.clientX - r.left) / r.width) * rt.viewLen);
  mapwrap.setPointerCapture(e.pointerId);
});
mapwrap.addEventListener('pointermove', e => {
  if (!mapwrap.hasPointerCapture(e.pointerId) || rt.transport !== 'stop') return;
  const r = mapwrap.getBoundingClientRect();
  seek(((e.clientX - r.left) / r.width) * rt.viewLen);
});
window.addEventListener('resize', drawMap);
