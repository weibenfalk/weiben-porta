import { TRIM_RANGE } from './config.js';
import { clamp } from './util.js';
import type { Samples, Settings, TapeTrack } from './types.js';
const STORAGE_KEY = 'weibenporta.state2';

/** The saved settings: faders, knobs, switches. Recorded audio is stored separately, see `idb`. */
export const S: Settings = {
  title: 'demo 1',
  tracks: [0, 1, 2, 3].map(() => ({ vol: 0.8, pan: 0, eko: 0, rev: 0.12, src: 0, trim: 0, lo: 0, hi: 0 })),
  master: 0.8,
  ekoTime: 0.32,
  ekoFb: 0.35,
  revLen: 1.8,
  tapeFx: false,
  monitor: false,
  click: false,
  bpm: 100,
  arm: [true, false, false, false],
};

/* Load what was saved last time. Older saves are migrated: they had a single armed track instead of
   `arm`, and one shared input gain (`trimDb`) instead of a trim per track. */
let oldTrim = 0;
let legacyArmed = 0;
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved && Array.isArray(saved.tracks) && saved.tracks.length === 4) {
    oldTrim = +saved.trimDb || 0;
    legacyArmed = saved.armed || 0;
    Object.assign(S, saved);
    // the legacy keys were copied onto S too: drop them again
    delete (S as any).armed;
    delete (S as any).chan;
    delete (S as any).trimDb;
  }
} catch (e) {}
S.monitor = false;
if (!Array.isArray(S.arm) || S.arm.length !== 4) S.arm = [0, 1, 2, 3].map(i => i === legacyArmed);
S.tracks.forEach(t => {
  if (!(t.src >= 0 && t.src < 4)) t.src = 0;
  t.trim = clamp(Math.round(typeof t.trim === 'number' ? t.trim : oldTrim), TRIM_RANGE[0], TRIM_RANGE[1]);
  t.lo = typeof t.lo === 'number' ? t.lo : 0;
  t.hi = typeof t.hi === 'number' ? t.hi : 0;
});

let saveTimer = 0;
/** Save the settings shortly after the last change. */
export const saveState = () => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
    } catch (e) {}
  }, 300);
};

/** The four tracks of tape, in memory. */
export const tape: (TapeTrack | null)[] = [null, null, null, null];

/* ---------- storage for the tape ---------- */

/** What is kept in IndexedDB for one track. */
interface StoredTrack {
  sr: number;
  data: Samples;
}

/** Best effort: if the browser blocks IndexedDB the machine still works, the tape is just not kept. */
export const idb = {
  db: null as IDBDatabase | null,
  open() {
    return new Promise<boolean>(res => {
      try {
        const r = indexedDB.open('weibenporta', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('tape');
        r.onsuccess = () => {
          this.db = r.result;
          res(true);
        };
        r.onerror = () => res(false);
      } catch (e) {
        res(false);
      }
    });
  },
  put(k: string, v: StoredTrack | null) {
    if (!this.db) return;
    try {
      this.db.transaction('tape', 'readwrite').objectStore('tape').put(v, k);
    } catch (e) {}
  },
  get(k: string) {
    return new Promise<StoredTrack | null>(res => {
      if (!this.db) return res(null);
      try {
        const r = this.db.transaction('tape').objectStore('tape').get(k);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => res(null);
      } catch (e) {
        res(null);
      }
    });
  },
};

export const saveTrack = (i: number) => {
  const t = tape[i];
  idb.put('t' + i, t ? { sr: t.sr, data: t.data } : null);
};
