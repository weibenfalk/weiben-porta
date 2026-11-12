import workletSrc from './tape-rec.worklet.js?raw';
import { rt } from '../runtime.js';
import type { RecStats } from '../types.js';
/* The recorder captures all four inputs sample-exactly on the audio thread (tape-rec.worklet.js).
   Browsers without AudioWorklet fall back to a ScriptProcessor, which is less exact. */
const WORKLET = workletSrc;
const concat = (chunks: Float32Array[]) => {
  let n = 0;
  chunks.forEach(c => (n += c.length));
  const out = new Float32Array(n);
  let o = 0;
  chunks.forEach(c => {
    out.set(c, o);
    o += c.length;
  });
  return out;
};
/** state of the ScriptProcessor fallback: whether it is recording, the first frame to keep, the next expected frame */
interface FallbackState {
  on: boolean;
  start: number;
  next: number;
}

export const rec = {
  node: null as AudioWorkletNode | ScriptProcessorNode | null,
  mode: '' as '' | 'worklet' | 'fallback',
  /** recorded audio per input, as the chunks arrive */
  chunks: [[], [], [], []] as Float32Array[][],
  resolve: null as ((raw: Float32Array[]) => void) | null,
  sp: null as FallbackState | null,
  stats: null as RecStats | null,
  mask: [true, true, true, true],
  async init() {
    const mute = rt.ctx.createGain();
    mute.gain.value = 0;
    mute.connect(rt.ctx.destination);
    try {
      // A page opened straight from disk may not load blob: modules, so try a data: address first.
      try {
        await rt.ctx.audioWorklet.addModule(
          'data:application/javascript;charset=utf-8,' + encodeURIComponent(WORKLET)
        );
      } catch (e1) {
        await rt.ctx.audioWorklet.addModule(
          URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
        );
      }
      const node = new AudioWorkletNode(rt.ctx, 'tape-rec', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 4,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
      });
      node.port.onmessage = e => {
        if (e.data.chunk)
          e.data.chunk.forEach((c: Float32Array | null, k: number) => {
            if (c) this.chunks[k].push(c);
          });
        else if (e.data.done && this.resolve) {
          this.stats = { z: e.data.z, b: e.data.b, d: e.data.d };
          const r = this.resolve;
          this.resolve = null;
          r(this.chunks.map(concat));
        }
      };
      this.node = node;
      this.mode = 'worklet';
    } catch (err) {
      // Older browsers: less exact, still usable after a sync measurement.
      const sp = rt.ctx.createScriptProcessor(4096, 4, 1);
      sp.channelCount = 4;
      sp.channelCountMode = 'explicit';
      sp.channelInterpretation = 'discrete';
      this.sp = { on: false, start: 0, next: -1 };
      sp.onaudioprocess = e => {
        const s = this.sp!;
        if (!s.on) return;
        const len = e.inputBuffer.length;
        if (s.next < 0) s.next = Math.round(rt.ctx.currentTime * rt.ctx.sampleRate) - len;
        const a = s.next;
        s.next += len;
        if (a + len <= s.start) return;
        const off = a < s.start ? s.start - a : 0;
        for (let c = 0; c < 4; c++)
          if (this.mask[c]) this.chunks[c].push(e.inputBuffer.getChannelData(c).slice(off));
      };
      this.node = sp;
      this.mode = 'fallback';
    }
    this.node!.connect(mute);
  },
  start(frame: number, mask?: boolean[]) {
    this.mask = mask || [true, true, true, true];
    this.chunks = [[], [], [], []];
    this.stats = null;
    if (this.mode === 'worklet')
      (this.node as AudioWorkletNode).port.postMessage({ cmd: 'start', frame, mask: this.mask });
    else {
      this.sp!.start = frame;
      this.sp!.next = -1;
      this.sp!.on = true;
    }
  },
  stop() {
    return new Promise<Float32Array[]>(res => {
      if (this.mode === 'worklet') {
        this.resolve = res;
        (this.node as AudioWorkletNode).port.postMessage({ cmd: 'stop' });
      } else {
        this.sp!.on = false;
        res(this.chunks.map(concat));
      }
    });
  },
};
