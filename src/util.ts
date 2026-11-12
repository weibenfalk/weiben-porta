export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Create an element with a class and inner HTML. */
export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
