import { $ } from '../util.js';
/* The amber display. One line; when a message is wider than the display it glides sideways
   (see `#dialInner.run` in machine.css), pausing at both ends. */
const dial = $('dial'),
  dialText = $('dialText'),
  dialInner = $('dialInner');
const fitDial = () => {
  dialInner.classList.remove('run');
  const over = Math.ceil(dialInner.offsetWidth - dialText.clientWidth);
  if (over > 2) {
    void dialInner.offsetWidth;
    dialInner.classList.add('run');
    dialInner.style.setProperty('--shift', over + 'px');
    dialInner.style.setProperty('--dur', (over / 60 + 2.5).toFixed(1) + 's');
  }
};
addEventListener('resize', fitDial);
let toastTimer = 0;
export /** Show a message on the display (and in the settings dialog).
 * On a phone the display is hidden; there a message pops up as a toast for a few seconds (`.toast`, dialogs.css),
 * unless it only confirms what a button already shows: pass `{ quiet: true }` for those. */
const say = (t: string, opts: { quiet?: boolean } = {}) => {
  dialInner.textContent = t;
  fitDial();
  const d2 = document.getElementById('dial2');
  if (d2) d2.textContent = t;
  clearTimeout(toastTimer);
  if (opts.quiet) dial.classList.remove('toast');
  else {
    dial.classList.add('toast');
    toastTimer = window.setTimeout(() => dial.classList.remove('toast'), Math.min(9000, 2500 + t.length * 45));
  }
};
