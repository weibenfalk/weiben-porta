import { MIX_DELAY } from '../config.js';
import { S } from '../state.js';
import type { Channel, Mixer } from '../types.js';
const EQ_LO_HZ = 100; // shelving corners of the per-channel eq
const EQ_HI_HZ = 10000;
const TRACKS = 4;

/* ---------- tape saturation curves ---------- */
function curve(fn: (x: number) => number) {
  const n = 4097;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = fn(((i / (n - 1)) * 2 - 1) * 2);
  return c;
}
/** transparent until close to full scale, then rounds off */
const CLEAN = curve(x => {
  const a = Math.abs(x);
  return a <= 0.85 ? x : Math.sign(x) * (0.85 + 0.15 * Math.tanh((a - 0.85) / 0.15));
});
/** "tape sound": soft saturation all the way */
const WARM = curve(x => Math.tanh(0.8 * x) / 0.8);

/** A synthetic room: filtered noise with an exponential decay. Seeded, so every render is identical. */
export function makeIR(ac: BaseAudioContext, len: number) {
  const sr = ac.sampleRate;
  const n = Math.max(1, Math.floor(sr * len));
  const b = ac.createBuffer(2, n, sr);
  let seed = 20261111;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const preDelay = Math.floor(sr * 0.012);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = preDelay; i < n; i++) {
      const t = (i - preDelay) / sr;
      const a = 0.22 + 0.6 * Math.exp((-3 * t) / len);
      lp += a * (rnd() - lp);
      d[i] = lp * Math.exp((-6.9 * t) / len);
    }
  }
  return b;
}

/** One channel strip: input -> low shelf -> high shelf -> fader -> pan, with echo and reverb sends after the fader. */
function buildChannel(ac: BaseAudioContext, sum: AudioNode, ekoIn: AudioNode, revIn: AudioNode): Channel {
  const c: Channel = {
    input: ac.createGain(),
    lo: ac.createBiquadFilter(),
    hi: ac.createBiquadFilter(),
    fader: ac.createGain(),
    pan: ac.createStereoPanner(),
    eko: ac.createGain(),
    rev: ac.createGain(),
  };
  c.lo.type = 'lowshelf';
  c.lo.frequency.value = EQ_LO_HZ;
  c.hi.type = 'highshelf';
  c.hi.frequency.value = EQ_HI_HZ;
  c.input.connect(c.lo);
  c.lo.connect(c.hi);
  c.hi.connect(c.fader);
  c.fader.connect(c.pan);
  c.pan.connect(sum);
  c.fader.connect(c.eko);
  c.eko.connect(ekoIn);
  c.fader.connect(c.rev);
  c.rev.connect(revIn);
  return c;
}

/**
 * The whole mixing graph. The same function builds the live graph and the offline one used for
 * mixdown, so what you hear is what you export.
 */
export function buildMixer(ac: BaseAudioContext, dest: AudioNode): Mixer {
  const sum = ac.createGain();

  // echo: a delay line with a high-pass and low-pass in the feedback loop
  const ekoIn = ac.createGain();
  const delay = ac.createDelay(1.5);
  const fb = ac.createGain();
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 180;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  ekoIn.connect(delay);
  delay.connect(hp);
  hp.connect(lp);
  lp.connect(fb);
  fb.connect(delay);
  lp.connect(sum);

  // reverb: convolution with the synthetic room (its buffer is set by the caller)
  const revIn = ac.createGain();
  const rev = ac.createConvolver();
  const revOut = ac.createGain();
  revOut.gain.value = 0.9;
  revIn.connect(rev);
  rev.connect(revOut);
  revOut.connect(sum);

  const ch: Channel[] = [];
  for (let i = 0; i < TRACKS; i++) ch.push(buildChannel(ac, sum, ekoIn, revIn));

  // master section: saturation, a slightly dull top end and wow/flutter ("tape sound" switches these on)
  const pre = ac.createGain();
  pre.gain.value = 0.5;
  const shaper = ac.createWaveShaper();
  const shelf = ac.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 6500;
  const wow = ac.createDelay(0.05);
  wow.delayTime.value = MIX_DELAY;
  const lfo1 = ac.createOscillator();
  lfo1.frequency.value = 0.55;
  const g1 = ac.createGain();
  const lfo2 = ac.createOscillator();
  lfo2.frequency.value = 6.3;
  const g2 = ac.createGain();
  lfo1.connect(g1);
  g1.connect(wow.delayTime);
  lfo2.connect(g2);
  g2.connect(wow.delayTime);
  lfo1.start();
  lfo2.start();
  const out = ac.createGain();
  sum.connect(pre);
  pre.connect(shaper);
  shaper.connect(shelf);
  shelf.connect(wow);
  wow.connect(out);
  out.connect(dest);

  return {
    ch,
    sum,
    ekoIn,
    delay,
    fb,
    hp,
    lp,
    revIn,
    rev,
    revOut,
    pre,
    shaper,
    shelf,
    wow,
    lfo1,
    g1,
    lfo2,
    g2,
    out,
  };
}

/** Fader position (0 to 1) to gain. 0.8 is unity. */
export const faderLaw = (v: number) => Math.pow(v / 0.8, 2.2);

/** Copy the current settings onto a mixer. `instant` skips the smoothing (used when it is first built). */
export function applyMix(m: Mixer, ac: BaseAudioContext, instant: boolean) {
  const t = ac.currentTime;
  const set = (p: AudioParam, v: number, timeConstant = 0.02) => {
    if (instant) p.value = v;
    else p.setTargetAtTime(v, t, timeConstant);
  };
  S.tracks.forEach((tr, i) => {
    const c = m.ch[i];
    set(c.lo.gain, tr.lo);
    set(c.hi.gain, tr.hi);
    set(c.fader.gain, faderLaw(tr.vol));
    set(c.pan.pan, tr.pan);
    set(c.eko.gain, tr.eko);
    set(c.rev.gain, tr.rev * 1.2);
  });
  set(m.delay.delayTime, S.ekoTime, 0.06);
  set(m.fb.gain, S.ekoFb);
  m.shaper.curve = S.tapeFx ? WARM : CLEAN;
  set(m.shelf.gain, S.tapeFx ? -3 : 0);
  set(m.g1.gain, S.tapeFx ? 0.00025 : 0);
  set(m.g2.gain, S.tapeFx ? 0.00003 : 0);
  set(m.out.gain, faderLaw(S.master));
}
