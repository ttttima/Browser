// Runs inside every website tab before the site's own scripts, in an
// isolated world: the site cannot see or call anything here. It hosts the
// built-in dark mode forcer (here so it can decide before the first paint
// and the page never flashes), the mouse side buttons and the password
// helper.
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
 * The tab's own background matches the browser's color mode (so new pages
 * don't flash white). A page that never sets a background expects the
 * browser default instead, so give it that: `Canvas` is white for normal
 * pages and dark for pages that declare a dark color scheme.
 */
function keepDefaultBackground() {
  const clear = (element: Element | null) =>
    !element ||
    /^(transparent|rgba\(0, 0, 0, 0\))$/.test(
      getComputedStyle(element).backgroundColor,
    );
  if (clear(document.documentElement) && clear(document.body)) {
    addStyle(':root { background-color: Canvas; }');
  }
}

/**
 * Called when <body> appears. The site's render-blocking CSS is loaded by
 * then but nothing is painted yet, so the choice is made before the first
 * frame.
 */
function decide() {
  keepDefaultBackground();
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

// Mouse side buttons (back / forward by default) are user bindings, so
// report them instead of letting the page handle them.
window.addEventListener(
  'mouseup',
  (event) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.send('browser:mouse-button', event.button);
  },
  true,
);

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

// ---------------------------------------------------------------- passwords
//
// Tells Nya when the page shows a sign-in form (so it can offer a saved
// login) and when one is sent (so it can offer to save it). Filling happens
// only after the user clicks "Fill in" in Nya's bar. Only the page itself
// takes part, never frames inside it.

const isTopPage =
  window === window.top && /^https?:$/.test(window.location.protocol);

function visible(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && !element.closest('[hidden]');
}

function passwordFields(): HTMLInputElement[] {
  return [
    ...document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ].filter(visible);
}

/** The username field that belongs to a password field. */
function usernameFor(password: HTMLInputElement): HTMLInputElement | null {
  const scope: ParentNode = password.form ?? document;
  const named = scope.querySelector<HTMLInputElement>(
    'input[autocomplete="username"], input[autocomplete="email"]',
  );
  if (named && visible(named)) return named;
  // Otherwise the last text-like field before the password.
  const inputs = [...scope.querySelectorAll<HTMLInputElement>('input')];
  const before = inputs.slice(0, inputs.indexOf(password)).reverse();
  return (
    before.find(
      (input) =>
        ['text', 'email', 'tel', ''].includes(input.type) && visible(input),
    ) ?? null
  );
}

let formReported = false;
let lastSent = '';

function reportForm() {
  if (formReported || passwordFields().length === 0) return;
  formReported = true;
  ipcRenderer.send('nya:login-form');
}

function captureLogin() {
  const password = passwordFields().find((field) => field.value);
  if (!password) return;
  const username = usernameFor(password)?.value.trim() ?? '';
  const key = `${username}\n${password.value}`;
  if (key === lastSent) return;
  lastSent = key;
  ipcRenderer.send('nya:login-submitted', username, password.value);
}

if (isTopPage) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const check = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      reportForm();
    }, 400);
  };
  window.addEventListener('DOMContentLoaded', () => {
    check();
    new MutationObserver(check).observe(document.body ?? document, {
      childList: true,
      subtree: true,
    });
  });

  // Sent by a form, a button, or Enter in the password field.
  window.addEventListener('submit', captureLogin, true);
  window.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, input[type="submit"], [role="button"]')) {
        captureLogin();
      }
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Enter' &&
        (event.target as HTMLElement)?.matches?.('input')
      ) {
        captureLogin();
      }
    },
    true,
  );

  // The user chose "Fill in" in Nya's bar.
  ipcRenderer.on(
    'nya:login-fill',
    (_event, username: unknown, password: unknown) => {
      if (typeof username !== 'string' || typeof password !== 'string') return;
      const field = passwordFields()[0];
      if (!field) return;
      // Set values the way typing does, so sites built with React etc. notice.
      const setValue = (input: HTMLInputElement, value: string) => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const user = usernameFor(field);
      if (user && username) setValue(user, username);
      setValue(field, password);
      lastSent = `${username}\n${password}`;
      field.focus();
    },
  );
}
