import { routeInputs, setMonitors, setTrim } from '../audio/engine.js';
import { mixChanged, refreshIR } from '../audio/mix.js';
import { COLORS, EQ_RANGE, TRIM_RANGE } from '../config.js';
import { rt } from '../runtime.js';
import { S, saveState } from '../state.js';
import { $, h } from '../util.js';
import { controls, faderCell, knobCell, vuSVG } from './controls.js';
/* The mixer: one strip per track with its meter, input choice, record button, trim, eq, effects and fader,
   between an input strip on the left and the effects/master strip on the right. */

/** the VU needles, record buttons and input menus, one per track */
export const needles: SVGGElement[] = [];
export const armBtns: HTMLButtonElement[] = [];
export const srcSels: HTMLSelectElement[] = [];

/** A thin labelled divider between groups of controls. */
const sec = (parent: HTMLElement, text: string) =>
  parent.appendChild(h('div', 'sec', `<span>${text}</span>`));
/** Empty grid cells, so that the input and master strips keep their rows aligned with the track strips. */
const blank = (parent: HTMLElement, n = 1, cls = '') => {
  for (let i = 0; i < n; i++) parent.appendChild(h('div', 'cell spacer ' + cls, ''));
};
const dbText = (v: number) => (v > 0.05 ? '+' : '') + (Math.abs(v) < 0.05 ? '0' : v.toFixed(1)) + ' dB';
/** Build all strips into #mixer. */
export function buildMixerUI() {
  const mx = $('mixer');
  /* input strip: row for row the same layout as the track strips next to it */
  const inp = h('div', 'strip wide');
  inp.setAttribute('aria-label', 'input');
  inp.appendChild(
    h(
      'div',
      'lamps',
      '<span><i class="lampdot green" id="micLamp"></i>mic</span><span><i class="lampdot" id="peakLamp"></i>peak</span>'
    )
  );
  inp.appendChild(h('div', 'cell spacer', '<span>input</span>'));
  inp.appendChild(h('div', 'cell', '<button class="btn" id="auto" type="button">auto trim</button>'));
  sec(inp, 'monitor');
  inp.appendChild(
    h(
      'div',
      'cell',
      '<button class="sw" id="monitor" type="button" aria-pressed="false" aria-label="monitor"></button><span>monitor</span>'
    )
  );
  sec(inp, 'timing');
  inp.appendChild(
    h(
      'div',
      'cell',
      '<button class="btn" id="sync" type="button">sync</button><span class="syncval" id="syncVal">not measured</span>'
    )
  );
  blank(inp, 1, 'eq2'); // second eq row, only present when the knobs stack
  sec(inp, 'click');
  inp.appendChild(
    h(
      'div',
      'cell tall',
      '<button class="sw" id="click" type="button" aria-pressed="false" aria-label="click, metronome"></button><span>click</span><input id="bpm" type="number" min="40" max="240" step="1" aria-label="tempo in beats per minute"><span>bpm</span>'
    )
  );
  blank(inp, 1);
  blank(inp, 1, 'eq2');
  mx.appendChild(inp);
  /* four tracks: trim, eq, then delay / reverb / pan and the fader */
  controls.trim = [];
  for (let i = 0; i < 4; i++) {
    const st = h('div', 'strip');
    st.setAttribute('aria-label', 'track ' + (i + 1));
    st.style.setProperty('--cap', COLORS[i]);
    const vu = h('div', 'cell', '<div class="vubox">' + vuSVG() + '</div>');
    vu.style.width = '100%';
    st.appendChild(vu);
    needles.push(vu.querySelector<SVGGElement>('.needle')!);
    const sel = h('select', 'src');
    sel.id = 'src' + i;
    sel.setAttribute('aria-label', `sound card input for track ${i + 1}`);
    sel.addEventListener('change', () => {
      S.tracks[i].src = +sel.value;
      routeInputs();
      saveState();
    });
    srcSels.push(sel);
    const scell = h('div', 'cell');
    scell.style.width = '100%';
    scell.appendChild(sel);
    st.appendChild(scell);
    const arm = h('button', 'arm', `<span class="lampdot"></span>${i + 1}`);
    arm.type = 'button';
    arm.setAttribute('aria-label', `record on track ${i + 1}`);
    arm.addEventListener('click', () => toggleArm(i));
    armBtns.push(arm);
    const ac = h('div', 'cell');
    ac.style.width = '100%';
    ac.appendChild(arm);
    st.appendChild(ac);
    const tr = S.tracks[i],
      cap = COLORS[i],
      snap = (v: number) => (Math.abs(v) < 0.4 ? 0 : v);
    sec(st, 'trim');
    controls.trim[i] = knobCell(st, 'trim', {
      small: true,
      label: `input trim track ${i + 1}`,
      min: TRIM_RANGE[0],
      max: TRIM_RANGE[1],
      value: tr.trim,
      def: 0,
      cap,
      text: v => Math.round(v) + ' dB',
      onInput: v => {
        tr.trim = Math.round(v);
        setTrim();
        saveState();
      },
    });
    sec(st, 'eq');
    const eq = st.appendChild(h('div', 'pair'));
    knobCell(eq, 'high', {
      small: true,
      label: `high eq track ${i + 1}`,
      min: -EQ_RANGE,
      max: EQ_RANGE,
      value: tr.hi,
      def: 0,
      cap,
      text: dbText,
      onInput: v => {
        tr.hi = snap(v);
        mixChanged();
      },
    });
    knobCell(eq, 'low', {
      small: true,
      label: `low eq track ${i + 1}`,
      min: -EQ_RANGE,
      max: EQ_RANGE,
      value: tr.lo,
      def: 0,
      cap,
      text: dbText,
      onInput: v => {
        tr.lo = snap(v);
        mixChanged();
      },
    });
    sec(st, 'fx · pan');
    const fx = st.appendChild(h('div', 'pair'));
    knobCell(fx, 'delay', {
      small: true,
      label: `delay track ${i + 1}`,
      min: 0,
      max: 1,
      value: tr.eko,
      def: 0,
      cap,
      onInput: v => {
        tr.eko = v;
        mixChanged();
      },
    });
    knobCell(fx, 'reverb', {
      small: true,
      label: `reverb track ${i + 1}`,
      min: 0,
      max: 1,
      value: tr.rev,
      def: 0,
      cap,
      onInput: v => {
        tr.rev = v;
        mixChanged();
      },
    });
    knobCell(st, 'pan', {
      small: true,
      label: `pan track ${i + 1}`,
      min: -1,
      max: 1,
      value: tr.pan,
      def: 0,
      cap,
      text: v =>
        Math.abs(v) < 0.04 ? 'centre' : (v < 0 ? 'left ' : 'right ') + Math.round(Math.abs(v) * 100),
      onInput: v => {
        tr.pan = Math.abs(v) < 0.04 ? 0 : v;
        mixChanged();
      },
    });
    faderCell(st, 'volume', {
      label: `volume track ${i + 1}`,
      min: 0,
      max: 1,
      value: tr.vol,
      def: 0.8,
      cap,
      onInput: v => {
        tr.vol = v;
        mixChanged();
      },
    });
    mx.appendChild(st);
  }
  /* master strip */
  const ms = h('div', 'strip wide');
  ms.setAttribute('aria-label', 'effects and master');
  blank(ms, 3);
  sec(ms, 'tape');
  ms.appendChild(
    h(
      'div',
      'cell',
      '<button class="sw" id="tapeFx" type="button" aria-pressed="false" aria-label="tape sound"></button><span>tape sound</span>'
    )
  );
  blank(ms, 2);
  blank(ms, 1, 'eq2');
  sec(ms, 'fx');
  const mfx = ms.appendChild(h('div', 'pair'));
  knobCell(mfx, 'delay', {
    small: true,
    label: 'delay time',
    min: 0.06,
    max: 0.8,
    value: S.ekoTime,
    def: 0.32,
    text: v => Math.round(v * 1000) + ' ms',
    onInput: v => {
      S.ekoTime = v;
      mixChanged();
    },
  });
  knobCell(mfx, 'repeat', {
    small: true,
    label: 'delay repeats',
    min: 0,
    max: 0.85,
    value: S.ekoFb,
    def: 0.35,
    onInput: v => {
      S.ekoFb = v;
      mixChanged();
    },
  });
  knobCell(ms, 'reverb size', {
    small: true,
    label: 'reverb length',
    min: 0.5,
    max: 4,
    value: S.revLen,
    def: 1.8,
    text: v => v.toFixed(1) + ' s',
    onInput: v => {
      S.revLen = v;
      refreshIR();
      saveState();
    },
  });
  faderCell(ms, 'master', {
    label: 'master volume',
    min: 0,
    max: 1,
    value: S.master,
    def: 0.8,
    cap: '#1e201f',
    onInput: v => {
      S.master = v;
      mixChanged();
    },
  });
  mx.appendChild(ms);
}
/** Arm or disarm a track for recording. */
export function toggleArm(i: number) {
  if (rt.transport === 'rec' || rt.busy) return;
  S.arm[i] = !S.arm[i];
  paintArm();
  setMonitors();
  saveState();
}
export const paintArm = () => armBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(!!S.arm[i])));
export function paintSources() {
  srcSels.forEach((sel, i) => {
    sel.innerHTML = '';
    for (let k = 0; k < rt.nIn; k++) {
      const o = document.createElement('option');
      o.value = String(k);
      o.textContent = 'in ' + (k + 1);
      sel.appendChild(o);
    }
    if (!(S.tracks[i].src < rt.nIn)) S.tracks[i].src = 0;
    sel.value = String(S.tracks[i].src);
  });
}
export function paintSwitches() {
  $('monitor').setAttribute('aria-pressed', String(S.monitor));
  $('click').setAttribute('aria-pressed', String(S.click));
  $('tapeFx').setAttribute('aria-pressed', String(S.tapeFx));
}
export function paintLamps() {
  $('micLamp').classList.toggle('lit', rt.micOK);
}
export function paintSync() {
  const t = rt.syncMs == null ? 'not measured' : rt.syncMs + ' ms' + (rt.syncMeasured ? '' : ' (guess)');
  $('syncVal').textContent = t;
  $('syncVal2').textContent = t;
}
export function paintTransport() {
  $('play').classList.toggle('down', rt.transport !== 'stop');
  $('rec').classList.toggle('down', rt.transport === 'rec');
  $('play').setAttribute('aria-pressed', String(rt.transport !== 'stop'));
  $('rec').setAttribute('aria-pressed', String(rt.transport === 'rec'));
}
