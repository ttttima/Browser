// Auto-refresh indicator in the toolbar (Settings → Features, "Auto-refresh
// by holding F5"). While F5 is held it shows what letting go after 2 s will
// do and fills up; while auto-refresh is on it shows "Every 0.5 s" in the
// selected style, and a click stops it. main.ts does the holding and the
// reloading.
import type { BrowserState } from './shared';
import { $, icon, terra } from './ui-common';

const chip = $<HTMLButtonElement>('#refresh-chip');

let on = false;
/** 'on' / 'off': F5 is held and will turn auto-refresh on / off. */
let holding: string | null = null;

function render() {
  chip.hidden = !on && !holding;
  chip.classList.toggle('on', on && !holding);
  chip.classList.toggle('holding', !!holding);
  const label = holding
    ? holding === 'on'
      ? 'Hold to auto-refresh'
      : 'Hold to stop'
    : 'Every 0.5 s';
  chip.innerHTML = `${icon('refresh', 'icon-sm')}<span>${label}</span>`;
  chip.title = on ? 'Auto-refresh is on: click to stop' : label;
}

window.browser.onStateChanged((state: BrowserState) => {
  on = state.autoRefresh;
  render();
});

terra.on<string | null>('terra:refresh-hold', (value) => {
  holding = value;
  // Restart the fill animation for each new hold.
  chip.classList.remove('holding');
  void chip.offsetWidth;
  render();
});

chip.addEventListener('click', () => terra.send('terra:auto-refresh-stop'));
