import './styles/base.css';
import './styles/machine.css';
import './styles/bay.css';
import './styles/mixer.css';
import './styles/dialogs.css';
import workletSrc from './audio/tape-rec.worklet.js?raw';
import { TAPE, MIX_DELAY, COLORS, TRIM_RANGE, EQ_RANGE } from './config.js';
import { $, clamp, sleep, reduceMotion, h, dbToGain } from './util.js';
import { S, saveState, tape, idb, saveTrack } from './state.js';
import { makeIR, buildMixer, applyMix } from './audio/graph.js';
import { controls, control, vuSVG, knobCell, faderCell } from './ui/controls.js';

let irT = 0;
const refreshIR = () => { clearTimeout(irT); irT = setTimeout(() => { if (live) live.rev.buffer = makeIR(ctx, S.revLen); }, 160); };
const mixChanged = () => { if (live) applyMix(live, ctx, false); saveState(); };
const needles = [], armBtns = [], srcSels = [];
let undo = null;
let ctx = null, live = null, speakerBus = null, clickBus = null;
let splitIn, recMerge, rawAn = [], trackIn = [], mon = [], inputSrc = null, stream = null, nIn = 2, monMute = false;
let pkIn = [0,0,0,0], seenInputs = [], lastTake = null, openNote = '';
let micOK = false, micLabel = '', syncMs = null, syncMeasured = false;
let transport = 'stop', pos = 0, t0 = 0, pos0 = 0, recPos0 = 0, recTracks = [], srcs = [null,null,null,null];
let busy = false, winding = 0, clickTimer = 0, nextK = 0, beatLen = .6;

/* ---------- Display ---------- */
const dialText = $('dialText'), dialInner = $('dialInner');
const fitDial = () => { dialInner.classList.remove('run'); const over = Math.ceil(dialInner.offsetWidth - dialText.clientWidth);
  if (over > 2) { void dialInner.offsetWidth; dialInner.classList.add('run'); dialInner.style.setProperty('--shift', over + 'px'); dialInner.style.setProperty('--dur', (over / 60 + 2.5).toFixed(1) + 's'); } };
addEventListener('resize', fitDial);
const say = t => { dialInner.textContent = t; fitDial(); const d2 = document.getElementById('dial2'); if (d2) d2.textContent = t; };

/* ---------- recorder (sample-exact capture on the audio thread) ---------- */
const WORKLET = workletSrc;
const concat = chunks => { let n = 0; chunks.forEach(c => n += c.length); const out = new Float32Array(n); let o = 0;
  chunks.forEach(c => { out.set(c, o); o += c.length; }); return out; };
const rec = {
  node:null, mode:'', chunks:[[],[],[],[]], resolve:null, sp:null, stats:null, mask:[true,true,true,true],
  async init(){
    const mute = ctx.createGain(); mute.gain.value = 0; mute.connect(ctx.destination);
    try {
      // A page opened straight from disk may not load blob: modules, so try a data: address first.
      try { await ctx.audioWorklet.addModule('data:application/javascript;charset=utf-8,' + encodeURIComponent(WORKLET)); }
      catch (e1) { await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], {type:'application/javascript'}))); }
      this.node = new AudioWorkletNode(ctx, 'tape-rec', {numberOfInputs:1, numberOfOutputs:1, channelCount:4, channelCountMode:'explicit', channelInterpretation:'discrete'});
      this.node.port.onmessage = e => {
        if (e.data.chunk) e.data.chunk.forEach((c, k) => { if (c) this.chunks[k].push(c); });
        else if (e.data.done && this.resolve) { this.stats = {z:e.data.z, b:e.data.b, d:e.data.d}; const r = this.resolve; this.resolve = null; r(this.chunks.map(concat)); }
      };
      this.mode = 'worklet';
    } catch (err) {
      // Older browsers: less exact, still usable after a sync measurement.
      const sp = ctx.createScriptProcessor(4096, 4, 1); sp.channelCount = 4; sp.channelCountMode = 'explicit'; sp.channelInterpretation = 'discrete';
      this.sp = {on:false, start:0, next:-1};
      sp.onaudioprocess = e => { const s = this.sp; if (!s.on) return;
        const len = e.inputBuffer.length;
        if (s.next < 0) s.next = Math.round(ctx.currentTime * ctx.sampleRate) - len;
        const a = s.next; s.next += len;
        if (a + len <= s.start) return;
        const off = a < s.start ? s.start - a : 0;
        for (let c = 0; c < 4; c++) if (this.mask[c]) this.chunks[c].push(e.inputBuffer.getChannelData(c).slice(off)); };
      this.node = sp; this.mode = 'fallback';
    }
    this.node.connect(mute);
  },
  start(frame, mask){ this.mask = mask || [true,true,true,true]; this.chunks = [[],[],[],[]]; this.stats = null;
    if (this.mode === 'worklet') this.node.port.postMessage({cmd:'start', frame, mask:this.mask});
    else { this.sp.start = frame; this.sp.next = -1; this.sp.on = true; } },
  stop(){ return new Promise(res => {
    if (this.mode === 'worklet') { this.resolve = res; this.node.port.postMessage({cmd:'stop'}); }
    else { this.sp.on = false; res(this.chunks.map(concat)); } }); }
};

