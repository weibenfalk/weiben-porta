/** Recorded audio. The explicit buffer type is what AudioBuffer.copyToChannel accepts. */
export type Samples = Float32Array<ArrayBuffer>;

export type Transport = 'stop' | 'play' | 'rec';

/** One track of recorded tape. `buf` is the same samples as an AudioBuffer once the audio context exists. */
export interface TapeTrack {
  data: Samples;
  sr: number;
  buf: AudioBuffer | null;
}

/** Per-track settings, saved to localStorage. */
export interface TrackSettings {
  vol: number;
  pan: number;
  eko: number;
  rev: number;
  src: number;
  /** input gain in dB, applied before the signal is recorded */
  trim: number;
  /** low shelf (200 Hz) and high shelf (4 kHz) in dB */
  lo: number;
  hi: number;
}

export interface Settings {
  title: string;
  tracks: TrackSettings[];
  master: number;
  ekoTime: number;
  ekoFb: number;
  revLen: number;
  tapeFx: boolean;
  monitor: boolean;
  click: boolean;
  bpm: number;
  arm: boolean[];
}

export interface Channel {
  input: GainNode;
  lo: BiquadFilterNode;
  hi: BiquadFilterNode;
  fader: GainNode;
  pan: StereoPannerNode;
  eko: GainNode;
  rev: GainNode;
  /** level meter, only on the live graph */
  an?: AnalyserNode;
}

/** The mixing graph. The same shape is built for live playback and for the offline mixdown. */
export interface Mixer {
  ch: Channel[];
  sum: GainNode;
  ekoIn: GainNode;
  delay: DelayNode;
  fb: GainNode;
  hp: BiquadFilterNode;
  lp: BiquadFilterNode;
  revIn: GainNode;
  rev: ConvolverNode;
  revOut: GainNode;
  pre: GainNode;
  shaper: WaveShaperNode;
  shelf: BiquadFilterNode;
  wow: DelayNode;
  lfo1: OscillatorNode;
  g1: GainNode;
  lfo2: OscillatorNode;
  g2: GainNode;
  out: GainNode;
}

export interface TakeInfo {
  track: number;
  src: number;
  sec: number;
  peak: number;
  clipN: number;
}

export interface LastTake {
  tracks: TakeInfo[];
  drops: number | null;
  zero: number | null;
  blocks: number | null;
}

export interface UndoEntry {
  track: number;
  prev: TapeTrack | null;
}

/** The recorder's counters when it stops: silent blocks, total blocks, dropouts. */
export interface RecStats {
  z: number;
  b: number;
  d: number;
}
