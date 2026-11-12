import { $ } from '../util.js';
/* The amber display. One line; when a message is wider than the display it glides sideways
   (see `#dialInner.run` in machine.css), pausing at both ends. */
const dialText = $('dialText'),
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
export /** Show a message on the display (and in the settings dialog). */
const say = (t: string) => {
  dialInner.textContent = t;
  fitDial();
  const d2 = document.getElementById('dial2');
  if (d2) d2.textContent = t;
};
