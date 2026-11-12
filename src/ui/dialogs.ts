import { $ } from '../util.js';
import { diagText } from './diagnostics.js';
import { say } from './display.js';
/* The help, settings and "throw away" dialogs. */

export const openDlg = (d: HTMLDialogElement) => {
  if (d.open) return;
  if (typeof d.showModal === 'function') d.showModal();
  else d.setAttribute('open', '');
};
export const closeDlg = (d: HTMLDialogElement) => {
  if (typeof d.close === 'function') d.close();
  else d.removeAttribute('open');
};

export function wireDialogs() {
  document.querySelectorAll<HTMLDialogElement>('dialog.sheet').forEach(d => {
    // a tap on the dimmed background closes the dialog
    d.addEventListener('click', e => {
      if (e.target === d) closeDlg(d);
    });
    d.querySelectorAll('.x, .done').forEach(b => b.addEventListener('click', () => closeDlg(d)));
  });

  $('openHelp').addEventListener('click', () => openDlg($<HTMLDialogElement>('helpDlg')));
  // the help opens by itself the first time the page is visited
  try {
    if (!localStorage.getItem('weibenporta.seen')) {
      localStorage.setItem('weibenporta.seen', '1');
      openDlg($<HTMLDialogElement>('helpDlg'));
    }
  } catch (e) {}

  $('openSettings').addEventListener('click', () => {
    $('dial2').textContent = '';
    $('diag').textContent = diagText();
    openDlg($<HTMLDialogElement>('settingsDlg'));
  });
  const paintDiag = () => {
    $('diag').textContent = diagText();
  };
  setInterval(() => {
    if ($<HTMLDialogElement>('settingsDlg').open) paintDiag();
  }, 1000);
  $('diagCopy').addEventListener('click', async () => {
    const t = diagText();
    paintDiag();
    try {
      await navigator.clipboard.writeText(t);
      say('diagnostics copied.', { quiet: true });
    } catch (e) {
      const r = document.createRange();
      r.selectNodeContents($('diag'));
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      say('diagnostics selected. press ctrl or cmd + C to copy.', { quiet: true });
    }
  });
}
