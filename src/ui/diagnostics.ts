import { rec } from '../audio/recorder.js';
import { rt } from '../runtime.js';
import { S } from '../state.js';
import { health } from './health.js';
const dB = (x: number) => (x > 1e-6 ? (20 * Math.log10(x)).toFixed(1) + ' dBFS' : 'silent');
const msT = (x: number | null | undefined) =>
  x == null || !isFinite(x) ? 'n/a' : Math.round(x * 1000) + ' ms';
/** The text of the diagnostics box in the settings dialog: what the browser is doing with the sound. */
export function diagText() {
  const L = ['Weiben Porta diagnostics', 'browser: ' + navigator.userAgent, 'page: ' + location.protocol];
  if (!rt.ctx) {
    L.push('audio: not switched on yet');
    return L.join('\n');
  }
  L.push(
    `audio: ${rt.ctx.sampleRate} Hz, ${rt.ctx.state}, base latency ${msT(rt.ctx.baseLatency)}, output latency ${msT(rt.ctx.outputLatency)}`
  );
  L.push(
    'recorder: ' + (rec.mode === 'worklet' ? 'audio thread (exact)' : 'fallback on main thread (may crackle)')
  );
  L.push(
    `screen: ${health.slow} of ${health.frames} frames took more than 50 ms (worst ${health.worstMs} ms). audio clock: lost ${health.audioLostMs} ms in ${health.audioSecs} s`
  );
  L.push('inputs found:');
  rt.seenInputs.forEach(d => L.push((d.active ? '  > ' : '    ') + d.label));
  if (rt.stream) {
    const tr = rt.stream.getAudioTracks()[0];
    let st: Record<string, unknown> = {};
    try {
      st = { ...tr.getSettings() };
    } catch (e) {}
    L.push(`active input: ${tr.label} (${tr.readyState}${tr.muted ? ', muted' : ''})`);
    L.push(
      '  ' +
        ['channelCount', 'sampleRate', 'echoCancellation', 'autoGainControl', 'noiseSuppression', 'latency']
          .map(k => k + '=' + st[k])
          .join(', ')
    );
  } else L.push('active input: none');
  if (rt.openNote) L.push('note: ' + rt.openNote);
  L.push(
    `inputs on this card: ${rt.nIn}; recent peaks: ${rt.pkIn
      .slice(0, rt.nIn)
      .map((p, k) => 'in ' + (k + 1) + ' ' + dB(p))
      .join(', ')}`
  );
  L.push(
    'tracks: ' +
      S.tracks.map((t, i) => `${i + 1} from in ${t.src + 1}${S.arm[i] ? ' (armed)' : ''}`).join(', ')
  );
  L.push(
    `trim: ${S.tracks.map((t, i) => i + 1 + ' ' + t.trim + ' dB').join(', ')}; eq lo/hi: ${S.tracks.map((t, i) => i + 1 + ' ' + t.lo + '/' + t.hi).join(', ')}; sync: ${rt.syncMs == null ? 'none' : rt.syncMs + ' ms ' + (rt.syncMeasured ? '(measured)' : '(estimate)')}; tape sound: ${S.tapeFx ? 'on' : 'off'}`
  );
  if (rt.lastTake) {
    rt.lastTake.tracks.forEach(t =>
      L.push(
        `last take, track ${t.track + 1} from in ${t.src + 1}: ${t.sec.toFixed(1)} s, peak ${dB(t.peak)}, clipped samples ${t.clipN}`
      )
    );
    L.push(
      `last take: dropouts ${rt.lastTake.drops == null ? 'n/a' : rt.lastTake.drops}, silent blocks ${rt.lastTake.zero == null ? 'n/a' : rt.lastTake.zero + '/' + rt.lastTake.blocks}`
    );
  }
  return L.join('\n');
}