/* ---------- power and microphone ---------- */
function resample(data, from, to){
  if (from === to) return data;
  const n = Math.floor(data.length * to / from), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) { const x = i * r, j = Math.floor(x), f = x - j;
    out[i] = data[j] * (1 - f) + (data[j + 1] || 0) * f; }
  return out;
}
function setTrackData(i, data){
  if (!data || !data.length) { tape[i] = null; return; }
  const sr = ctx.sampleRate, buf = ctx.createBuffer(1, data.length, sr);
  buf.copyToChannel(data, 0);
  tape[i] = {data:buf.getChannelData(0), sr, buf};
}
let ctxReady = null;
function ensureCtx(){
  if (ctx) { if (ctx.state !== 'running') ctx.resume();
    document.body.classList.add('on'); $('power').setAttribute('aria-pressed', 'true'); return ctxReady; }
  const AC = window.AudioContext || window.webkitAudioContext;
  const saved = tape.find(t => t);
  try { ctx = new AC(saved ? {sampleRate:saved.sr, latencyHint:'interactive'} : {latencyHint:'interactive'}); }
  catch (e) { ctx = new AC(); }
  if (ctx.sampleRate > 48000) {      // a sound card set to 96 or 192 kHz would only waste processor time here
    try { const c2 = new AC({sampleRate:48000, latencyHint:'interactive'}); ctx.close(); ctx = c2; } catch (e) {} }
  ctx.resume();
  speakerBus = ctx.createGain(); speakerBus.connect(ctx.destination);
  clickBus = ctx.createGain(); clickBus.gain.value = .5; clickBus.connect(speakerBus);
  live = buildMixer(ctx, speakerBus); applyMix(live, ctx, true); live.rev.buffer = makeIR(ctx, S.revLen);
  live.ch.forEach(c => { c.an = ctx.createAnalyser(); c.an.fftSize = 1024; c.input.connect(c.an); });
  splitIn = ctx.createChannelSplitter(4); recMerge = ctx.createChannelMerger(4);
  for (let k = 0; k < 4; k++) {
    const a = ctx.createAnalyser(); a.fftSize = 1024; splitIn.connect(a, k); rawAn.push(a);
    const g = ctx.createGain(); g.channelCount = 1; g.channelCountMode = 'explicit'; g.gain.value = dbToGain(S.tracks[k].trim);
    g.connect(recMerge, 0, k); trackIn.push(g);
    const m = ctx.createGain(); m.gain.value = 0; g.connect(m); m.connect(live.ch[k].input); mon.push(m); }
  routeInputs();
  tape.forEach((t, i) => { if (t) setTrackData(i, resample(t.data, t.sr, ctx.sampleRate)); });
  document.body.classList.add('on'); $('power').setAttribute('aria-pressed', 'true');
  ctxReady = rec.init().then(() => { recMerge.connect(rec.node); });
  return ctxReady;
}
function setInputNode(node){
  if (inputSrc) { try { inputSrc.disconnect(splitIn); } catch (e) {} }
  inputSrc = node; node.connect(splitIn);
}
const syncKey = () => 'weibenporta.sync.' + micLabel + '.' + ctx.sampleRate;
function browserEstimate(){
  let est = (ctx.outputLatency || ctx.baseLatency || .02);
  try { const st = stream && stream.getAudioTracks()[0].getSettings(); est += (st && st.latency) || .01; } catch (e) { est += .01; }
  return Math.round(est * 1000);
}
const BUILTIN = /built-?in|inbyggd|\bintern|macbook|imac|mikrofonmatris|microphone array|realtek|conexant|cirrus|\bintel\b|webcam|camera|kamera|\bcam\b|logitech|\blogi\b|brio|facetime|iphone|\bphone|telefon|mobil|ipad|continuity|airpods|bluetooth|hands-?free|headset|headphone|buds|beats|jabra|plantronics|\bpoly\b|bose|virtual|blackhole|loopback|soundflower|zoom ?audio|teams|stereo ?mix|vb-audio|voicemeeter|\bobs\b|\bndi\b|elgato|hdmi|display|monitor of|steam|krisp|nvidia/i;
const KNOWN = /usb|interface|focusrite|scarlett|clarett|behringer|umc|u-?phoria|presonus|audiobox|steinberg|\bur\d|motu|universal audio|apollo|\bvolt\b|\brme\b|babyface|fireface|\bssl\b|audient|\bevo\b|\bid\d|zoom [a-z]{1,3}-?\d|tascam|roland|rubix|m-audio|m-track|komplete|native instruments|arturia|minifuse|audiofuse|line ?6|helix|irig|apogee|\bduet\b|antelope|mackie|onyx|yamaha|\bag0\d|soundcraft|lexicon|mixer|line in|analogue?|instrument/i;
const stripDef = l => (l || '').replace(/^(default|standard|communications|kommunikation(er)?)\s*-\s*/i, '');
const nice = l => stripDef(l).replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '') || 'microphone';
function chooseInput(ins, remembered, curLabel){
  if (remembered === '@default') return null;      // the user asked to follow the computer's own setting
  ins = ins.filter(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  let hit = remembered && ins.find(d => d.label === remembered);
  if (!hit) { const ext = ins.filter(d => d.label && !BUILTIN.test(d.label)); hit = ext.find(d => KNOWN.test(d.label)) || ext.find(d => !/mic|mikrofon/i.test(d.label)) || ext[0]; }
  if (!hit || stripDef(hit.label) === stripDef(curLabel)) return null;
  return hit;
}
const gum = id => { const audio = {echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:{ideal:4}};
  if (id) audio.deviceId = {exact:id}; return navigator.mediaDevices.getUserMedia({audio}); };
async function openMic(deviceId){
  await ensureCtx();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    say('this browser will not let the page use a microphone. open the file in chrome, edge or firefox.'); return false; }
  let st; openNote = '';
  try { st = await gum(deviceId); }
  catch (e) {
    const name = e && e.name;
    if (deviceId) { openNote = `could not open the chosen input (${name}).`; say('could not open that input. is another program, such as a DAW, using it? close it and choose the input again.'); listDevices(stream ? stream.getAudioTracks()[0].getSettings().deviceId : ''); return false; }
    say(name === 'NotAllowedError' || name === 'SecurityError'
      ? 'the microphone is blocked. allow it in the address bar of the browser and press record again.'
      : 'found no sound input. plug one in and press record again.');
    return false;
  }
  if (!deviceId) {          // the system default is often the laptop microphone: look for a sound card
    let better = null;
    try { const all = await navigator.mediaDevices.enumerateDevices(); let want = null;
      try { want = localStorage.getItem('weibenporta.input'); } catch (e) {}
      better = chooseInput(all.filter(d => d.kind === 'audioinput'), want, st.getAudioTracks()[0].label); } catch (e) {}
    if (better) { try { const st2 = await gum(better.deviceId); st.getTracks().forEach(t => t.stop()); st = st2; }
      catch (e) { openNote = `could not open ${nice(better.label)} (${e && e.name}). is another program, such as a DAW, using it?`; } }
  } else { try { localStorage.setItem('weibenporta.input', st.getAudioTracks()[0].label); } catch (e) {} }
  if (stream) stream.getTracks().forEach(t => { t.onended = null; t.stop(); });
  stream = st;
  const tr = st.getAudioTracks()[0], set = tr.getSettings();
  micLabel = tr.label || 'microphone';
  tr.onended = () => { micOK = false; say('the sound input disappeared. plug it in and switch on again.'); paintLamps(); setMonitors(); };
  try { setInputNode(ctx.createMediaStreamSource(st)); }
  catch (e) { openNote = 'createMediaStreamSource failed: ' + e; say('could not connect the input in this browser. try chrome or edge.'); return false; }
  micOK = true; pkIn = [0,0,0,0]; nIn = clamp(set.channelCount || 2, 1, 4);
  paintLamps(); paintSources(); routeInputs(); listDevices(set.deviceId);
  let saved = null; try { saved = localStorage.getItem(syncKey()); } catch (e) {}
  if (saved != null && isFinite(+saved)) { syncMs = +saved; syncMeasured = true; paintSync();
    say(`recording from ${nice(micLabel)}. sync ${syncMs} ms.`); }
  else { syncMs = null; syncMeasured = false; await calibrate(); }
  if (openNote) say(`${openNote} recording from ${nice(micLabel)} instead.`);
  return true;
}
function routeInputs(){
  if (!ctx) return;
  S.tracks.forEach((tr, i) => { if (!(tr.src < nIn)) tr.src = 0;
    try { splitIn.disconnect(trackIn[i]); } catch (e) {}
    splitIn.connect(trackIn[i], tr.src); });
  setMonitors();
}
function setMonitors(){ if (!ctx) return; mon.forEach((m, i) => m.gain.setTargetAtTime(S.monitor && S.arm[i] && micOK && !monMute ? 1 : 0, ctx.currentTime, .015)); }
function setTrim(){ if (!ctx) return; trackIn.forEach((n, i) => n.gain.setTargetAtTime(dbToGain(S.tracks[i].trim), ctx.currentTime, .02)); }
const trimOf = i => dbToGain(S.tracks[i].trim);
const armed = () => [0,1,2,3].filter(i => S.arm[i]);
const names = list => list.length === 1 ? `track ${list[0] + 1}` : 'tracks ' + list.slice(0, -1).map(i => i + 1).join(', ') + ' and ' + (list[list.length - 1] + 1);
async function listDevices(current){
  try { const all = await navigator.mediaDevices.enumerateDevices();
    const ins = all.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications');
    seenInputs = ins.map(d => ({label:d.label || '(no name)', active:d.deviceId === current}));
    const real = ins.filter(d => d.deviceId !== 'default'), hit = real.some(d => d.deviceId === current);
    const defName = (ins.find(d => d.deviceId === 'default') || {}).label;
    [$('device'), $('device2')].forEach(sel => { sel.innerHTML = '';
      const o0 = document.createElement('option'); o0.value = '@default'; o0.textContent = "computer's default" + (defName ? ': ' + nice(defName) : ''); o0.selected = !hit; sel.appendChild(o0);
      real.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label ? nice(d.label) : 'input ' + (i + 1); o.selected = d.deviceId === current; sel.appendChild(o); }); });
  } catch (e) {}
}
const dB = x => x > 1e-6 ? (20 * Math.log10(x)).toFixed(1) + ' dBFS' : 'silent';
const msT = x => x == null || !isFinite(x) ? 'n/a' : Math.round(x * 1000) + ' ms';
function diagText(){
  const L = ['Weiben Porta diagnostics', 'browser: ' + navigator.userAgent, 'page: ' + location.protocol];
  if (!ctx) { L.push('audio: not switched on yet'); return L.join('\n'); }
  L.push(`audio: ${ctx.sampleRate} Hz, ${ctx.state}, base latency ${msT(ctx.baseLatency)}, output latency ${msT(ctx.outputLatency)}`);
  L.push('recorder: ' + (rec.mode === 'worklet' ? 'audio thread (exact)' : 'fallback on main thread (may crackle)'));
  L.push('inputs found:'); seenInputs.forEach(d => L.push((d.active ? '  > ' : '    ') + d.label));
  if (stream) { const tr = stream.getAudioTracks()[0]; let st = {}; try { st = tr.getSettings(); } catch (e) {}
    L.push(`active input: ${tr.label} (${tr.readyState}${tr.muted ? ', muted' : ''})`);
    L.push('  ' + ['channelCount','sampleRate','echoCancellation','autoGainControl','noiseSuppression','latency'].map(k => k + '=' + st[k]).join(', ')); }
  else L.push('active input: none');
  if (openNote) L.push('note: ' + openNote);
  L.push(`inputs on this card: ${nIn}; recent peaks: ${pkIn.slice(0, nIn).map((p, k) => 'in ' + (k + 1) + ' ' + dB(p)).join(', ')}`);
  L.push('tracks: ' + S.tracks.map((t, i) => `${i + 1} from in ${t.src + 1}${S.arm[i] ? ' (armed)' : ''}`).join(', '));
  L.push(`trim: ${S.tracks.map((t, i) => (i + 1) + ' ' + t.trim + ' dB').join(', ')}; eq lo/hi: ${S.tracks.map((t, i) => (i + 1) + ' ' + t.lo + '/' + t.hi).join(', ')}; sync: ${syncMs == null ? 'none' : syncMs + ' ms ' + (syncMeasured ? '(measured)' : '(estimate)')}; tape sound: ${S.tapeFx ? 'on' : 'off'}`);
  if (lastTake) { lastTake.tracks.forEach(t => L.push(`last take, track ${t.track + 1} from in ${t.src + 1}: ${t.sec.toFixed(1)} s, peak ${dB(t.peak)}, clipped samples ${t.clipN}`));
    L.push(`last take: dropouts ${lastTake.drops == null ? 'n/a' : lastTake.drops}, silent blocks ${lastTake.zero == null ? 'n/a' : lastTake.zero + '/' + lastTake.blocks}`); }
  return L.join('\n');
}
async function powerOff(){
  await stop();
  if (stream) { stream.getTracks().forEach(t => { t.onended = null; t.stop(); }); stream = null; }
  if (inputSrc) { try { inputSrc.disconnect(); } catch (e) {} inputSrc = null; }
  micOK = false; S.monitor = false; setMonitors(); paintSwitches(); paintLamps();
  if (ctx) ctx.suspend();
  document.body.classList.remove('on'); $('power').setAttribute('aria-pressed', 'false');
  say('switched off. the tape stays in.');
}

