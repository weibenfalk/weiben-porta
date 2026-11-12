export const $ = id => document.getElementById(id);
export const clamp = (v,a,b) => Math.min(b, Math.max(a, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export const dbToGain = db => Math.pow(10, db / 20);
