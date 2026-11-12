import { rt } from '../runtime.js';
import { S, saveState } from '../state.js';
import { applyMix, makeIR } from './graph.js';
let irT = 0;
/** Rebuild the reverb room shortly after the reverb length knob stops moving. */
export const refreshIR = () => {
  clearTimeout(irT);
  irT = window.setTimeout(() => {
    if (rt.live) rt.live.rev.buffer = makeIR(rt.ctx, S.revLen);
  }, 160);
};
/** A mixer control moved: apply it to the live graph and save. */
export const mixChanged = () => {
  if (rt.live) applyMix(rt.live, rt.ctx, false);
  saveState();
};
