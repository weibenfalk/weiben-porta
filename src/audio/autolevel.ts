import { TRIM_RANGE } from '../config.js';
import { rt } from '../runtime.js';
import { S, saveState } from '../state.js';
import { controls } from '../ui/controls.js';
import { say } from '../ui/display.js';
import { clamp, sleep } from '../util.js';
import { armed, names, setTrim } from './engine.js';
import { openMic } from './inputs.js';
/** "auto trim": listen for four seconds and set each armed track's trim so loud playing peaks around half scale. */
export async function autoLevel() {
  if (rt.busy || rt.transport !== 'stop') return;
  if (!rt.micOK) {
    if (!(await openMic())) return;
  }
  const targets = armed().length ? armed() : [0, 1, 2, 3];
  const ins = [...new Set(targets.map(i => S.tracks[i].src))];
  rt.busy = true;
  const buf = new Float32Array(1024),
    peaks: Record<number, number> = {};
  ins.forEach(k => (peaks[k] = 0));
  for (let s = 4; s > 0; s--) {
    say(`play or sing as loud as you are going to. listening for ${s} s.`);
    for (let i = 0; i < 40; i++) {
      ins.forEach(k => {
        rt.rawAn[k].getFloatTimeDomainData(buf);
        for (let j = 0; j < buf.length; j++) {
          const v = Math.abs(buf[j]);
          if (v > peaks[k]) peaks[k] = v;
        }
      });
      await sleep(22);
    }
  }
  rt.busy = false;
  const heard = targets.filter(i => peaks[S.tracks[i].src] >= 0.002);
  if (!heard.length) {
    say(
      'heard almost nothing. check the input chosen under each track number, and that input at the top shows the right sound card.'
    );
    return;
  }
  heard.forEach(i => {
    const tr = S.tracks[i];
    tr.trim = clamp(Math.round(20 * Math.log10(0.5 / peaks[tr.src])), TRIM_RANGE[0], TRIM_RANGE[1]);
    controls.trim[i].set(tr.trim, false);
  });
  setTrim();
  saveState();
  say(
    `trim set on ${names(heard)} (${heard.map(i => (S.tracks[i].trim > 0 ? '+' : '') + S.tracks[i].trim).join(', ')} dB). the needle should reach about 0 when you play loud.`
  );
}
