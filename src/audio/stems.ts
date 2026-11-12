import { rt } from '../runtime.js';
import { tape } from '../state.js';
import { say } from '../ui/display.js';
import { sleep } from '../util.js';
import { names } from './engine.js';
import { fileBase, saveBlob } from './mixdown.js';
import { contentEnd } from './transport.js';
import { wavBytes } from './wav.js';
import { makeZip, type ZipEntry } from './zip.js';
/* Export the raw tracks: each recorded track as its own mono wav, as it sits on the tape (after the
   input trim, before the fader, eq, pan and effects), in one zip. Every file starts at the start of
   the tape and has the same length, so they line up when dropped into a mixing program at 0:00. */

export /** Save the recorded tracks as a zip of wav files. */
async function exportTracks() {
  if (rt.busy || rt.transport !== 'stop') {
    say('stop the tape first.');
    return;
  }
  const have = [0, 1, 2, 3].filter(i => tape[i]);
  if (!have.length) {
    say('the tape is empty. record something first.');
    return;
  }
  rt.busy = true;
  try {
    const end = contentEnd(),
      base = fileBase(),
      files: ZipEntry[] = [];
    for (const i of have) {
      say(`packing track ${i + 1} …`, { quiet: true });
      await sleep(0);
      const t = tape[i]!,
        d = new Float32Array(Math.max(t.data.length, Math.round(end * t.sr)));
      d.set(t.data);
      files.push({ name: `${base} - track ${i + 1}.wav`, data: new Uint8Array(wavBytes([d], t.sr)) });
    }
    const name = `${base} - tracks.zip`;
    saveBlob(makeZip(files), name);
    say(`done. ${name} is in your downloads: ${names(have)}, all starting at the start of the tape.`);
  } catch (e) {
    say('could not pack the tracks. try again with a shorter tape.');
  }
  rt.busy = false;
}