/* ---------- sync: measure the round trip speaker -> microphone ---------- */
function analyseCal(raw, sr, N, gap){
  const W = Math.round(gap * sr), F = Math.max(8, Math.round(sr * .005)), e = [];
  for (let i = 0; i + F <= raw.length; i += F) { let s = 0; for (let j = 0; j < F; j++) s += raw[i + j] * raw[i + j]; e.push(Math.sqrt(s / F)); }
  e.sort((a, b) => a - b);
  const floor = e[Math.floor(e.length * .3)] || 0, hits = [];
  for (let k = 0; k < N; k++) { const a = k * W, b = Math.min(raw.length, a + W); let p = 0;
    for (let i = a; i < b; i++) { const v = Math.abs(raw[i]); if (v > p) p = v; }
    if (p < Math.max(2e-4, floor * 8)) continue;
    const th = p * .35;
    for (let i = a; i < b; i++) if (Math.abs(raw[i]) >= th) { hits.push((i - a) / sr); break; } }
  if (hits.length < 3) return null;
  hits.sort((a, b) => a - b);
  const med = hits[hits.length >> 1], close = hits.filter(x => Math.abs(x - med) < .004);
  if (close.length < 3) return null;
  return close.reduce((a, b) => a + b, 0) / close.length;
}
let calBuf = null;
function calClickAt(t){
  const sr = ctx.sampleRate;
  if (!calBuf) { const n = Math.round(sr * .004); calBuf = ctx.createBuffer(1, n, sr); const d = calBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = .5 * Math.sin(2 * Math.PI * 3000 * i / sr + Math.PI / 2) * Math.exp(-i / (sr * .0012)); }
  const s = ctx.createBufferSource(); s.buffer = calBuf; s.connect(speakerBus); s.start(t);
}
async function calibrate(){
  if (busy || transport !== 'stop' || !micOK) return null;
  busy = true; say('measuring the delay. five clicks coming up.');
  const sr = ctx.sampleRate, N = 5, gap = .45;
  monMute = true; setMonitors();
  const f0 = Math.round((ctx.currentTime + .3) * sr);
  rec.start(f0, [true,true,true,true]);
  for (let k = 0; k < N; k++) calClickAt(f0 / sr + k * gap);
  await sleep((.3 + N * gap + .25) * 1000);
  const raws = await rec.stop();
  monMute = false; setMonitors(); busy = false;
  let r = null;      // listen on the armed tracks' inputs first, then the others
  for (const k of [0,1,2,3].sort((a, b) => (S.arm[b] ? 1 : 0) - (S.arm[a] ? 1 : 0))) { r = analyseCal(raws[k], sr, N, gap); if (r != null) break; }
  if (r == null) {
    if (!syncMeasured) syncMs = browserEstimate();
    paintSync();
    say(`heard no clicks on ${nice(micLabel)}. using ${syncMs} ms for now. hold an earcup to the mic, or patch the sound card output to its input, then press sync.`);
    return null;
  }
  syncMs = Math.round(r * 1000); syncMeasured = true; paintSync();
  try { localStorage.setItem(syncKey(), String(syncMs)); } catch (e) {}
  say(syncMs > 120
    ? `${nice(micLabel)}: in sync, ${syncMs} ms. a delay that long usually means bluetooth. takes still land in time, but keep monitor off.`
    : `${nice(micLabel)}: in sync, ${syncMs} ms. press record when you are ready.`);
  return syncMs;
}
const totalLatency = () => (syncMs == null ? browserEstimate() : syncMs) / 1000 + MIX_DELAY;

