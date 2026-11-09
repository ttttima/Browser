// Runs inside every website tab before the site's own scripts, in an
// isolated world: the site cannot see or call anything here. It only hosts
// the built-in dark mode forcer, so it can decide before the first paint and
// the page never flashes.
import { ipcRenderer } from 'electron';

/**
 * Inverts the page's colors and turns the hues back (blue stays blue), then
 * flips photos, videos and embeds back so they look normal. contrast()
 * softens pure black and white a little.
 */
const DARK_CSS = `
html {
  filter: invert(1) hue-rotate(180deg) contrast(0.92) !important;
  background-color: #fff !important;
}
img,
video,
canvas,
iframe,
embed,
object,
svg image,
[style*="background-image" i] {
  filter: invert(1) hue-rotate(180deg) !important;
}
[style*="background-image" i] img {
  filter: none !important;
}
`;

/** Shown until we know whether the page is light: never a white flash. */
const WAIT_CSS = `html { background-color: #0a0a0a !important; }`;

/** A page lighter than this gets darkened. The gap avoids flip-flopping. */
const DARKEN_ABOVE = 0.5;
const RECHECK_MARGIN = 0.15;

let enabled = ipcRenderer.sendSync('browser:force-dark-get') === true;
let darkened = false;
let darkStyle: HTMLStyleElement | null = null;
let waitStyle: HTMLStyleElement | null = null;

function addStyle(css: string) {
  const style = document.createElement('style');
  style.textContent = css;
  // Our own element on <html>, so the site's scripts can't easily remove it
  // by rewriting <head>.
  document.documentElement.append(style);
  return style;
}

/** How light the page's own background is: 0 = black, 1 = white. */
function pageLightness() {
  // Measure the site's colors, not ours.
  if (darkStyle) darkStyle.disabled = true;
  if (waitStyle) waitStyle.disabled = true;
  const light = (element: Element | null) => {
    if (!element) return null;
    const parts = getComputedStyle(element).backgroundColor.match(/[\d.]+/g);
    if (!parts) return null;
    const [r, g, b, a = 1] = parts.map(Number);
    if (a < 0.5) return null;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  const value = light(document.body) ?? light(document.documentElement) ?? 1;
  if (darkStyle) darkStyle.disabled = false;
  if (waitStyle) waitStyle.disabled = false;
  return value;
}

function setDarkened(on: boolean) {
  darkened = on;
  if (on && !darkStyle) darkStyle = addStyle(DARK_CSS);
  if (!on && darkStyle) {
    darkStyle.remove();
    darkStyle = null;
  }
}

function stopWaiting() {
  waitStyle?.remove();
  waitStyle = null;
}

/**
 * Called when <body> appears. The site's render-blocking CSS is loaded by
 * then but nothing is painted yet, so the choice is made before the first
 * frame.
 */
function decide() {
  if (!enabled) return;
  setDarkened(pageLightness() >= DARKEN_ABOVE);
  stopWaiting();
}

/** Once fully loaded, fix the choice only if the page clearly changed. */
function recheck() {
  if (!enabled) return;
  const lightness = pageLightness();
  if (darkened && lightness < DARKEN_ABOVE - RECHECK_MARGIN) {
    setDarkened(false);
  } else if (!darkened && lightness > DARKEN_ABOVE + RECHECK_MARGIN) {
    setDarkened(true);
  }
}

function start() {
  if (enabled && document.documentElement) waitStyle = addStyle(WAIT_CSS);
  if (document.body) {
    decide();
    return;
  }
  const observer = new MutationObserver(() => {
    if (!document.body) return;
    observer.disconnect();
    decide();
  });
  observer.observe(document, { childList: true, subtree: true });
}

if (document.documentElement) {
  start();
} else {
  // Very early: wait for <html> to exist.
  const observer = new MutationObserver(() => {
    if (!document.documentElement) return;
    observer.disconnect();
    start();
  });
  observer.observe(document, { childList: true });
}

window.addEventListener('load', () => setTimeout(recheck, 300));

// The setting was switched while the page is open.
ipcRenderer.on('browser:force-dark', (_event, on: unknown) => {
  enabled = on === true;
  if (!enabled) {
    stopWaiting();
    setDarkened(false);
  } else if (document.body) {
    setDarkened(pageLightness() >= DARKEN_ABOVE);
  }
});
