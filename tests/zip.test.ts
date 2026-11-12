import { describe, expect, it } from 'vitest';
import { crc32, makeZip } from '../src/audio/zip.js';
import { wavBytes } from '../src/audio/wav.js';

const bytes = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('makeZip', () => {
  /** Read a stored zip back the way an unzip program does: through the central directory. */
  const read = async (blob: Blob) => {
    const v = new DataView(await blob.arrayBuffer()),
      u8 = new Uint8Array(await blob.arrayBuffer());
    const eocd = u8.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    expect(p + v.getUint32(eocd + 12, true)).toBe(eocd);
    const out: { name: string; data: Uint8Array; crcOk: boolean }[] = [];
    for (let k = 0; k < count; k++) {
      expect(v.getUint32(p, true)).toBe(0x02014b50);
      const crc = v.getUint32(p + 16, true),
        size = v.getUint32(p + 24, true),
        nameLen = v.getUint16(p + 28, true),
        at = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
      expect(v.getUint32(at, true)).toBe(0x04034b50);
      expect(v.getUint16(at + 26, true)).toBe(nameLen);
      const start = at + 30 + nameLen,
        data = u8.subarray(start, start + size);
      out.push({ name, data, crcOk: crc32(data) === crc && v.getUint32(at + 14, true) === crc });
      p += 46 + nameLen;
    }
    return out;
  };

  it('stores every file under its name, with a matching crc', async () => {
    const a = bytes('first file'),
      b = new Uint8Array([0, 1, 2, 255, 254]) as Uint8Array<ArrayBuffer>;
    const files = await read(
      makeZip([
        { name: 'demo - track 1.wav', data: a },
        { name: 'tåg - track 2.wav', data: b },
      ])
    );
    expect(files.map(f => f.name)).toEqual(['demo - track 1.wav', 'tåg - track 2.wav']);
    expect(Array.from(files[0].data)).toEqual(Array.from(a));
    expect(Array.from(files[1].data)).toEqual(Array.from(b));
    expect(files.every(f => f.crcOk)).toBe(true);
  });

  it('carries wav files of the same length for tracks of different length', async () => {
    const wav = (n: number) => {
      const d = new Float32Array(100);
      d.set(new Float32Array(n).fill(0.5));
      return new Uint8Array(wavBytes([d], 48000));
    };
    const files = await read(
      makeZip([
        { name: 'a.wav', data: wav(30) },
        { name: 'b.wav', data: wav(100) },
      ])
    );
    expect(files[0].data).toHaveLength(44 + 100 * 2);
    expect(files[1].data).toHaveLength(files[0].data.length);
  });
});

describe('wavBytes', () => {
  it('writes a mono 16-bit file', () => {
    const v = new DataView(wavBytes([new Float32Array([0, 1, -1])], 44100));
    expect(v.byteLength).toBe(44 + 3 * 2);
    expect(v.getUint16(22, true)).toBe(1); // channels
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(40, true)).toBe(6); // data bytes
    expect(v.getInt16(44 + 2, true)).toBe(32767);
    expect(v.getInt16(44 + 4, true)).toBe(-32768);
  });
});