/* ---------- automatic input level ---------- */
async function autoLevel(){
  if (busy || transport !== 'stop') return;
  if (!micOK) { if (!(await openMic())) return; }
  const targets = armed().length ? armed() : [0,1,2,3];
  const ins = [...new Set(targets.map(i => S.tracks[i].src))];
  busy = true; const buf = new Float32Array(1024), peaks = {}; ins.forEach(k => peaks[k] = 0);
  for (let s = 4; s > 0; s--) {
    say(`play or sing as loud as you are going to. listening for ${s} s.`);
    for (let i = 0; i < 40; i++) { ins.forEach(k => { rawAn[k].getFloatTimeDomainData(buf);
        for (let j = 0; j < buf.length; j++) { const v = Math.abs(buf[j]); if (v > peaks[k]) peaks[k] = v; } });
      await sleep(22); }
  }
  busy = false;
  const heard = targets.filter(i => peaks[S.tracks[i].src] >= .002);
  if (!heard.length) { say('heard almost nothing. check the input chosen under each track number, and that input at the top shows the right sound card.'); return; }
  heard.forEach(i => { const tr = S.tracks[i];
    tr.trim = clamp(Math.round(20 * Math.log10(.5 / peaks[tr.src])), TRIM_RANGE[0], TRIM_RANGE[1]);
    controls.trim[i].set(tr.trim, false); });
  setTrim(); saveState();
  say(`trim set on ${names(heard)} (${heard.map(i => (S.tracks[i].trim > 0 ? '+' : '') + S.tracks[i].trim).join(', ')} dB). the needle should reach about 0 when you play loud.`);
}

/* ---------- transport ---------- */
const contentEnd = () => tape.reduce((m, t) => t ? Math.max(m, t.data.length / t.sr) : m, 0);
const curPos = () => transport === 'stop' ? pos : Math.min(TAPE, pos0 + Math.max(0, ctx.currentTime - t0));

function clickAt(t, accent){
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1600 : 1100; g.gain.setValueAtTime(accent ? 1 : .7, t); g.gain.exponentialRampToValueAtTime(.001, t + .04);
  o.connect(g); g.connect(clickBus); o.start(t); o.stop(t + .05);
}
function startClicks(countIn){
  stopClicks(); if (!S.click) return;
  nextK = Math.ceil((pos0 - (countIn ? 4 * beatLen : 0)) / beatLen - 1e-6);
  const tick = () => { const horizon = ctx.currentTime + .2;
    for (;;) { const t = t0 + (nextK * beatLen - pos0); if (t > horizon) break;
      if (t >= ctx.currentTime - .005) clickAt(Math.max(t, ctx.currentTime), ((nextK % 4) + 4) % 4 === 0); nextK++; } };
  tick(); clickTimer = setInterval(tick, 50);
}
function stopClicks(){ clearInterval(clickTimer); clickTimer = 0; }

function startRun(recording){
  const sr = ctx.sampleRate; beatLen = 60 / clamp(S.bpm || 100, 40, 240);
  const countIn = recording && S.click ? 4 * beatLen : 0;
  pos0 = pos; t0 = Math.round((ctx.currentTime + .12 + countIn) * sr) / sr;
  tape.forEach((t, i) => { srcs[i] = null;
    if (!t || !t.buf || (recording && S.arm[i]) || pos0 >= t.buf.duration) return;
    const s = ctx.createBufferSource(); s.buffer = t.buf; s.connect(live.ch[i].input); s.start(t0, pos0); srcs[i] = s; });
  if (recording) { recTracks = armed(); recPos0 = pos0; rec.start(Math.round(t0 * sr), S.arm.slice()); }
  startClicks(countIn > 0);
  transport = recording ? 'rec' : 'play'; paintTransport();
  return countIn > 0;
}
async function play(){
  if (busy || transport !== 'stop') return;
  const end = contentEnd();
  if (!end) { say('the tape is empty. press record.'); return; }
  await ensureCtx();
  if (pos >= end - .05) pos = 0;
  startRun(false); say('playing.');
}
async function record(){
  if (busy || transport === 'rec') return;
  if (!micOK) { if (await openMic()) { /* the dial already says what to do next */ } return; }
  if (!armed().length) { say('no track is switched on for recording. press 1, 2, 3 or 4 first.'); return; }
  if (transport === 'play') {            // punch in while the tape rolls
    const sr = ctx.sampleRate, f = Math.round((ctx.currentTime + .03) * sr), tp = f / sr;
    recTracks = armed(); recPos0 = pos0 + (tp - t0);
    recTracks.forEach(i => { if (srcs[i]) { try { srcs[i].stop(tp); } catch (e) {} } });
    rec.start(f, S.arm.slice()); transport = 'rec'; paintTransport(); say(`recording on ${names(recTracks)}.`); return;
  }
  if (pos >= TAPE - .5) { say('end of tape. press to start.'); return; }
  const counted = startRun(true);
  say(counted ? `four clicks, then you are recording on ${names(recTracks)}.` : `recording on ${names(recTracks)}.`);
}
async function stop(){
  if (transport === 'stop') return;
  const was = transport; pos = curPos();
  srcs.forEach(s => { if (s) { try { s.stop(); } catch (e) {} } }); srcs = [null,null,null,null];
  stopClicks(); transport = 'stop'; paintTransport();
  if (was === 'rec') { busy = true; try { await finishRecording(); } finally { busy = false; } }
  else say('stopped.');
}
async function finishRecording(){
  const raws = await rec.stop(), sr = ctx.sampleRate, L = Math.round(totalLatency() * sr);
  const stt = rec.stats, done = [], silent = [], undoList = [], info = []; let clipped = false, hot = false, short = false;
  for (const i of recTracks) {
    const raw = raws[i] || new Float32Array(0), take = raw.subarray(Math.min(L, raw.length));
    if (take.length < sr * .1) { short = true; continue; }
    const start = Math.round(recPos0 * sr), n = Math.min(take.length, TAPE * sr - start);
    let peak = 0, clipN = 0;
    for (let k = 0; k < n; k++) { const a = Math.abs(take[k]); if (a > peak) peak = a; if (a / trimOf(i) >= .985) clipN++; }
    info.push({track:i, src:S.tracks[i].src, sec:n / sr, peak, clipN});
    if (peak < .0005) { silent.push(i); continue; }
    const old = tape[i], data = new Float32Array(Math.max(old ? old.data.length : 0, start + n));
    if (old) data.set(old.data);
    const fade = Math.min(Math.round(sr * .004), n >> 1);
    for (let k = 0; k < n; k++) { let g = 1; if (k < fade) g = k / fade; else if (k > n - fade) g = (n - k) / fade; data[start + k] = take[k] * g; }
    undoList.push({track:i, prev:old}); setTrackData(i, data); saveTrack(i); done.push(i);
    if (clipN > 20) clipped = true; else if (peak > 1) hot = true;
  }
  if (info.length) lastTake = {tracks:info, drops:stt ? stt.d : null, zero:stt ? stt.z : null, blocks:stt ? stt.b : null};
  if (undoList.length) { undo = undoList; $('undo').disabled = false; }
  drawMap();
  if (!done.length && !silent.length) { say(short ? 'that take was too short. press record and try again.' : 'nothing was recorded.'); return; }
  const loud = pkIn.findIndex((pk, k) => k < nIn && pk > .01);
  const tip = silent.length && loud >= 0 && silent.some(i => S.tracks[i].src !== loud)
    ? ` there is sound on in ${loud + 1}: choose in ${loud + 1} under the track number.`
    : ' check the input chosen under the track number, and the gain on the sound card.';
  if (!done.length) { say(`nothing reached ${names(silent)}: the input was silent.${tip}`); return; }
  let msg = `${names(done)} recorded.`;
  if (silent.length) msg += ` ${names(silent)} heard nothing.${tip}`;
  if (clipped) msg += ' the signal was already clipping when it arrived: turn down the input gain on the sound card or in the system sound settings.';
  else if (hot) msg += ' it was recorded too hot: turn the trim knob down and record again.';
  else if (lastTake.drops > 2) msg += ` the sound dropped out ${lastTake.drops} times: close other audio programs, then open settings and copy the diagnostics.`;
  else if (!silent.length) msg += ' press to start and listen, or switch on the next track.';
  say(msg);
}
function seek(p){
  p = clamp(p, 0, TAPE);
  if (transport === 'rec' || busy) return;
  if (transport === 'play') { srcs.forEach(s => { if (s) { try { s.stop(); } catch (e) {} } }); stopClicks(); transport = 'stop'; pos = p; startRun(false); }
  else pos = p;
}
function undoTake(){
  if (!undo || transport !== 'stop' || busy) return;
  undo.forEach(u => { tape[u.track] = u.prev; saveTrack(u.track); });
  say(`the last take on ${names(undo.map(u => u.track))} is removed.`);
  undo = null; $('undo').disabled = true; drawMap();
}
function nudge(ms){
  const list = armed().filter(i => tape[i]);
  if (!list.length || transport !== 'stop' || busy || !ctx) { say('switch on a track that has a recording, and stop the tape first.'); return; }
  list.forEach(i => { const t = tape[i], n = Math.round(Math.abs(ms) / 1000 * t.sr); let d;
    if (ms > 0) { d = new Float32Array(t.data.length + n); d.set(t.data, n); } else d = t.data.slice(n);
    setTrackData(i, d); saveTrack(i); });
  drawMap(); say(`${names(list)} moved ${Math.abs(ms)} ms ${ms > 0 ? 'later' : 'earlier'}.`);
}

