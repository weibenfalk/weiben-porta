import { clamp } from '../util.js';

/** 16-bit wav file from one array of samples per channel (all the same length). */
export function wavBytes(d: Float32Array[], sr: number) {
  const n = d[0].length,
    ch = d.length,
    v = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const x = clamp(d[c][i], -1, 1);
      v.setInt16(o, x < 0 ? x * 32768 : x * 32767, true);
      o += 2;
    }
  return v.buffer;
}

/** 16-bit wav file. */
export function encodeWav(buf: AudioBuffer) {
  const d = [];
  for (let c = 0; c < buf.numberOfChannels; c++) d.push(buf.getChannelData(c));
  return new Blob([wavBytes(d, buf.sampleRate)], { type: 'audio/wav' });
}
