# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Weiben Porta" is a browser-based 4-track cassette portastudio (record, overdub, mix, export). Vanilla JS built with Vite, deployed on Vercel. There are no tests or linter. Verify UI changes in a browser.

```
npm install
npm run dev        # vite dev server
npm run build      # outputs dist/
npm run preview
```

Microphone and AudioWorklet need a secure context (`localhost` or https).

## Layout

- `index.html`: markup only (machine, cassette bay, dialogs). The mixer section is empty and filled by JS.
- `public/vendor/lame.js`: minified lamejs MP3 encoder, loaded as a classic `<script>` so it stays a global `lamejs`. It is not strict-mode safe, so do not turn it into an ES module. Do not edit it.
- `src/styles/*.css`: base (`:root` tokens and textures), machine, bay, mixer, dialogs (dialogs.css also holds the responsive `@media` rules, including a second copy of the strip grid for phones).
- `src/config.js`: constants (`TAPE` seconds, `COLORS`, trim and EQ ranges). `src/util.js`: `$`, `clamp`, `h` (DOM builder), `dbToGain`.
- `src/state.js`: the state object `S`, persisted to `localStorage` key `weibenporta.state2`, plus the in-memory `tape[]` and the IndexedDB store `idb`. Loading is defensive and migrates old saves (the old single `trimDb` became per-track `trim`). Follow that style when adding fields.
- `src/audio/graph.js`: `buildMixer` and `applyMix`, the Web Audio graph. The same code builds the live graph and the `OfflineAudioContext` mixdown graph, so live sound and export match.
- `src/audio/tape-rec.worklet.js`: AudioWorklet processor. It is imported with `?raw` and loaded from a `data:` URL, falling back to a `blob:` URL, so it works from `file://`. It runs in the worklet scope, so it must stay free of imports.
- `src/ui/controls.js`: knob and fader widgets (`control`, `knobCell`, `faderCell`) and the VU meter SVG.
- `src/main.js`: engine and wiring: AudioContext and mic setup, recorder (`rec`), transport, sync calibration, auto trim, mixdown/export, `buildMixerUI`, animation loop. It still holds most mutable runtime state (`ctx`, `live`, `transport`, ...) as module-level `let`s. Moving code out means passing that state explicitly.

## Mixer model

Each track has `{vol, pan, eko, rev, src, trim, lo, hi}` in `S.tracks[i]`.

- `trim` (dB) is input gain applied **before** recording, on `trackIn[i]` in `main.js`. The take is stored post-trim. Auto trim sets it per armed track from that track's input peak.
- `lo` / `hi` (dB) are per-channel low-shelf (100 Hz) and high-shelf (10 kHz) filters in `graph.js`, placed after the channel input and before the fader. They apply at playback and mixdown, not to the recorded data.
- Every strip uses the same CSS grid row template (`.strip` in `mixer.css`: vu, input select, arm, then three sections: trim, eq, fx·pan, then the fader). The input and master strips fill the same rows, using `blank()` placeholders and `.cell.tall` spans, so controls line up across strips. Changing a strip's row count means changing both `.strip` templates (mixer.css and the phone override in dialogs.css) and the builders in `buildMixerUI`.
- UI text is lowercase silkscreen style. Status messages go through `say()`.

`window.__fyr` at the bottom of `main.js` is a hook for an external automated test. Keep it.
