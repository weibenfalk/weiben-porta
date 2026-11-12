import { $ } from '../util.js';
import { say } from './display.js';
/* Installable app: registers the service worker (production only) and shows an "install" button when the browser offers it.
   iOS Safari has no install prompt; there it is Share, then Add to Home Screen. */

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function wirePwa() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  const btn = $<HTMLButtonElement>('installBtn');
  let offered: InstallPrompt | null = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    offered = e as InstallPrompt;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!offered) return;
    const p = offered;
    offered = null;
    btn.hidden = true;
    await p.prompt();
    if ((await p.userChoice).outcome === 'accepted') say('installed.');
  });
  window.addEventListener('appinstalled', () => {
    btn.hidden = true;
  });
}
