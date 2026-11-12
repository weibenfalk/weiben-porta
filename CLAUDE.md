# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Weiben Porta" is a browser-based 4-track cassette portastudio (record, overdub, mix, export). TypeScript built with Vite, no UI framework, deployed on Vercel. Only the UI is DOM-built by hand; the audio engine, the animation loop and the controls are imperative on purpose (real-time work, so React was deliberately not used).

```
npm install
npm run dev          # vite dev server
npm run build        # tsc --noEmit && vite build -> dist/
npm run typecheck
npm test             # vitest: state migration, sync analysis, device choice, wav, resample
npm run format       # prettier
```

Microphone and AudioWorklet need a secure context (`localhost` or https).

There is no automated test for the audio itself or the UI beyond `scripts/e2e.mjs`: a Chrome/CDP script that uses a fake sound card and the `window.__fyr` hooks to switch on, record, overdub, play, mix down, reload, use knobs and keys, and prints JSON. Run it against the build from before and after a change and diff the output (screenshots and the DOM are expected to be identical; mixdown checksums match to about 1e-3). Anything involving a real microphone must be tried by hand.

## Layout

- `index.html`: markup only (machine, cassette bay, dialogs). The mixer section is empty and filled by JS.
- `public/vendor/lame.js`: minified lamejs MP3 encoder, loaded as a classic `<script>` so it stays the global `lamejs` (declared in `src/globals.d.ts`). It is not strict-mode safe, so do not turn it into an ES module. Do not edit it.
- `src/styles/*.css`: base (`:root` tokens and textures), machine, bay, mixer, dialogs (dialogs.css also holds the responsive `@media` rules, including a phone copy of the strip grid).
  - Two WebKit rules, both found by reproducing an iPhone problem in Playwright WebKit (Chrome showed neither): grid tracks are `minmax(0,1fr)`, never a bare `1fr`, because a bare `1fr` grows to its widest content (a long message on the display made the page wider than the phone, and iOS zoomed out); and noise textures are the pre-rendered WebP files in `public/tex/` (`scripts/make-textures.mjs`), never SVG `feTurbulence` backgrounds, which WebKit repaints on the CPU (41 fps against 74 in playback).
  - Keep skins in `skin-black.css` behind `:where(html[data-skin="black"])`, last in the import order.
- `src/main.ts`: imports the CSS and calls `startup()`.
- `src/runtime.ts`: `rt`, the one object holding everything that changes while the machine runs (audio graph, transport state, input device). Modules import `rt` instead of sharing module-level variables. `rt.ctx`, `rt.live` and other audio nodes are typed as always present, because they exist after `ensureCtx()`; code that can run earlier checks `if (!rt.ctx)` first.
- `src/state.ts`: the saved settings `S` (localStorage key `weibenporta.state2`), the in-memory `tape[]` and the IndexedDB store `idb`. Loading migrates old saves (the old single `trimDb` became per-track `trim`); keep that defensive style when adding fields. `src/types.ts`, `src/config.ts`, `src/util.ts` hold shared types, constants and helpers.
- `src/audio/`
  - `graph.ts`: `buildMixer` and `applyMix`. The same code builds the live graph and the `OfflineAudioContext` used for mixdown, so what you hear is what you export.
  - `engine.ts`: `ensureCtx` (builds the context, mixer, per-input analysers and trim gains), input routing, monitoring.
  - `inputs.ts` (microphone/sound card: `openMic`, `listDevices`), `devices.ts` (pure device-label logic), `sync.ts` + `analyse.ts` (delay measurement), `autolevel.ts`.
  - `recorder.ts` + `tape-rec.worklet.js`: sample-exact recording on the audio thread. The worklet is imported with `?raw` and loaded from a `data:` URL, falling back to `blob:`, so it works from `file://`; it runs in the worklet scope and must stay free of imports. A ScriptProcessor fallback exists for old browsers.
  - `transport.ts`: play/record (with punch-in and count-in)/stop/seek/undo/nudge and the metronome. `finishRecording` cuts the take onto the tape, compensating for the measured delay.
  - `mixdown.ts` (`renderMix`, mp3), `wav.ts`, `resample.ts`, `mix.ts` (apply mixer changes to the live graph).
- `src/ui/`: `mixerUI.ts` (builds the strips), `controls.ts` (knob/fader widgets, VU face), `animation.ts` (the per-frame loop: counter, reels, VU needles), `tapeMap.ts` (waveform overview), `display.ts` (`say()` shows messages on the amber display, which scrolls sideways when text is wider), `dialogs.ts`, `diagnostics.ts`, `wiring.ts` (`startup()`: connects every button and key).
- `src/testHooks.ts`: `window.__fyr`, used by `scripts/e2e.mjs`. Keep the names.

Modules import each other in cycles (e.g. transport, engine, mixerUI); that works because nothing calls across modules at import time. Keep it that way: do real work inside functions, started from `startup()`.

Beware of names that exist as browser globals, such as `stop()`: a missing import of `stop` from `transport.ts` compiles silently and calls `window.stop()`.

## Mixer model

Each track has `{vol, pan, eko, rev, src, trim, lo, hi}` in `S.tracks[i]`.

- `trim` (dB) is input gain applied **before** recording, on `rt.trackIn[i]`. The take is stored post-trim. Auto trim sets it per armed track from that track's input peak.
- `lo` / `hi` (dB) are per-channel low-shelf (100 Hz) and high-shelf (10 kHz) filters in `graph.ts`, between the channel input and the fader. They apply at playback and mixdown, not to the recorded data.
- Every strip uses the same CSS grid row template (`.strip` in `mixer.css`: vu, input select, arm, then the trim, eq and fx·pan sections, then the fader). From 1200 px wide, eq high/low and echo/reverb sit side by side (`.pair`), which removes two rows. The input and master strips fill the same rows with `blank()` placeholders (`.eq2` marks the ones that only exist when the knobs stack) and `.cell.tall` spans, so controls line up across strips. Changing a strip's row count means changing the `.strip` templates in mixer.css (base and the 1200 px query), the phone override in dialogs.css, and `buildMixerUI`.
- UI text is lowercase silkscreen style.