/* ---------- mixdown ---------- */
async function renderMix(){
  const end = contentEnd(); if (!end) return null;
  await ensureCtx();
  const sr = ctx.sampleRate, tail = 1.2 + S.revLen + (S.tracks.some(t => t.eko > .02) ? 2.5 : 0);
  const oc = new OfflineAudioContext(2, Math.ceil((end + tail) * sr), sr);
  const m = buildMixer(oc, oc.destination); applyMix(m, oc, true); m.rev.buffer = makeIR(oc, S.revLen);
  tape.forEach((t, i) => { if (!t) return; const b = oc.createBuffer(1, t.data.length, sr); b.copyToChannel(t.data, 0);
    const s = oc.createBufferSource(); s.buffer = b; s.connect(m.ch[i].input); s.start(0); });
  return oc.startRendering();
}
function encodeWav(buf){
  const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate, v = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const d = []; for (let c = 0; c < ch; c++) d.push(buf.getChannelData(c));
  let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const x = clamp(d[c][i], -1, 1); v.setInt16(o, x < 0 ? x * 32768 : x * 32767, true); o += 2; }
  return new Blob([v.buffer], {type:'audio/wav'});
}
async function encodeMp3(buf, onProgress){
  const sr = buf.sampleRate, n = buf.length, L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const enc = new lamejs.Mp3Encoder(2, sr, 320), parts = [], B = 1152 * 32, l16 = new Int16Array(B), r16 = new Int16Array(B);
  let last = performance.now();
  for (let i = 0; i < n; i += B) { const m = Math.min(B, n - i);
    for (let k = 0; k < m; k++) { let x = L[i + k], y = R[i + k]; x = x < -1 ? -1 : x > 1 ? 1 : x; y = y < -1 ? -1 : y > 1 ? 1 : y;
      l16[k] = x < 0 ? x * 32768 : x * 32767; r16[k] = y < 0 ? y * 32768 : y * 32767; }
    const out = enc.encodeBuffer(l16.subarray(0, m), r16.subarray(0, m)); if (out.length) parts.push(new Uint8Array(out));
    if (performance.now() - last > 80) { onProgress(Math.round(i / n * 100)); await sleep(0); last = performance.now(); } }
  const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, {type:'audio/mpeg'});
}
async function mixdown(kind){
  if (busy || transport !== 'stop') { say('stop the tape first.'); return; }
  if (!contentEnd()) { say('the tape is empty. record something first.'); return; }
  busy = true; say('mixing down …');
  try {
    const r = await renderMix(), base = (S.title.trim() || 'demo').replace(/[\\/:*?"<>|]+/g, ' '); let blob, name;
    if (kind === 'mp3') {
      if (typeof lamejs === 'undefined') throw new Error('no encoder');
      if (![32000, 44100, 48000].includes(r.sampleRate)) { say(`mp3 at 320 kbit/s needs 44.1 or 48 kHz, and this tape runs at ${r.sampleRate} Hz. mix down to wav instead.`); busy = false; return; }
      blob = await encodeMp3(r, pct => say(`making the mp3 … ${pct} %`)); name = base + '.mp3';
    } else { blob = encodeWav(r); name = base + '.wav'; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    say(`done. ${name} is in your downloads${kind === 'mp3' ? ' (mp3, 320 kbit/s)' : ''}.`);
  } catch (e) { say('the mixdown failed. try again with a shorter tape.'); }
  busy = false;
}


/* ---------- build the mixer ---------- */
const sec = (parent, text) => parent.appendChild(h('div', 'sec', `<span>${text}</span>`));
const blank = (parent, n = 1, cls = '') => { for (let i = 0; i < n; i++) parent.appendChild(h('div', 'cell spacer ' + cls, '')); };
const dbText = v => (v > 0.05 ? '+' : '') + (Math.abs(v) < .05 ? '0' : v.toFixed(1)) + ' dB';
function buildMixerUI(){
  const mx = $('mixer');
  /* input strip: row for row the same layout as the track strips next to it */
  const inp = h('div', 'strip wide'); inp.setAttribute('aria-label', 'input');
  inp.appendChild(h('div', 'lamps', '<span><i class="lampdot green" id="micLamp"></i>mic</span><span><i class="lampdot" id="peakLamp"></i>peak</span>'));
  inp.appendChild(h('div', 'cell spacer', '<span>input</span>'));
  inp.appendChild(h('div', 'cell', '<button class="btn" id="auto" type="button">auto trim</button>'));
  sec(inp, 'monitor');
  inp.appendChild(h('div', 'cell', '<button class="sw" id="monitor" type="button" aria-pressed="false" aria-label="monitor"></button><span>monitor</span>'));
  sec(inp, 'timing');
  inp.appendChild(h('div', 'cell', '<button class="btn" id="sync" type="button">sync</button><span class="syncval" id="syncVal">not measured</span>'));
  blank(inp, 1, 'eq2');   // second eq row, only present when the knobs stack
  sec(inp, 'click');
  inp.appendChild(h('div', 'cell tall', '<button class="sw" id="click" type="button" aria-pressed="false" aria-label="click, metronome"></button><span>click</span><input id="bpm" type="number" min="40" max="240" step="1" aria-label="tempo in beats per minute"><span>bpm</span>'));
  blank(inp, 1); blank(inp, 1, 'eq2');
  mx.appendChild(inp);
  /* four tracks: trim, eq, then echo / reverb / pan and the fader */
  controls.trim = [];
  for (let i = 0; i < 4; i++) {
    const st = h('div', 'strip'); st.setAttribute('aria-label', 'track ' + (i + 1)); st.style.setProperty('--cap', COLORS[i]);
    const vu = h('div', 'cell', '<div class="vubox">' + vuSVG() + '</div>'); vu.style.width = '100%'; st.appendChild(vu); needles.push(vu.querySelector('.needle'));
    const sel = h('select', 'src'); sel.id = 'src' + i; sel.setAttribute('aria-label', `sound card input for track ${i + 1}`);
    sel.addEventListener('change', () => { S.tracks[i].src = +sel.value; routeInputs(); saveState(); }); srcSels.push(sel);
    const scell = h('div', 'cell'); scell.style.width = '100%'; scell.appendChild(sel); st.appendChild(scell);
    const arm = h('button', 'arm', `<span class="lampdot"></span>${i + 1}`); arm.type = 'button';
    arm.setAttribute('aria-label', `record on track ${i + 1}`); arm.addEventListener('click', () => toggleArm(i)); armBtns.push(arm);
    const ac = h('div', 'cell'); ac.style.width = '100%'; ac.appendChild(arm); st.appendChild(ac);
    const tr = S.tracks[i], cap = COLORS[i], snap = v => Math.abs(v) < .4 ? 0 : v;
    sec(st, 'trim');
    controls.trim[i] = knobCell(st, 'trim', {small:true, label:`input trim track ${i + 1}`, min:TRIM_RANGE[0], max:TRIM_RANGE[1], value:tr.trim, def:0, cap, text:v => Math.round(v) + ' dB',
      onInput:v => { tr.trim = Math.round(v); setTrim(); saveState(); }});
    sec(st, 'eq');
    const eq = st.appendChild(h('div', 'pair'));
    knobCell(eq, 'high', {small:true, label:`high eq track ${i + 1}`, min:-EQ_RANGE, max:EQ_RANGE, value:tr.hi, def:0, cap, text:dbText, onInput:v => { tr.hi = snap(v); mixChanged(); }});
    knobCell(eq, 'low', {small:true, label:`low eq track ${i + 1}`, min:-EQ_RANGE, max:EQ_RANGE, value:tr.lo, def:0, cap, text:dbText, onInput:v => { tr.lo = snap(v); mixChanged(); }});
    sec(st, 'fx · pan');
    const fx = st.appendChild(h('div', 'pair'));
    knobCell(fx, 'echo', {small:true, label:`echo track ${i + 1}`, min:0, max:1, value:tr.eko, def:0, cap, onInput:v => { tr.eko = v; mixChanged(); }});
    knobCell(fx, 'reverb', {small:true, label:`reverb track ${i + 1}`, min:0, max:1, value:tr.rev, def:0, cap, onInput:v => { tr.rev = v; mixChanged(); }});
    knobCell(st, 'pan', {small:true, label:`pan track ${i + 1}`, min:-1, max:1, value:tr.pan, def:0, cap,
      text:v => Math.abs(v) < .04 ? 'centre' : (v < 0 ? 'left ' : 'right ') + Math.round(Math.abs(v) * 100),
      onInput:v => { tr.pan = Math.abs(v) < .04 ? 0 : v; mixChanged(); }});
    faderCell(st, 'volume', {label:`volume track ${i + 1}`, min:0, max:1, value:tr.vol, def:.8, cap, onInput:v => { tr.vol = v; mixChanged(); }});
    mx.appendChild(st);
  }
  /* master strip */
  const ms = h('div', 'strip wide'); ms.setAttribute('aria-label', 'effects and master');
  blank(ms, 3);
  sec(ms, 'tape');
  ms.appendChild(h('div', 'cell', '<button class="sw" id="tapeFx" type="button" aria-pressed="false" aria-label="tape sound"></button><span>tape sound</span>'));
  blank(ms, 2); blank(ms, 1, 'eq2');
  sec(ms, 'fx');
  const mfx = ms.appendChild(h('div', 'pair'));
  knobCell(mfx, 'delay', {small:true, label:'echo time', min:.06, max:.8, value:S.ekoTime, def:.32, text:v => Math.round(v * 1000) + ' ms', onInput:v => { S.ekoTime = v; mixChanged(); }});
  knobCell(mfx, 'repeat', {small:true, label:'echo repeats', min:0, max:.85, value:S.ekoFb, def:.35, onInput:v => { S.ekoFb = v; mixChanged(); }});
  knobCell(ms, 'reverb size', {small:true, label:'reverb length', min:.5, max:4, value:S.revLen, def:1.8, text:v => v.toFixed(1) + ' s', onInput:v => { S.revLen = v; refreshIR(); saveState(); }});
  faderCell(ms, 'master', {label:'master volume', min:0, max:1, value:S.master, def:.8, cap:'#1e201f', onInput:v => { S.master = v; mixChanged(); }});
  mx.appendChild(ms);
}
function toggleArm(i){
  if (transport === 'rec' || busy) return;
  S.arm[i] = !S.arm[i]; paintArm(); setMonitors(); saveState();
}
const paintArm = () => armBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(!!S.arm[i])));
function paintSources(){
  srcSels.forEach((sel, i) => { sel.innerHTML = '';
    for (let k = 0; k < nIn; k++) { const o = document.createElement('option'); o.value = k; o.textContent = 'in ' + (k + 1); sel.appendChild(o); }
    if (!(S.tracks[i].src < nIn)) S.tracks[i].src = 0; sel.value = S.tracks[i].src; });
}
function paintSwitches(){
  $('monitor').setAttribute('aria-pressed', String(S.monitor)); $('click').setAttribute('aria-pressed', String(S.click));
  $('tapeFx').setAttribute('aria-pressed', String(S.tapeFx));
}
function paintLamps(){ $('micLamp').classList.toggle('lit', micOK); }
function paintSync(){ const t = syncMs == null ? 'not measured' : syncMs + ' ms' + (syncMeasured ? '' : ' (guess)'); $('syncVal').textContent = t; $('syncVal2').textContent = t; }
function paintTransport(){
  $('play').classList.toggle('down', transport !== 'stop'); $('rec').classList.toggle('down', transport === 'rec');
  $('play').setAttribute('aria-pressed', String(transport !== 'stop')); $('rec').setAttribute('aria-pressed', String(transport === 'rec'));
}

/* ---------- tape map ---------- */
const map = $('map'), mapwrap = $('mapwrap'), head = $('head');
let viewLen = 60;
function drawMap(){
  const w = mapwrap.clientWidth, hgt = mapwrap.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!w) return;
  map.width = Math.round(w * dpr); map.height = Math.round(hgt * dpr);
  const g = map.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, hgt);
  viewLen = clamp(Math.ceil((Math.max(contentEnd(), pos) + 8) / 30) * 30, 60, TAPE);
  const lane = hgt / 4;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(0, i * lane + lane / 2 - .5, w, 1);
    const t = tape[i]; if (!t) continue;
    g.fillStyle = COLORS[i];
    const per = viewLen * t.sr / w, stride = Math.max(1, Math.floor(per / 48));
    for (let x = 0; x < w; x++) { const a = Math.floor(x * per), b = Math.min(t.data.length, Math.floor((x + 1) * per)); if (a >= t.data.length) break;
      let p = 0; for (let k = a; k < b; k += stride) { const v = Math.abs(t.data[k]); if (v > p) p = v; }
      const y = Math.max(1, Math.min(1, Math.sqrt(p)) * (lane - 2)); g.fillRect(x, i * lane + (lane - y) / 2, 1, y); }
  }
}
mapwrap.addEventListener('pointerdown', e => { const r = mapwrap.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * viewLen); mapwrap.setPointerCapture(e.pointerId); });
mapwrap.addEventListener('pointermove', e => { if (!mapwrap.hasPointerCapture(e.pointerId) || transport !== 'stop') return;
  const r = mapwrap.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * viewLen); });
