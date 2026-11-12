import { rt } from '../runtime.js';
import { say } from '../ui/display.js';
import { paintLamps, paintSources, paintSync } from '../ui/mixerUI.js';
import { $, clamp } from '../util.js';
import { ensureCtx, routeInputs, setInputNode, setMonitors } from './engine.js';
import { calibrate, syncKey } from './sync.js';
import { chooseInput, nice } from './devices.js';
const gum = (id?: string) => {
  const audio: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 4 },
  };
  if (id) audio.deviceId = { exact: id };
  return navigator.mediaDevices.getUserMedia({ audio });
};
/** Open the microphone or sound card (the default, or the one with `deviceId`) and measure its delay. */
export async function openMic(deviceId?: string) {
  await ensureCtx();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    say('this browser will not let the page use a microphone. open the file in chrome, edge or firefox.');
    return false;
  }
  let st: MediaStream;
  rt.openNote = '';
  try {
    st = await gum(deviceId);
  } catch (e) {
    const name = (e as DOMException | undefined)?.name;
    if (deviceId) {
      rt.openNote = `could not open the chosen input (${name}).`;
      say(
        'could not open that input. is another program, such as a DAW, using it? close it and choose the input again.'
      );
      listDevices(rt.stream ? rt.stream.getAudioTracks()[0].getSettings().deviceId : '');
      return false;
    }
    say(
      name === 'NotAllowedError' || name === 'SecurityError'
        ? 'the microphone is blocked. allow it in the address bar of the browser and press record again.'
        : 'found no sound input. plug one in and press record again.'
    );
    return false;
  }
  if (!deviceId) {
    // the system default is often the laptop microphone: look for a sound card
    let better: MediaDeviceInfo | null = null;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      let want: string | null = null;
      try {
        want = localStorage.getItem('weibenporta.input');
      } catch (e) {}
      better = chooseInput(
        all.filter(d => d.kind === 'audioinput'),
        want,
        st.getAudioTracks()[0].label
      );
    } catch (e) {}
    if (better) {
      try {
        const st2 = await gum(better.deviceId);
        st.getTracks().forEach(t => t.stop());
        st = st2;
      } catch (e) {
        rt.openNote = `could not open ${nice(better.label)} (${(e as DOMException | undefined)?.name}). is another program, such as a DAW, using it?`;
      }
    }
  } else {
    try {
      localStorage.setItem('weibenporta.input', st.getAudioTracks()[0].label);
    } catch (e) {}
  }
  if (rt.stream)
    rt.stream.getTracks().forEach(t => {
      t.onended = null;
      t.stop();
    });
  rt.stream = st;
  const tr = st.getAudioTracks()[0],
    set = tr.getSettings();
  rt.micLabel = tr.label || 'microphone';
  tr.onended = () => {
    rt.micOK = false;
    say('the sound input disappeared. plug it in and switch on again.');
    paintLamps();
    setMonitors();
  };
  try {
    setInputNode(rt.ctx.createMediaStreamSource(st));
  } catch (e) {
    rt.openNote = 'createMediaStreamSource failed: ' + e;
    say('could not connect the input in this browser. try chrome or edge.');
    return false;
  }
  rt.micOK = true;
  rt.pkIn = [0, 0, 0, 0];
  rt.nIn = clamp(set.channelCount || 2, 1, 4);
  paintLamps();
  paintSources();
  routeInputs();
  listDevices(set.deviceId);
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(syncKey());
  } catch (e) {}
  if (saved != null && isFinite(+saved)) {
    rt.syncMs = +saved;
    rt.syncMeasured = true;
    paintSync();
    say(`recording from ${nice(rt.micLabel)}. sync ${rt.syncMs} ms.`);
  } else {
    rt.syncMs = null;
    rt.syncMeasured = false;
    await calibrate();
  }
  if (rt.openNote) say(`${rt.openNote} recording from ${nice(rt.micLabel)} instead.`);
  return true;
}
/** Fill both sound card menus with the inputs the browser can see, and select `current`. */
export async function listDevices(current?: string) {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const ins = all.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications');
    rt.seenInputs = ins.map(d => ({ label: d.label || '(no name)', active: d.deviceId === current }));
    const real = ins.filter(d => d.deviceId !== 'default'),
      hit = real.some(d => d.deviceId === current);
    const defName = ins.find(d => d.deviceId === 'default')?.label;
    [$<HTMLSelectElement>('device'), $<HTMLSelectElement>('device2')].forEach(sel => {
      sel.innerHTML = '';
      const o0 = document.createElement('option');
      o0.value = '@default';
      o0.textContent = "computer's default" + (defName ? ': ' + nice(defName) : '');
      o0.selected = !hit;
      sel.appendChild(o0);
      real.forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label ? nice(d.label) : 'input ' + (i + 1);
        o.selected = d.deviceId === current;
        sel.appendChild(o);
      });
    });
  } catch (e) {}
}
