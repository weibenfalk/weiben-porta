import { autoLevel } from '../audio/autolevel.js';
import { ensureCtx, powerOff, setMonitors, setTrackData } from '../audio/engine.js';
import { listDevices, openMic } from '../audio/inputs.js';
import { mixChanged } from '../audio/mix.js';
import { mixdown } from '../audio/mixdown.js';
import { browserEstimate, calibrate, syncKey } from '../audio/sync.js';
import { contentEnd, nudge, play, record, seek, stop, undoTake } from '../audio/transport.js';
import { rt } from '../runtime.js';
import { S, idb, saveState, saveTrack, tape } from '../state.js';
import { $, clamp } from '../util.js';
import { frame } from './animation.js';
import { closeDlg, openDlg, wireDialogs } from './dialogs.js';
import { say } from './display.js';
import { buildMixerUI, paintArm, paintSources, paintSwitches, paintSync, toggleArm } from './mixerUI.js';
import { wireSkin } from './skin.js';
import { drawMap } from './tapeMap.js';
import { resample } from '../audio/resample.js';
/* Start-up: build the mixer, connect every button and key to what it does, load the saved tape. */

const dialog = (id: string) => $<HTMLDialogElement>(id);

/** The song title on the cassette and the metronome tempo. */
function wireFields() {
  $<HTMLInputElement>('title').value = S.title;
  $<HTMLInputElement>('bpm').value = String(S.bpm);
  $<HTMLInputElement>('title').addEventListener('input', e => {
    S.title = (e.target as HTMLInputElement).value;
    saveState();
  });
  $<HTMLInputElement>('bpm').addEventListener('change', e => {
    const field = e.target as HTMLInputElement;
    S.bpm = clamp(Math.round(+field.value) || 100, 40, 240);
    field.value = String(S.bpm);
    saveState();
  });
}

/** Power, the transport buttons, undo, mixdown and auto trim. */
function wireTransport() {
  $('power').addEventListener('click', async () => {
    if (rt.ctx && rt.ctx.state === 'running' && document.body.classList.contains('on')) powerOff();
    else {
      await ensureCtx();
      document.body.classList.add('on');
      $('power').setAttribute('aria-pressed', 'true');
      await openMic();
    }
  });
  $('play').addEventListener('click', play);
  $('stop').addEventListener('click', stop);
  $('rec').addEventListener('click', record);
  $('rtz').addEventListener('click', () => seek(0));
  $('undo').addEventListener('click', undoTake);
  $('mix').addEventListener('click', () => mixdown('wav'));
  $('mix3').addEventListener('click', () => mixdown('mp3'));
  $('auto').addEventListener('click', autoLevel);
  wireWinding($('rew'), -1);
  wireWinding($('ff'), 1);
}

/** Rewind and fast forward: the tape winds while the button is held. A keyboard press hops ten seconds. */
function wireWinding(btn: HTMLElement, dir: number) {
  const start = (e: PointerEvent) => {
    if (rt.transport !== 'stop' || rt.busy) return;
    rt.winding = dir;
    btn.classList.add('down');
    btn.setPointerCapture(e.pointerId);
  };
  const end = () => {
    rt.winding = 0;
    btn.classList.remove('down');
  };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
  btn.addEventListener('click', e => {
    if (e.detail === 0) seek(rt.pos + dir * 10);
  });
}

/** Measuring and adjusting the delay between playing and recording. */
function wireSync() {
  const measure = async () => {
    if (!rt.micOK) {
      await openMic();
      return;
    }
    calibrate();
  };
  $('sync').addEventListener('click', measure);
  $('syncAgain').addEventListener('click', measure);

  const bumpSync = (ms: number) => {
    if (!rt.ctx) {
      say('switch on first.');
      return;
    }
    rt.syncMs = Math.max(0, (rt.syncMs == null ? browserEstimate() : rt.syncMs) + ms);
    rt.syncMeasured = true;
    paintSync();
    try {
      localStorage.setItem(syncKey(), String(rt.syncMs));
    } catch (e) {}
  };
  $('syncMinus').addEventListener('click', () => bumpSync(-1));
  $('syncPlus').addEventListener('click', () => bumpSync(1));
  $('nudgeL').addEventListener('click', () => nudge(-5));
  $('nudgeR').addEventListener('click', () => nudge(5));
}