window.addEventListener('resize', drawMap);

/* ---------- animation: counter, reels, needles ---------- */
const digits = [...$('counter').querySelectorAll('span:not(.sep)')];
const reelL = $('reelL'), reelR = $('reelR'), packL = $('packL'), packR = $('packR');
const reelMarkup = cx => { let t = `<circle cx="${cx}" cy="114" r="24.500" fill="#0a0c0d"/><circle cx="${cx}" cy="114" r="24.500" fill="none" stroke="#7d7969" stroke-width="1.200"/>`;
  for (let k = 0; k < 6; k++) t += `<rect x="${cx - 3.5}" y="${114 - 25}" width="7" height="10.500" rx="1.500" fill="#f6f3e8" stroke="#8c8878" stroke-width=".6" transform="rotate(${k * 60} ${cx} 114)"/>`;
  for (let k = 0; k < 3; k++) t += `<rect x="${cx - 2}" y="${114 - 41}" width="4" height="12" rx="2" fill="#8f8b7a" transform="rotate(${k * 120 + 30} ${cx} 114)"/>`;
  return t; };
reelL.innerHTML = reelMarkup(115.5); reelR.innerHTML = reelMarkup(284.5);
let lastTs = 0, angL = 0, angR = 0, lastCount = -1, lastView = 60, peakHold = 0;
const needleAng = [-46,-46,-46,-46];
const anBuf = new Float32Array(1024);
function levelOf(an){ an.getFloatTimeDomainData(anBuf); let s = 0, p = 0;
  for (let i = 0; i < anBuf.length; i++) { const v = anBuf[i]; s += v * v; const a = v < 0 ? -v : v; if (a > p) p = a; }
  return [Math.sqrt(s / anBuf.length), p]; }
