// Spectacular window opening/closing.
//
// A window can't tilt, blur or fly in 3D, so a stand-in does it: a
// transparent, click-through overlay covering the screen plays the
// animation with a picture of Nya, and hands over to the real window on the
// first (closing) or last (opening) frame, where both look identical.
//
//   Opening: rises from below, tilted back and blurred, overshoots a little
//            and settles, with an accent glow blooming behind it.
//   Closing: tips back into the screen, shrinks, blurs and fades out.
import os from 'node:os';
import {
  BrowserWindow,
  screen,
  type NativeImage,
  type Rectangle,
} from 'electron';

export const OPEN_MS = 640;
export const CLOSE_MS = 420;

/** One picture inside the window (the UI, or a web page on top of it). */
export interface Layer {
  image: NativeImage;
  /** Position inside the window's content area, in DIPs. */
  bounds: Rectangle;
}

// Runs inside the overlay. Kept as plain JS so it can live in a data: URL.
const OVERLAY_HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  .frame { position: absolute; overflow: hidden; transform-origin: 50% 100%;
           will-change: transform, opacity, filter; }
  .frame img { position: absolute; display: block; }
  .glow { position: absolute; border-radius: 50%; opacity: 0;
          pointer-events: none; will-change: transform, opacity; }
</style></head>
<body><script>
  let frame = null;
  let glow = null;
  const P = 'perspective(2000px) ';

  // Resolves once Chromium considers this page visible again (it isn't
  // while the overlay waits off-screen) and is drawing frames.
  window.whenVisible = () => new Promise((resolve) => {
    const done = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
    if (document.visibilityState === 'visible') return done();
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', check);
      done();
    };
    document.addEventListener('visibilitychange', check);
  });

  // Puts the window picture on screen in its first pose. Resolves once that
  // pose has actually been painted.
  window.prepare = async (o) => {
    document.body.textContent = '';
    glow = document.createElement('div');
    glow.className = 'glow';
    const gw = o.rect.width * 1.1, gh = o.rect.height * 0.9;
    Object.assign(glow.style, {
      left: o.rect.x + (o.rect.width - gw) / 2 + 'px',
      top: o.rect.y + (o.rect.height - gh) / 2 + 'px',
      width: gw + 'px', height: gh + 'px',
      background: 'radial-gradient(closest-side, ' + o.accent + ', transparent)',
    });
    frame = document.createElement('div');
    frame.className = 'frame';
    Object.assign(frame.style, {
      left: o.rect.x + 'px', top: o.rect.y + 'px',
      width: o.rect.width + 'px', height: o.rect.height + 'px',
      borderRadius: o.radius + 'px', background: o.background,
      opacity: o.kind === 'open' ? '0' : '1',
    });
    const images = o.layers.map((layer) => {
      const img = new Image();
      img.src = layer.src;
      Object.assign(img.style, {
        left: layer.x + 'px', top: layer.y + 'px',
        width: layer.width + 'px', height: layer.height + 'px',
      });
      frame.append(img);
      return img.decode().catch(() => {});
    });
    document.body.append(glow, frame);
    await Promise.all(images);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  // Overall clock is linear; each segment has its own easing so the motion
  // is spread over the whole duration instead of happening in a blink.
  window.animate = (kind, duration) => {
    const out = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
    const inOut = 'cubic-bezier(0.45, 0, 0.55, 1)';
    const accel = 'cubic-bezier(0.55, 0, 0.9, 0.5)';
    if (kind === 'open') {
      glow.animate([
        { opacity: 0, transform: 'scale(0.4)', easing: out },
        { opacity: 0.6, transform: 'scale(1)', offset: 0.5, easing: inOut },
        { opacity: 0, transform: 'scale(1.3)' },
      ], { duration: duration * 1.3, fill: 'forwards' });
      return frame.animate([
        { opacity: 0, filter: 'blur(18px)', easing: out,
          transform: P + 'translateY(160px) rotateX(32deg) scale(0.66)',
          boxShadow: '0 0 0 rgba(0,0,0,0)' },
        { opacity: 1, filter: 'blur(0px)', offset: 0.62, easing: inOut,
          transform: P + 'translateY(-10px) rotateX(-4deg) scale(1.03)',
          boxShadow: '0 40px 120px rgba(0,0,0,0.55)' },
        { offset: 0.84, filter: 'blur(0px)', easing: inOut,
          transform: P + 'translateY(3px) rotateX(1deg) scale(0.994)' },
        { opacity: 1, filter: 'blur(0px)',
          transform: P + 'translateY(0px) rotateX(0deg) scale(1)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)' },
      ], { duration, fill: 'forwards' }).finished.then(() => true);
    }
    return frame.animate([
      { opacity: 1, filter: 'blur(0px)', easing: out,
        transform: P + 'translateY(0px) rotateX(0deg) scale(1)' },
      { opacity: 1, filter: 'blur(1px)', offset: 0.4, easing: accel,
        transform: P + 'translateY(8px) rotateX(14deg) scale(0.88)' },
      { opacity: 0, filter: 'blur(16px)',
        transform: P + 'translateY(96px) rotateX(38deg) scale(0.5)' },
    ], { duration, fill: 'forwards' }).finished.then(() => true);
  };

  window.clear = () => { document.body.textContent = ''; frame = glow = null; };
</script></body></html>`;

let overlay: BrowserWindow | null = null;
let overlayLoaded: Promise<boolean> | null = null;

/** Creates the overlay ahead of time so animations start instantly. */
export function prepareOverlay() {
  if (overlay && !overlay.isDestroyed()) return;
  overlay = new BrowserWindow({
    // Shown once and never hidden: only its opacity changes. Showing a
    // window makes Windows play its own fade, which would ghost ours.
    show: false,
    // Tool window: never in Alt+Tab or the taskbar.
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    width: 1,
    height: 1,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep animating while it's an invisible, unfocused window.
      backgroundThrottling: false,
    },
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  const win = overlay;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  overlayLoaded = win
    .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`)
    .then(() => {
      if (win.isDestroyed()) return false;
      // Stays shown and screen-sized, but waits off-screen: Chromium counts
      // even a transparent window on top as covering Nya, which would pause
      // videos and throttle pages.
      win.setBounds(screen.getPrimaryDisplay().bounds);
      park(win);
      win.showInactive();
      return true;
    })
    .catch(() => false);
  win.on('closed', () => {
    if (overlay === win) {
      overlay = null;
      overlayLoaded = null;
    }
  });
}

