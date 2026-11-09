
import { app, BrowserWindow, WebContentsView, ipcMain } from 'electron';
import path from 'node:path';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let window: BrowserWindow;
let page: WebContentsView;

const TOOLBAR_HEIGHT = 64;

function navigate(input: string) {
  const value = input.trim();
  if (!value) return;

  let url: string;

  if (/^https?:\/\//i.test(value)) {
    url = value;
  } else if (
    /^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value)
  ) {
    url = `http://${value}`;
  } else if (
    /^[^\s.]+\.[^\s]+$/.test(value)
  ) {
    url = `https://${value}`;
  } else {
    url = `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  }

  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) return;

  page.webContents.loadURL(url).catch(console.error);
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  page = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.contentView.addChildView(page);

  const resize = () => {
    const [width, height] = window.getContentSize();

    page.setBounds({
      x: 0,
      y: TOOLBAR_HEIGHT,
      width,
      height: Math.max(0, height - TOOLBAR_HEIGHT),
    });
  };

  window.on('resize', resize);
  resize();

  const updateAddress = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(
        'browser:url-changed',
        page.webContents.getURL()
      );
    }
  };

  page.webContents.on('did-navigate', updateAddress);
  page.webContents.on('did-navigate-in-page', updateAddress);

  page.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }));

  page.webContents.on('will-navigate', (event, url) => {
    if (!/^https?:\/\//i.test(url)) event.preventDefault();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  navigate('https://www.google.com');
}

app.whenReady().then(() => {
  ipcMain.on('browser:navigate', (_event, url: string) => {
    if (typeof url === 'string') navigate(url);
  });

  ipcMain.on('browser:back', () => {
    if (page.webContents.navigationHistory.canGoBack())
      page.webContents.navigationHistory.goBack();
  });

  ipcMain.on('browser:forward', () => {
    if (page.webContents.navigationHistory.canGoForward())
      page.webContents.navigationHistory.goForward();
  });

  ipcMain.on('browser:reload', () => {
    page.webContents.reload();
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
