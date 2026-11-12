import { MIX_DELAY } from '../config.js';
import { S } from '../state.js';

const EQ_LO_HZ = 100, EQ_HI_HZ = 10000;   // shelving corners of the per-channel eq

function curve(fn){ const n = 4097, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1) * 2 - 1) * 2; c[i] = fn(x); } return c; }
const CLEAN = curve(x => { const a = Math.abs(x); return a <= .85 ? x : Math.sign(x) * (.85 + .15 * Math.tanh((a - .85) / .15)); });
const WARM  = curve(x => Math.tanh(.8 * x) / .8);

export function makeIR(ac, len){
  const sr = ac.sampleRate, n = Math.max(1, Math.floor(sr * len)), b = ac.createBuffer(2, n, sr);
  let seed = 20261111;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  const pre = Math.floor(sr * .012);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); let lp = 0;
    for (let i = pre; i < n; i++) { const t = (i - pre) / sr;
      const a = .22 + .6 * Math.exp(-3 * t / len);
      lp += a * (rnd() - lp); d[i] = lp * Math.exp(-6.9 * t / len); } }
  return b;
}
export function buildMixer(ac, dest){
  const m = {ch:[]};
  m.sum = ac.createGain();
  m.ekoIn = ac.createGain(); m.delay = ac.createDelay(1.5); m.fb = ac.createGain();
  m.hp = ac.createBiquadFilter(); m.hp.type = 'highpass'; m.hp.frequency.value = 180;
  m.lp = ac.createBiquadFilter(); m.lp.type = 'lowpass'; m.lp.frequency.value = 2600;
  m.ekoIn.connect(m.delay); m.delay.connect(m.hp); m.hp.connect(m.lp);
  m.lp.connect(m.fb); m.fb.connect(m.delay); m.lp.connect(m.sum);
  m.revIn = ac.createGain(); m.rev = ac.createConvolver(); m.revOut = ac.createGain(); m.revOut.gain.value = .9;
  m.revIn.connect(m.rev); m.rev.connect(m.revOut); m.revOut.connect(m.sum);
  for (let i = 0; i < 4; i++) {
    const c = {input:ac.createGain(), fader:ac.createGain(), pan:ac.createStereoPanner(), eko:ac.createGain(), rev:ac.createGain(),
      lo:ac.createBiquadFilter(), hi:ac.createBiquadFilter()};
    c.lo.type = 'lowshelf'; c.lo.frequency.value = EQ_LO_HZ;
    c.hi.type = 'highshelf'; c.hi.frequency.value = EQ_HI_HZ;
    c.input.connect(c.lo); c.lo.connect(c.hi); c.hi.connect(c.fader); c.fader.connect(c.pan); c.pan.connect(m.sum);
    c.fader.connect(c.eko); c.eko.connect(m.ekoIn);
    c.fader.connect(c.rev); c.rev.connect(m.revIn);
    m.ch.push(c);
  }
  m.pre = ac.createGain(); m.pre.gain.value = .5;
  m.shaper = ac.createWaveShaper();
  m.shelf = ac.createBiquadFilter(); m.shelf.type = 'highshelf'; m.shelf.frequency.value = 6500;
  m.wow = ac.createDelay(.05); m.wow.delayTime.value = MIX_DELAY;
  m.lfo1 = ac.createOscillator(); m.lfo1.frequency.value = .55; m.g1 = ac.createGain();
  m.lfo2 = ac.createOscillator(); m.lfo2.frequency.value = 6.3; m.g2 = ac.createGain();
  m.lfo1.connect(m.g1); m.g1.connect(m.wow.delayTime);
  m.lfo2.connect(m.g2); m.g2.connect(m.wow.delayTime);
  m.lfo1.start(); m.lfo2.start();
  m.out = ac.createGain();
  m.sum.connect(m.pre); m.pre.connect(m.shaper); m.shaper.connect(m.shelf); m.shelf.connect(m.wow); m.wow.connect(m.out); m.out.connect(dest);
  return m;
}
export const faderLaw = v => Math.pow(v / .8, 2.2);
export function applyMix(m, ac, instant){
  const t = ac.currentTime;
  const set = (p, v, tc) => { if (instant) p.value = v; else p.setTargetAtTime(v, t, tc || .02); };
  S.tracks.forEach((tr, i) => { const c = m.ch[i];
    set(c.lo.gain, tr.lo); set(c.hi.gain, tr.hi); set(c.fader.gain, faderLaw(tr.vol)); set(c.pan.pan, tr.pan); set(c.eko.gain, tr.eko); set(c.rev.gain, tr.rev * 1.2); });
  set(m.delay.delayTime, S.ekoTime, .06); set(m.fb.gain, S.ekoFb);
  m.shaper.curve = S.tapeFx ? WARM : CLEAN;
  set(m.shelf.gain, S.tapeFx ? -3 : 0);
  set(m.g1.gain, S.tapeFx ? .00025 : 0); set(m.g2.gain, S.tapeFx ? .00003 : 0);
  set(m.out.gain, faderLaw(S.master));
}
