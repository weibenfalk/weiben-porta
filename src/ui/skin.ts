import { $ } from '../util.js';
import { say } from './display.js';
/* Two looks for the same machine: black plastic (default) and the original teak and aluminium.
   index.html sets data-skin before first paint; this module only switches and remembers it. */

type Skin = 'black' | 'wood';
const KEY = 'weibenporta.skin';
const THEME_COLOR: Record<Skin, string> = { black: '#161617', wood: '#7b4a26' };

const current = (): Skin => (document.documentElement.dataset.skin === 'wood' ? 'wood' : 'black');

function applySkin(s: Skin) {
  document.documentElement.dataset.skin = s;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[s]);
  try {
    localStorage.setItem(KEY, s);
  } catch (e) {}
}

export function wireSkin() {
  applySkin(current());
  $('skinBtn').addEventListener('click', () => {
    const next: Skin = current() === 'black' ? 'wood' : 'black';
    applySkin(next);
    say(next === 'black' ? 'black plastic skin.' : 'teak and aluminium skin.', { quiet: true });
  });
}
