// End-to-end check in headless Chrome with a fake sound card. Drives the machine through `window.__fyr`
// (src/testHooks.ts): switch on, record, play, overdub, mix down to wav and mp3, reload, use knobs and keys.
// Prints what it observed as JSON, so two builds can be diffed.
//
//   npm run build && npm run preview -- --port 4173 &
//   node scripts/e2e.mjs http://localhost:4173/ 9222 > result.json
//
// Set CHROME_PATH if Chrome is not in the macOS default location, and OUT=<dir> to save a screenshot.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [,, url, port = '9222', label = 'build'] = process.argv;
const CH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir = mkdtempSync(join(tmpdir(), 'chr-'));
const proc = spawn(CH, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars',`--user-data-dir=${dir}`,`--remote-debugging-port=${port}`,
  '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--window-size=1280,900','about:blank'],{stdio:'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets; for (let i=0;i<50;i++){ try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find(t=>t.type==='page')) break; } catch {} await sleep(200); }
const page = targets.find(t=>t.type==='page');
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pending=new Map(); const errors=[]; const consoleErrors=[];
ws.onmessage = m => { const d=JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method==='Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method==='Runtime.consoleAPICalled' && d.params.type==='error') consoleErrors.push(d.params.args.map(a=>a.value||a.description).join(' ')); };
const send = (method, params={}) => new Promise(r => { const i=++id; pending.set(i,r); ws.send(JSON.stringify({id:i,method,params})); });
const ev = async (expr) => { const r = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description||'eval error'); return r.result.result.value; };
await send('Runtime.enable'); await send('Page.enable');
const out = { label, steps:{} };
const step = async (name, fn) => { try { out.steps[name] = await fn(); } catch (e) { out.steps[name] = 'ERROR: ' + e.message; } };

await send('Page.navigate',{url}); await sleep(1500);
await step('boot', () => ev(`({title: document.title, hasHook: !!window.__fyr, mixerChildren: document.getElementById('mixer').children.length, knobs: document.querySelectorAll('.knob').length, faders: document.querySelectorAll('.fader').length, help: document.getElementById('helpDlg').open})`));
await step('domHash', () => ev(`(async()=>{ const s=document.body.innerHTML.replace(/\\s+/g,' '); const b=new TextEncoder().encode(s); const h=await crypto.subtle.digest('SHA-256',b); return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16)+' len='+s.length })()`));
// close help, screenshot
await ev(`document.getElementById('helpDlg').close()`);
await sleep(300);
const shot = await send('Page.captureScreenshot',{format:'png'});
if (process.env.OUT) writeFileSync(join(process.env.OUT, `shot-${label}.png`), Buffer.from(shot.result.data,'base64'));

// power on with fake test tones
await step('audioOn', () => ev(`(async()=>{ await __fyr.ensureCtx(); __fyr.tones([440,880]); return {state: __fyr.ctx.state, sr: __fyr.ctx.sampleRate, nIn: __fyr.nIn, rec: __fyr.recMode} })()`));
await step('setSync', () => ev(`(()=>{ __fyr.S.arm = [true,false,false,false]; return 'ok' })()`));
await step('record', () => ev(`(async()=>{ await __fyr.record(); await new Promise(r=>setTimeout(r,2000)); const during=__fyr.transport; await __fyr.stop(); await new Promise(r=>setTimeout(r,500)); const t=__fyr.tape[0]; let peak=0; if(t) for(let i=0;i<t.data.length;i+=7) peak=Math.max(peak,Math.abs(t.data[i])); return {during, secs: t? +(t.data.length/t.sr).toFixed(1):0, peak:+peak.toFixed(3), display: document.getElementById('dialInner').textContent} })()`));
await step('undoEnabled', () => ev(`!document.getElementById('undo').disabled`));
await step('play', () => ev(`(async()=>{ __fyr.seek(0); await __fyr.play(); await new Promise(r=>setTimeout(r,1000)); const tr=__fyr.transport, pos=__fyr.pos; await __fyr.stop(); return {tr, posOk: pos>0.6&&pos<1.6, after: __fyr.transport, counter:[...document.querySelectorAll('#counter span')].map(s=>s.textContent).join('')} })()`));
await step('overdubTrack2', () => ev(`(async()=>{ __fyr.S.arm=[false,true,false,false]; __fyr.toggleArm; await __fyr.seek(0); await __fyr.record(); await new Promise(r=>setTimeout(r,1500)); await __fyr.stop(); await new Promise(r=>setTimeout(r,400)); return {t0: !!__fyr.tape[0], t1: !!__fyr.tape[1], secs1: __fyr.tape[1]? +(__fyr.tape[1].data.length/__fyr.tape[1].sr).toFixed(1):0} })()`));
await step('mixdown', () => ev(`(async()=>{ const b=await __fyr.renderMix(); const d=b.getChannelData(0); let s=0,p=0; for(let i=0;i<d.length;i++){s+=d[i]*d[i]; p=Math.max(p,Math.abs(d[i]));} const wav=__fyr.encodeWav(b); const mp3=await __fyr.encodeMp3(b,()=>{}); return {len:b.length, ch:b.numberOfChannels, sr:b.sampleRate, rms:+Math.sqrt(s/d.length).toFixed(4), peak:+p.toFixed(3), wavBytes:wav.size, mp3Bytes:mp3.size>1000} })()`));
// eq and trim really change the sound: render with and without
await step('eqEffect', () => ev(`(async()=>{ const S=__fyr.S; const rms=async()=>{const b=await __fyr.renderMix(); const d=b.getChannelData(0); let s=0; for(let i=0;i<d.length;i++) s+=d[i]*d[i]; return Math.sqrt(s/d.length)}; const a=await rms(); S.tracks[0].hi=12; S.tracks[0].lo=-12; const b2=await rms(); S.tracks[0].hi=0; S.tracks[0].lo=0; return {flat:+a.toFixed(4), eq:+b2.toFixed(4), changed: Math.abs(a-b2)>1e-4} })()`));
await step('deterministic', () => ev(`(async()=>{ const S=__fyr.S; const sr=__fyr.ctx.sampleRate;
  const mk=(f,n)=>{const d=new Float32Array(sr*n); for(let i=0;i<d.length;i++) d[i]=0.5*Math.sin(2*Math.PI*f*i/sr)*(i<sr*0.01?i/(sr*0.01):1); return d};
  __fyr.putTrack(0, mk(220,1)); __fyr.putTrack(1, mk(1760,1)); __fyr.putTrack(2, mk(110,1.5)); __fyr.putTrack(3, null);
  const cfgs=[
   {name:'flat', f:()=>{}},
   {name:'eq', f:()=>{S.tracks[0].hi=9; S.tracks[0].lo=-9; S.tracks[1].hi=-12; S.tracks[2].lo=12;}},
   {name:'fx', f:()=>{S.tracks.forEach((t,i)=>{t.eko=.4; t.rev=.5; t.pan=[-1,1,0,.3][i]; t.vol=[.8,.6,1,.8][i]}); S.tapeFx=true; S.master=.7}}];
  const res={};
  for(const c of cfgs){ c.f(); const b=await __fyr.renderMix(); const L=b.getChannelData(0), R=b.getChannelData(1); let sl=0,sr2=0,p=0,chk=0; for(let i=0;i<L.length;i++){sl+=L[i]*L[i]; sr2+=R[i]*R[i]; p=Math.max(p,Math.abs(L[i]),Math.abs(R[i])); chk=(chk+Math.abs(L[i])*(i%97+1)+Math.abs(R[i])*(i%89+1))%1e9} res[c.name]={len:b.length, rmsL:+Math.sqrt(sl/L.length).toFixed(6), rmsR:+Math.sqrt(sr2/L.length).toFixed(6), peak:+p.toFixed(6), chk:+chk.toFixed(3)} }
  return res })()`));
const rectOf = sel => ev(`(()=>{const r=document.querySelectorAll('${sel}')[0].getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const drag = async (sel, dy) => { const c = await rectOf(sel);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:c.x,y:c.y}); await send('Input.dispatchMouseEvent',{type:'mousePressed',x:c.x,y:c.y,button:'left',clickCount:1});
  for (let i=1;i<=6;i++) await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:c.x,y:c.y+dy*i/6,button:'left',buttons:1}); await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:c.x,y:c.y+dy,button:'left',clickCount:1}); };
await ev(`document.getElementById('helpDlg').close()`);
await step('knobDrag', async () => { await ev(`__fyr.S.tracks[0].trim=0; __fyr.S.tracks[0].hi=0; __fyr.S.tracks[0].lo=0; 0`);
  await drag('.strip[aria-label="track 1"] .knob', -30);
  const a = await ev(`({trim:__fyr.S.tracks[0].trim, text:document.querySelectorAll('.strip[aria-label="track 1"] .knob')[0].getAttribute('aria-valuetext')})`);
  await drag('.strip[aria-label="track 1"] .fader', 20);
  const b = await ev(`+__fyr.S.tracks[0].vol.toFixed(3)`); return {a, vol:b}; });
await step('autoTrim', async () => { await ev(`__fyr.tones([440,880]); __fyr.S.arm=[true,true,false,false]; 0`); await ev(`document.getElementById('auto').click()`); await sleep(5200);
  return ev(`({trims:__fyr.S.tracks.map(t=>t.trim), msg:document.getElementById('dialInner').textContent.slice(0,60)})`); });
await step('switches', () => ev(`(async()=>{ const q=id=>document.getElementById(id); q('click').click(); q('tapeFx').click(); const r={click:q('click').getAttribute('aria-pressed'), tape:q('tapeFx').getAttribute('aria-pressed'), S:[__fyr.S.click,__fyr.S.tapeFx]}; q('click').click(); q('tapeFx').click(); return r })()`));
// persistence: reload and look at restored state
await sleep(600);
await send('Page.navigate',{url}); await sleep(1800);
await step('reload', () => ev(`({secs0: __fyr.tape[0]? +(__fyr.tape[0].data.length/__fyr.tape[0].sr).toFixed(1):0, secs1: __fyr.tape[1]? +(__fyr.tape[1].data.length/__fyr.tape[1].sr).toFixed(1):0, arm: __fyr.S.arm, display: document.getElementById('dialInner').textContent, help: document.getElementById('helpDlg').open})`));
// keyboard + dialogs
await step('keys', () => ev(`(async()=>{ document.getElementById('helpDlg').close(); const before=[...__fyr.S.arm]; document.dispatchEvent(new KeyboardEvent('keydown',{key:'3',bubbles:true})); const after=[...__fyr.S.arm]; return {before, after} })()`));
await step('trashDialog', () => ev(`(async()=>{ document.getElementById('fresh').click(); const open=document.getElementById('trashDlg').open; document.getElementById('trashDlg').querySelector('.done').click(); const closed=!document.getElementById('trashDlg').open; return {open, closed, stillHasTape: !!__fyr.tape[0]} })()`));
await step('trashErase', () => ev(`(async()=>{ document.getElementById('fresh').click(); document.getElementById('trashOk').click(); await new Promise(r=>setTimeout(r,500)); return {tape0: __fyr.tape[0], title: document.getElementById('title').value, display: document.getElementById('dialInner').textContent} })()`));
await step('settingsDialog', () => ev(`(()=>{ document.getElementById('openSettings').click(); const open=document.getElementById('settingsDlg').open; const diag=document.getElementById('diag').textContent.split('\\n')[0]; document.getElementById('settingsDlg').close(); return {open, diag} })()`));
out.exceptions = errors; out.consoleErrors = consoleErrors;
console.log(JSON.stringify(out,null,1));
ws.close(); proc.kill(); process.exit(0);
