import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'weibenporta.state2';
const loadState = async () => {
  vi.resetModules();
  return (await import('../src/state.js')).S;
};
const oldTrack = { vol: 0.5, pan: 0.2, eko: 0.1, rev: 0.3, src: 1 };

describe('saved settings', () => {
  beforeEach(() => localStorage.clear());

  it('starts with defaults when nothing is saved', async () => {
    const S = await loadState();
    expect(S.tracks).toHaveLength(4);
    expect(S.tracks[0]).toMatchObject({ trim: 0, lo: 0, hi: 0 });
    expect(S.arm).toEqual([true, false, false, false]);
  });

  it('ignores a corrupt save', async () => {
    localStorage.setItem(KEY, '{not json');
    const S = await loadState();
    expect(S.tracks).toHaveLength(4);
  });

  it('migrates an old save: one shared input gain becomes a trim per track', async () => {
    localStorage.setItem(KEY, JSON.stringify({ title: 'song', tracks: Array(4).fill(oldTrack), trimDb: 12 }));
    const S = await loadState();
    expect(S.title).toBe('song');
    expect(S.tracks.map(t => t.trim)).toEqual([12, 12, 12, 12]);
    expect(S.tracks[0]).toMatchObject({ lo: 0, hi: 0, vol: 0.5, src: 1 });
    expect('trimDb' in S).toBe(false);
  });

  it('rebuilds a broken arm list from the old single armed track', async () => {
    localStorage.setItem(KEY, JSON.stringify({ tracks: Array(4).fill(oldTrack), arm: 'broken', armed: 2 }));
    const S = await loadState();
    expect(S.arm).toEqual([false, false, true, false]);
    expect('armed' in S).toBe(false);
  });

  it('keeps per-track trim and eq from a new save, and never restores monitor', async () => {
    const tracks = [0, 1, 2, 3].map(i => ({ ...oldTrack, trim: i * 3, lo: -2, hi: 5 }));
    localStorage.setItem(KEY, JSON.stringify({ tracks, monitor: true, arm: [false, true, false, false] }));
    const S = await loadState();
    expect(S.tracks.map(t => t.trim)).toEqual([0, 3, 6, 9]);
    expect(S.tracks[0]).toMatchObject({ lo: -2, hi: 5 });
    expect(S.monitor).toBe(false);
    expect(S.arm).toEqual([false, true, false, false]);
  });

  it('clamps an out of range trim', async () => {
    localStorage.setItem(KEY, JSON.stringify({ tracks: Array(4).fill({ ...oldTrack, trim: 90 }) }));
    const S = await loadState();
    expect(S.tracks[0].trim).toBe(36);
  });
});