function park(win: BrowserWindow) {
  win.setPosition(-40000, -40000);
}

export function destroyOverlay() {
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null;
  overlayLoaded = null;
}

/** Windows 11 rounds window corners (8px) unless maximized. */
function cornerRadius(win: BrowserWindow) {
  if (process.platform !== 'win32') return 0;
  if (win.isMaximized() || win.isFullScreen()) return 0;
  const build = Number(os.release().split('.')[2] ?? 0);
  return build >= 22000 ? 8 : 0;
}

function toDataUrl(image: NativeImage) {
  return `data:image/jpeg;base64,${image.toJPEG(92).toString('base64')}`;
}

interface PlayOptions {
  win: BrowserWindow;
  layers: Layer[];
  background: string;
  accent: string;
}

/**
 * Plays one animation. `swap` runs at the hand-over moment (closing: right
 * after the stand-in covers the window, to hide it; opening: at the end, to
 * show the real window). Returns false if the overlay couldn't play.
 */
export async function playWindowAnimation(
  kind: 'open' | 'close',
  options: PlayOptions,
  swap: () => void | Promise<void>,
): Promise<boolean> {
  const { win } = options;
  if (!overlay || overlay.isDestroyed() || !overlayLoaded) return false;
  if (!(await overlayLoaded) || overlay.isDestroyed() || win.isDestroyed()) {
    return false;
  }

  const content = win.getContentBounds();
  const display = screen.getDisplayMatching(content);
  const area = display.bounds;
  overlay.setBounds(area);

  const run = (code: string) => overlay!.webContents.executeJavaScript(code);
  const payload = {
    kind,
    accent: options.accent,
    background: options.background,
    radius: cornerRadius(win),
    rect: {
      x: content.x - area.x,
      y: content.y - area.y,
      width: content.width,
      height: content.height,
    },
    layers: options.layers
      .filter((layer) => !layer.image.isEmpty())
      .map((layer) => ({ src: toDataUrl(layer.image), ...layer.bounds })),
  };

  try {
    // Back on screen: wait until it really draws again before using it.
    await Promise.race([
      run('whenVisible()'),
      new Promise((r) => setTimeout(r, 400)),
    ]);
    await run(`prepare(${JSON.stringify(payload)})`);
    if (kind === 'close') {
      // Let the stand-in reach the screen before the real window goes.
      await new Promise((r) => setTimeout(r, 48));
      await swap();
    }
    await run(`animate('${kind}', ${kind === 'open' ? OPEN_MS : CLOSE_MS})`);
    if (kind === 'open') {
      await swap();
      // Let the real window paint before the stand-in disappears.
      await new Promise((r) => setTimeout(r, 50));
    }
    return true;
  } catch {
    if (kind === 'open') await swap();
    return false;
  } finally {
    if (overlay && !overlay.isDestroyed()) {
      const win = overlay;
      run('clear()')
        .catch(() => {})
        .finally(() => {
          if (!win.isDestroyed()) park(win);
        });
    }
  }
}
