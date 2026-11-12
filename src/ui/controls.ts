import { clamp, h } from '../util.js';
export interface ControlOptions {
  label: string;
  min: number;
  max: number;
  value: number;
  /** value restored by a double click */
  def: number;
  onInput: (v: number) => void;
  /** spoken form of the value, for screen readers */
  text?: (v: number) => string;
  /** colour of the cap, a CSS colour */
  cap?: string;
  small?: boolean;
  type?: 'fader';
}

export interface Control {
  set: (v: number, fire?: boolean) => void;
  get: () => number;
}

/** Make an element behave as a knob or a fader: drag up and down, shift for fine, double click to reset, arrow keys. */
export function control(el: HTMLElement, o: ControlOptions): Control {
  let v = o.value;
  const span = o.max - o.min;
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', o.label);
  el.setAttribute('aria-valuemin', String(o.min));
  el.setAttribute('aria-valuemax', String(o.max));
  if (o.type === 'fader') el.setAttribute('aria-orientation', 'vertical');
  el.appendChild(document.createElement('i'));
  const paint = () => {
    const n = (v - o.min) / span;
    if (o.type === 'fader') el.style.setProperty('--n', String(n));
    else el.style.setProperty('--a', -135 + 270 * n + 'deg');
    el.setAttribute('aria-valuenow', String(Math.round(v * 100) / 100));
    if (o.text) el.setAttribute('aria-valuetext', o.text(v));
  };
  const set = (nv: number, fire = true) => {
    v = clamp(nv, o.min, o.max);
    paint();
    if (fire) o.onInput(v);
  };
  let sy = 0,
    sv = 0;
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    sy = e.clientY;
    sv = v;
    el.style.cursor = 'grabbing';
    e.preventDefault();
    el.focus();
  });
  el.addEventListener('pointermove', e => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const travel = o.type === 'fader' ? el.clientHeight - 26 : 150;
    set(sv + ((sy - e.clientY) / travel) * span * (e.shiftKey ? 0.25 : 1));
  });
  const up = () => {
    el.style.cursor = '';
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('dblclick', () => set(o.def));
  el.addEventListener('keydown', e => {
    const st = span / 40;
    let handled = true;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(v + st);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(v - st);
    else if (e.key === 'Home') set(o.min);
    else if (e.key === 'End') set(o.max);
    else handled = false;
    if (handled) e.preventDefault();
  });
  paint();
  return { set, get: () => v };
}
/** the knobs that other code needs to move by itself */
export const controls = { trim: [] as Control[] };

/** The VU meter face as SVG markup. The needle is the element with class `needle`. */
export function vuSVG() {
  const P = (a: number, r: number) => {
    const q = (a * Math.PI) / 180;
    return [(50 + r * Math.sin(q)).toFixed(1), (80 - r * Math.cos(q)).toFixed(1)];
  };
  const marks: [number, number, string][] = [
    [-20, -40, '20'],
    [-10, -22, '10'],
    [-7, -12, ''],
    [-5, -4, '5'],
    [-3, 6, ''],
    [0, 20, '0'],
    [3, 40, '3'],
  ];
  let s =
    '<svg class="vu" viewBox="0 0 100 60" aria-hidden="true"><rect class="face" width="100" height="60"/><rect class="glow" width="100" height="60" fill="url(#vuGlow)"/>';
  const [x1, y1] = P(-40, 50),
    [x2, y2] = P(20, 50),
    [x3, y3] = P(40, 50);
  s += `<path d="M${x1} ${y1}A50 50 0 0 1 ${x2} ${y2}" fill="none" stroke="#1e201f" stroke-width="1.2"/>`;
  s += `<path d="M${x2} ${y2}A50 50 0 0 1 ${x3} ${y3}" fill="none" stroke="#c22e23" stroke-width="3"/>`;
  marks.forEach(([db, a, t]) => {
    const [ax, ay] = P(a, 50),
      [bx, by] = P(a, 55),
      [tx, ty] = P(a, 61);
    s += `<path d="M${ax} ${ay}L${bx} ${by}" stroke="${db >= 0 ? '#c22e23' : '#1e201f'}" stroke-width="1"/>`;
    if (t)
      s += `<text x="${tx}" y="${(+ty + 2).toFixed(1)}" font-size="6.500" font-weight="600" text-anchor="middle" fill="${db >= 0 ? '#c22e23' : '#1e201f'}" font-family="Jost,Futura,sans-serif">${t}</text>`;
  });
  s +=
    '<text x="50" y="46" font-size="6.500" font-weight="600" text-anchor="middle" fill="#1e201f" font-family="Jost,Futura,sans-serif">vu</text>';
  s +=
    '<g class="needle" transform="rotate(-46 50 80)"><line x1="51.300" y1="80" x2="51.300" y2="28" stroke="rgba(0,0,0,.22)" stroke-width="1.6"/><line x1="50" y1="80" x2="50" y2="27" stroke="#141414" stroke-width="1.1"/></g>';
  s +=
    '<rect y="51" width="100" height="9" fill="url(#vuCover)"/><circle cx="50" cy="55.500" r="2.200" fill="#8d8f8a" stroke="#000" stroke-width=".5"/></svg>';
  return s;
}
/** A knob with its label under it, added to `parent`. */
export function knobCell(parent: HTMLElement, text: string, o: ControlOptions) {
  const c = h('div', 'cell');
  const k = h('div', 'knob' + (o.small ? ' small' : ''));
  if (o.cap) k.style.setProperty('--cap', o.cap);
  c.appendChild(k);
  c.appendChild(h('span', '', text));
  parent.appendChild(c);
  return control(k, o);
}
/** A fader with its label under it, added to `parent`. */
export function faderCell(parent: HTMLElement, text: string, o: ControlOptions) {
  const c = h('div', 'cell');
  const f = h('div', 'fader');
  if (o.cap) f.style.setProperty('--cap', o.cap);
  c.appendChild(f);
  c.appendChild(h('span', '', text));
  parent.appendChild(c);
  o.type = 'fader';
  return control(f, o);
}