const VU = [[-30,-46],[-20,-40],[-10,-22],[-7,-12],[-5,-4],[-3,6],[0,20],[3,40],[5,46]];
function vuAngle(rms){
  if (rms < 1e-5) return -46; const db = clamp(20 * Math.log10(rms) + 14, -30, 5);
  for (let i = 1; i < VU.length; i++) if (db <= VU[i][0]) { const [d0,a0] = VU[i - 1], [d1,a1] = VU[i]; return a0 + (a1 - a0) * (db - d0) / (d1 - d0); }
  return 46;
}
function frame(ts){
  const dt = Math.min(.1, (ts - lastTs) / 1000 || 0); lastTs = ts;
  let p = pos, speed = 0;
  if (ctx && transport !== 'stop') { p = curPos(); speed = ctx.currentTime >= t0 ? 1 : 0;
    if (p >= TAPE) { stop().then(() => say('end of tape. press to start.')); }
    else if (transport === 'play' && p > contentEnd() + 1.2) stop(); }
  else if (winding) { pos = clamp(pos + winding * dt * 30, 0, TAPE); p = pos; speed = winding * 14; }
  const sec = Math.floor(p);
  if (sec !== lastCount) { lastCount = sec; const m = Math.floor(sec / 60), s = sec % 60;
    digits[0].textContent = Math.floor(m / 10); digits[1].textContent = m % 10; digits[2].textContent = Math.floor(s / 10); digits[3].textContent = s % 10; }
  const fr = p / TAPE, rL = Math.sqrt(2116 + (8464 - 2116) * (1 - fr)), rR = Math.sqrt(2116 + (8464 - 2116) * fr);
  packL.setAttribute('r', rL.toFixed(1)); packR.setAttribute('r', rR.toFixed(1));
  if (speed && !reduceMotion) { angL -= speed * dt * 12600 / rL; angR -= speed * dt * 12600 / rR;
    reelL.setAttribute('transform', `rotate(${(angL % 360).toFixed(1)} 115.5 114)`); reelR.setAttribute('transform', `rotate(${(angR % 360).toFixed(1)} 284.5 114)`); }
  const need = clamp(Math.ceil((Math.max(contentEnd(), p) + 8) / 30) * 30, 60, TAPE);
  if (need !== lastView) { lastView = need; drawMap(); }
  head.style.transform = `translateX(${(clamp(p / viewLen, 0, 1) * (mapwrap.clientWidth - 2)).toFixed(1)}px)`;
  let inLv = null;
  if (ctx && micOK && ctx.state === 'running') { inLv = [];
    for (let k = 0; k < nIn; k++) { const l = levelOf(rawAn[k]); inLv.push(l); pkIn[k] = Math.max(l[1], pkIn[k] * .995); } }
  for (let i = 0; i < 4; i++) { let target = -46;
    if (ctx && ctx.state === 'running') {
      const showInput = inLv && S.arm[i] && (transport === 'stop' || (transport === 'rec' && recTracks.includes(i)));
      target = vuAngle(showInput ? (inLv[S.tracks[i].src] || [0])[0] * trimOf(i) : levelOf(live.ch[i].an)[0]); }
    needleAng[i] += (target - needleAng[i]) * Math.min(1, dt * 9);
    needles[i].setAttribute('transform', `rotate(${needleAng[i].toFixed(1)} 50 80)`); }
  if (inLv) { let pk = 0; for (let i = 0; i < 4; i++) if (S.arm[i]) pk = Math.max(pk, (inLv[S.tracks[i].src] || [0, 0])[1] * trimOf(i));
    if (pk > .9) peakHold = ts + 700; $('peakLamp').classList.toggle('lit', ts < peakHold); }
  requestAnimationFrame(frame);
}

