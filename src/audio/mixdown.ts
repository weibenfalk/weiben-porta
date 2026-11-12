import { rt } from '../runtime.js';
import { S, tape } from '../state.js';
import { say } from '../ui/display.js';
import { sleep } from '../util.js';
import { ensureCtx } from './engine.js';
import { applyMix, buildMixer, makeIR } from './graph.js';
import { contentEnd } from './transport.js';
import { encodeWav } from './wav.js';
/* Mixdown: render the tape through the same mixer graph offline, then encode it as wav or mp3. */

/** Render the whole tape to a stereo AudioBuffer, with room for the delay and reverb tails. */
export async function renderMix() {
  const end = contentEnd();
  if (!end) return null;
  await ensureCtx();
  const sr = rt.ctx.sampleRate,
    tail = 1.2 + S.revLen + (S.tracks.some(t => t.eko > 0.02) ? 2.5 : 0);
  const oc = new OfflineAudioContext(2, Math.ceil((end + tail) * sr), sr);
  const m = buildMixer(oc, oc.destination);
  applyMix(m, oc, true);
  m.rev.buffer = makeIR(oc, S.revLen);
  tape.forEach((t, i) => {
    if (!t) return;
    const b = oc.createBuffer(1, t.data.length, sr);
    b.copyToChannel(t.data, 0);
    const s = oc.createBufferSource();
    s.buffer = b;
    s.connect(m.ch[i].input);
    s.start(0);
  });
  return oc.startRendering();
}
/** 320 kbit/s mp3 via lamejs, in slices so the page stays responsive. */
export async function encodeMp3(buf: AudioBuffer, onProgress: (percent: number) => void) {
  const sr = buf.sampleRate,
    n = buf.length,
    L = buf.getChannelData(0),
    R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const enc = new lamejs.Mp3Encoder(2, sr, 320),
    parts = [],
    B = 1152 * 32,
    l16 = new Int16Array(B),
    r16 = new Int16Array(B);
  let last = performance.now();
  for (let i = 0; i < n; i += B) {
    const m = Math.min(B, n - i);
    for (let k = 0; k < m; k++) {
      let x = L[i + k],
        y = R[i + k];
      x = x < -1 ? -1 : x > 1 ? 1 : x;
      y = y < -1 ? -1 : y > 1 ? 1 : y;
      l16[k] = x < 0 ? x * 32768 : x * 32767;
      r16[k] = y < 0 ? y * 32768 : y * 32767;
    }
    const out = enc.encodeBuffer(l16.subarray(0, m), r16.subarray(0, m));
    if (out.length) parts.push(new Uint8Array(out));
    if (performance.now() - last > 80) {
      onProgress(Math.round((i / n) * 100));
      await sleep(0);
      last = performance.now();
    }
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: 'audio/mpeg' });
}
export /** Mix down to a downloadable file. */
async function mixdown(kind: 'wav' | 'mp3') {
  if (rt.busy || rt.transport !== 'stop') {
    say('stop the tape first.');
    return;
  }
  if (!contentEnd()) {
    say('the tape is empty. record something first.');
    return;
  }
  rt.busy = true;
  say('mixing down …');
  try {
    const r = (await renderMix())!,
      base = (S.title.trim() || 'demo').replace(/[\\/:*?"<>|]+/g, ' ');
    let blob: Blob, name: string;
    if (kind === 'mp3') {
      if (typeof lamejs === 'undefined') throw new Error('no encoder');
      if (![32000, 44100, 48000].includes(r.sampleRate)) {
        say(
          `mp3 at 320 kbit/s needs 44.1 or 48 kHz, and this tape runs at ${r.sampleRate} Hz. mix down to wav instead.`
        );
        rt.busy = false;
        return;
      }
      blob = await encodeMp3(r, (pct: number) => say(`making the mp3 … ${pct} %`));
      name = base + '.mp3';
    } else {
      blob = encodeWav(r);
      name = base + '.wav';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    say(`done. ${name} is in your downloads${kind === 'mp3' ? ' (mp3, 320 kbit/s)' : ''}.`);
  } catch (e) {
    say('the mixdown failed. try again with a shorter tape.');
  }
  rt.busy = false;
}
