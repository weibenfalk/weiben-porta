/** lamejs is loaded as a classic script (public/vendor/lame.js), so it is a global. */
declare const lamejs: any;

interface Window {
  webkitAudioContext?: typeof AudioContext;
  /** hooks used by the external automated test, see testHooks.ts */
  __fyr: unknown;
}
