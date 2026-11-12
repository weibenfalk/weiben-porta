import type { LastTake, Mixer, Transport, UndoEntry } from './types.js';
/**
 * Everything that changes while the machine runs: the audio graph, the transport and the input device.
 *
 * `ctx`, `live` and the audio nodes are typed as always present, because they are only used after
 * `ensureCtx()` has built them (code that can run earlier checks `if (!rt.ctx)` first).
 */
export const rt = {
  ctx: null as unknown as AudioContext,
  live: null as unknown as Mixer,
  speakerBus: null as unknown as GainNode,
  clickBus: null as unknown as GainNode,
  splitIn: null as unknown as ChannelSplitterNode,
  recMerge: null as unknown as ChannelMergerNode,
  ctxReady: null as Promise<void> | null,

  /** per-input analysers, per-track input gains and per-track monitor gains */
  rawAn: [] as AnalyserNode[],
  trackIn: [] as GainNode[],
  mon: [] as GainNode[],

  inputSrc: null as AudioNode | null,
  stream: null as MediaStream | null,
  nIn: 2,
  monMute: false,
  pkIn: [0, 0, 0, 0],
  seenInputs: [] as { label: string; active: boolean }[],
  openNote: '',
  micOK: false,
  micLabel: '',
  syncMs: null as number | null,
  syncMeasured: false,

  transport: 'stop' as Transport,
  pos: 0,
  t0: 0,
  pos0: 0,
  recPos0: 0,
  recTracks: [] as number[],
  srcs: [null, null, null, null] as (AudioBufferSourceNode | null)[],
  busy: false,
  winding: 0,
  clickTimer: 0,
  nextK: 0,
  beatLen: 0.6,

  lastTake: null as LastTake | null,
  undo: null as UndoEntry[] | null,
  /** seconds of tape shown by the overview map */
  viewLen: 60,
};