/** The sound card menus, and following the devices that come and go. */
function wireInputChoice() {
  const pickInput = (e: Event) => {
    const v = (e.target as HTMLSelectElement).value;
    if (!v) return;
    if (rt.transport !== 'stop' || rt.busy) {
      say('stop the tape first, then choose the input.');
      if (rt.stream) listDevices(rt.stream.getAudioTracks()[0].getSettings().deviceId);
      return;
    }
    if (v === '@default') {
      try {
        localStorage.setItem('weibenporta.input', '@default');
      } catch (e2) {}
      openMic();
    } else openMic(v);
  };
  $('device').addEventListener('change', pickInput);
  $('device2').addEventListener('change', pickInput);

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener)
    navigator.mediaDevices.addEventListener('devicechange', () => {
      if (rt.micOK) {
        listDevices($<HTMLSelectElement>('device').value);
        say('the sound devices changed. check sound card at the top if something sounds wrong.');
      }
    });
}

/** Monitor, click and tape sound switches. */
function wireSwitches() {
  $('monitor').addEventListener('click', async () => {
    if (!S.monitor && !rt.micOK) {
      if (!(await openMic())) return;
    }
    S.monitor = !S.monitor;
    setMonitors();
    paintSwitches();
    if (S.monitor) say('monitor on. wear headphones, or it will howl.');
  });
  $('click').addEventListener('click', () => {
    S.click = !S.click;
    paintSwitches();
    saveState();
    say(
      S.click
        ? `click on, ${S.bpm} beats a minute. you get four clicks before recording starts.`
        : 'click off.'
    );
  });
  $('tapeFx').addEventListener('click', () => {
    S.tapeFx = !S.tapeFx;
    paintSwitches();
    mixChanged();
  });
}

/** The bin: ask first, then erase all four tracks and the title. */
function wireNewTape() {
  $('fresh').addEventListener('click', () => openDlg(dialog('trashDlg')));
  $('trashOk').addEventListener('click', async () => {
    closeDlg(dialog('trashDlg'));
    await stop();
    for (let i = 0; i < 4; i++) {
      tape[i] = null;
      saveTrack(i);
    }
    rt.undo = null;
    $<HTMLButtonElement>('undo').disabled = true;
    rt.pos = 0;
    S.title = '';
    $<HTMLInputElement>('title').value = '';
    saveState();
    drawMap();
    say('new tape in. write the song title on the cassette.');
  });
}

/** Space plays and stops, R records, 1 to 4 arm tracks, Enter goes to the start. */
function wireKeyboard() {
  document.addEventListener('keydown', e => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === ' ') {
      if (tag === 'BUTTON' || tag === 'SUMMARY') return;
      e.preventDefault();
      rt.transport === 'stop' ? play() : stop();
    } else if (e.key === 'r' || e.key === 'R') record();
    else if (e.key >= '1' && e.key <= '4') toggleArm(+e.key - 1);
    else if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'SUMMARY') seek(0);
  });
}

/** Load the tape saved last time, then start the animation loop. */
async function loadTape() {
  if (await idb.open())
    for (let i = 0; i < 4; i++) {
      const t = await idb.get('t' + i);
      if (!t || !t.data || !t.data.length || tape[i]) continue;
      if (rt.ctx) setTrackData(i, resample(t.data, t.sr, rt.ctx.sampleRate));
      else tape[i] = { data: t.data, sr: t.sr, buf: null };
    }
  drawMap();
  if (contentEnd()) say('the tape from last time is in. press play.');
  requestAnimationFrame(frame);
}

export function startup() {
  buildMixerUI();
  paintArm();
  paintSources();
  paintSwitches();
  paintSync();
  wireFields();
  wireTransport();
  wireSync();
  wireInputChoice();
  wireDialogs();
  wireSkin();
  wireSwitches();
  wireNewTape();
  wireKeyboard();
  loadTape();
}