/* ---------- wiring ---------- */
buildMixerUI(); paintArm(); paintSources(); paintSwitches(); paintSync();
$('title').value = S.title; $('bpm').value = S.bpm;
$('title').addEventListener('input', e => { S.title = e.target.value; saveState(); });
$('bpm').addEventListener('change', e => { S.bpm = clamp(Math.round(+e.target.value) || 100, 40, 240); e.target.value = S.bpm; saveState(); });
$('power').addEventListener('click', async () => { if (ctx && ctx.state === 'running' && document.body.classList.contains('on')) powerOff(); else { await ensureCtx(); document.body.classList.add('on'); $('power').setAttribute('aria-pressed', 'true'); await openMic(); } });
$('play').addEventListener('click', play); $('stop').addEventListener('click', stop); $('rec').addEventListener('click', record);
$('rtz').addEventListener('click', () => seek(0));
$('undo').addEventListener('click', undoTake); $('mix').addEventListener('click', () => mixdown('wav')); $('mix3').addEventListener('click', () => mixdown('mp3'));
$('auto').addEventListener('click', autoLevel);
$('sync').addEventListener('click', async () => { if (!micOK) { await openMic(); return; } calibrate(); });
$('syncAgain').addEventListener('click', async () => { if (!micOK) { await openMic(); return; } calibrate(); });
const bumpSync = d => { if (!ctx) { say('switch on first.'); return; } syncMs = Math.max(0, (syncMs == null ? browserEstimate() : syncMs) + d); syncMeasured = true; paintSync();
  try { localStorage.setItem(syncKey(), String(syncMs)); } catch (e) {} };
$('syncMinus').addEventListener('click', () => bumpSync(-1)); $('syncPlus').addEventListener('click', () => bumpSync(1));
$('nudgeL').addEventListener('click', () => nudge(-5)); $('nudgeR').addEventListener('click', () => nudge(5));
const pickInput = e => { const v = e.target.value; if (!v) return;
  if (transport !== 'stop' || busy) { say('stop the tape first, then choose the input.'); if (stream) listDevices(stream.getAudioTracks()[0].getSettings().deviceId); return; }
  if (v === '@default') { try { localStorage.setItem('weibenporta.input', '@default'); } catch (e2) {} openMic(); } else openMic(v); };
$('device').addEventListener('change', pickInput); $('device2').addEventListener('change', pickInput);
const openDlg = d => { if (d.open) return; if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); };
const closeDlg = d => { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); };
document.querySelectorAll('dialog.sheet').forEach(d => {
  d.addEventListener('click', e => { if (e.target === d) closeDlg(d); });          // a tap on the dimmed background
  d.querySelectorAll('.x, .done').forEach(b => b.addEventListener('click', () => closeDlg(d))); });
$('openHelp').addEventListener('click', () => openDlg($('helpDlg')));
$('openSettings').addEventListener('click', () => { $('dial2').textContent = ''; $('diag').textContent = diagText(); openDlg($('settingsDlg')); });
try { if (!localStorage.getItem('weibenporta.seen')) { localStorage.setItem('weibenporta.seen', '1'); openDlg($('helpDlg')); } } catch (e) {}
const paintDiag = () => { $('diag').textContent = diagText(); };
setInterval(() => { if ($('settingsDlg').open) paintDiag(); }, 1000);
$('diagCopy').addEventListener('click', async () => { const t = diagText(); paintDiag();
  try { await navigator.clipboard.writeText(t); say('diagnostics copied.'); }
  catch (e) { const r = document.createRange(); r.selectNodeContents($('diag')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); say('diagnostics selected. press ctrl or cmd + C to copy.'); } });
$('monitor').addEventListener('click', async () => {
  if (!S.monitor && !micOK) { if (!(await openMic())) return; }
  S.monitor = !S.monitor; setMonitors(); paintSwitches();
  if (S.monitor) say('monitor on. wear headphones, or it will howl.'); });
$('click').addEventListener('click', () => { S.click = !S.click; paintSwitches(); saveState(); say(S.click ? `click on, ${S.bpm} beats a minute. you get four clicks before recording starts.` : 'click off.'); });
$('tapeFx').addEventListener('click', () => { S.tapeFx = !S.tapeFx; paintSwitches(); mixChanged(); });
$('fresh').addEventListener('click', () => openDlg($('trashDlg')));
$('trashOk').addEventListener('click', async () => { closeDlg($('trashDlg'));
  await stop(); for (let i = 0; i < 4; i++) { tape[i] = null; saveTrack(i); } undo = null; $('undo').disabled = true; pos = 0;
  S.title = ''; $('title').value = ''; saveState(); drawMap(); say('new tape in. write the song title on the cassette.'); });
function wind(btn, dir){
  const start = e => { if (transport !== 'stop' || busy) return; winding = dir; btn.classList.add('down'); btn.setPointerCapture(e.pointerId); };
  const end = () => { winding = 0; btn.classList.remove('down'); };
  btn.addEventListener('pointerdown', start); btn.addEventListener('pointerup', end); btn.addEventListener('pointercancel', end);
  btn.addEventListener('click', e => { if (e.detail === 0) seek(pos + dir * 10); });   // keyboard: hop ten seconds
}
wind($('rew'), -1); wind($('ff'), 1);
document.addEventListener('keydown', e => {
  const tg = e.target, tag = tg.tagName; if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.key === ' ') { if (tag === 'BUTTON' || tag === 'SUMMARY') return; e.preventDefault(); transport === 'stop' ? play() : stop(); }
  else if (e.key === 'r' || e.key === 'R') record();
  else if (e.key >= '1' && e.key <= '4') toggleArm(+e.key - 1);
  else if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'SUMMARY') seek(0);
});
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener)
  navigator.mediaDevices.addEventListener('devicechange', () => { if (micOK) { listDevices($('device').value); say('the sound devices changed. check sound card at the top if something sounds wrong.'); } });

/* load the saved tape, then start drawing */
(async () => {
  if (await idb.open()) for (let i = 0; i < 4; i++) { const t = await idb.get('t' + i);
    if (!t || !t.data || !t.data.length || tape[i]) continue;
    if (ctx) setTrackData(i, resample(t.data, t.sr, ctx.sampleRate)); else tape[i] = {data:t.data, sr:t.sr, buf:null}; }
  drawMap();
  if (contentEnd()) say('the tape from last time is in. press play.');
  requestAnimationFrame(frame);
})();

/* hooks used by the automated test */
window.__fyr = {S, tape, analyseCal, chooseInput, diagText, encodeMp3, putTrack(i, d){ setTrackData(i, d); }, monitorTap(n, i){ mon[i || 0].connect(n); }, armed, toggleArm, get nIn(){ return nIn; }, ensureCtx, calibrate, play, record, stop, seek, renderMix, encodeWav, drawMap,
  get ctx(){ return ctx; }, get pos(){ return curPos(); }, get transport(){ return transport; }, get syncMs(){ return syncMs; }, get recMode(){ return rec.mode; },
  loopback(delay){ const d = ctx.createDelay(1); d.delayTime.value = delay; speakerBus.connect(d); setInputNode(d); micOK = true; micLabel = 'loop'; nIn = 2; paintLamps(); paintSources(); routeInputs(); },
  tones(freqs){ const m = ctx.createChannelMerger(freqs.length); freqs.forEach((f, k) => { const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); g.gain.value = .3; o.connect(g); g.connect(m, 0, k); o.start(); });
    setInputNode(m); micOK = true; micLabel = 'test tones'; nIn = freqs.length; paintLamps(); paintSources(); routeInputs(); }};
