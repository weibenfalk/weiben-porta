import { TRIM_RANGE } from './config.js';
import { clamp } from './util.js';

export const S = {
  title:'demo 1',
  tracks:[0,1,2,3].map(() => ({vol:.8, pan:0, eko:0, rev:.12, src:0, trim:0, lo:0, hi:0})),
  master:.8, ekoTime:.32, ekoFb:.35, revLen:1.8, tapeFx:false,
  monitor:false, click:false, bpm:100, arm:[true,false,false,false]
};
let oldTrim = 0;
try { const s = JSON.parse(localStorage.getItem('weibenporta.state2') || 'null');
  if (s && Array.isArray(s.tracks) && s.tracks.length === 4) { oldTrim = +s.trimDb || 0; Object.assign(S, s); } } catch (e) {}
S.monitor = false;
if (!Array.isArray(S.arm) || S.arm.length !== 4) S.arm = [0,1,2,3].map(i => i === (S.armed || 0));
S.tracks.forEach(t => {
  if (!(t.src >= 0 && t.src < 4)) t.src = 0;
  // older saves had one shared input gain; per-channel trim, lo and hi are newer
  t.trim = clamp(Math.round(typeof t.trim === 'number' ? t.trim : oldTrim), TRIM_RANGE[0], TRIM_RANGE[1]);
  t.lo = typeof t.lo === 'number' ? t.lo : 0;
  t.hi = typeof t.hi === 'number' ? t.hi : 0;
});
delete S.armed; delete S.chan; delete S.trimDb;

let saveT = 0;
export const saveState = () => { clearTimeout(saveT); saveT = setTimeout(() => {
  try { localStorage.setItem('weibenporta.state2', JSON.stringify(S)); } catch (e) {} }, 300); };

export const tape = [null,null,null,null];   // {data:Float32Array, sr, buf:AudioBuffer|null}

/* ---------- storage for audio ---------- */
export const idb = {
  db:null,
  open(){ return new Promise(res => { try {
    const r = indexedDB.open('weibenporta', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('tape');
    r.onsuccess = () => { this.db = r.result; res(true); };
    r.onerror = () => res(false);
  } catch (e) { res(false); } }); },
  put(k, v){ if (!this.db) return; try { this.db.transaction('tape','readwrite').objectStore('tape').put(v, k); } catch (e) {} },
  get(k){ return new Promise(res => { if (!this.db) return res(null); try {
    const r = this.db.transaction('tape').objectStore('tape').get(k);
    r.onsuccess = () => res(r.result || null); r.onerror = () => res(null);
  } catch (e) { res(null); } }); }
};
export const saveTrack = i => idb.put('t' + i, tape[i] ? {sr:tape[i].sr, data:tape[i].data} : null);
