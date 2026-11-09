import {
  app,
  BrowserWindow,
  Menu,
  WebContentsView,
  ipcMain,
  nativeTheme,
  session,
  shell,
  type Input,
  type NativeImage,
  type WebContents,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import {
  DEFAULT_SETTINGS,
  SEARCH_ENGINES,
  THEME_BACKGROUNDS,
  THEMES,
  type BrowserState,
  type PageEdges,
  type SearchEngine,
  type Settings,
  type Theme,
  type TabInfo,
  type TabsState,
  ACTIONS,
  MOUSE_BUTTONS,
  defaultBindings,
  keyCombo,
  type ActionId,
  type Bindings,
  type CustomBinding,
} from './shared';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

// Windows installer (Squirrel) launches the app several times during
// install/uninstall to create shortcuts. Quit right away in that case.
if (started) app.quit();

// Electron's default user agent contains "Electron/x.y.z" and the app name.
// Some sites (Google sign-in especially) block that, so present a plain
// Chrome user agent instead.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(new RegExp(`\\s${app.getName()}\\/\\S+`, 'i'), '');

// Must match --control-lg, --sidebar-width and --sidebar-collapsed in
// index.css (see the design rules in CLAUDE.md).
const TOOLBAR_HEIGHT = 48;
const SIDEBAR_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 48;

const APP_NAME = 'Browser';
const MAX_CLOSED_TABS = 25;

// Permissions websites get without asking. Everything else (camera, mic,
// location, notifications, USB...) is denied until we build a prompt for it.
const ALLOWED_PERMISSIONS = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
]);

interface Tab {
  id: number;
  view: WebContentsView;
  title: string;
  favicon: string | null;
  /** URL of a page that failed to load (we show an error page instead). */
  failedUrl: string | null;
  /** True until the first website loads: we show our search page instead. */
  isNewTab: boolean;
  /** Give focus back to the address bar once the first page has loaded. */
  focusAddressOnLoad: boolean;
}

let window: BrowserWindow | null = null;
let tabs: Tab[] = [];
let activeTabId: number | null = null;
let nextTabId = 1;
let closedTabUrls: string[] = [];
let htmlFullScreen = false;
let settingsOpen = false;

// ---------------------------------------------------------------- settings

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings: Settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    // Strip a byte-order mark some editors add, or JSON.parse fails.
    const text = fs.readFileSync(settingsFile(), 'utf-8').replace(/^﻿/, '');
    const saved = JSON.parse(text);
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...saved });
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Could not save settings', error);
  }
}

/** Never trust values coming from the UI or from disk. */
function sanitizeSettings(value: Partial<Settings>): Settings {
  const engine = value.searchEngine;
  const homePageText =
    typeof value.homePage === 'string' ? value.homePage.trim() : '';
  // Empty means "use the clean search page".
  const homePage = homePageText ? toUrl(homePageText, false) : '';
  return {
    searchEngine:
      typeof engine === 'string' && engine in SEARCH_ENGINES
        ? (engine as SearchEngine)
        : DEFAULT_SETTINGS.searchEngine,
    homePage: homePage ?? DEFAULT_SETTINGS.homePage,
    sidebarCollapsed: value.sidebarCollapsed === true,
    showDividers: value.showDividers !== false,
    smoothDividers: value.smoothDividers === true,
    forceDark: value.forceDark === true,
    scrollTabs: value.scrollTabs === true,
    bindings: sanitizeBindings(value.bindings),
    customBindings: sanitizeCustomBindings(value.customBindings),
    theme: THEMES.includes(value.theme as Theme)
      ? (value.theme as Theme)
      : DEFAULT_SETTINGS.theme,
    accentColor:
      typeof value.accentColor === 'string' &&
      /^#[0-9a-f]{6}$/i.test(value.accentColor)
        ? value.accentColor.toLowerCase()
        : DEFAULT_SETTINGS.accentColor,
  };
}

/** Applies the color mode to the window and tells websites about it. */
function applyTheme() {
  // Websites that support dark mode (prefers-color-scheme) follow our theme.
  nativeTheme.themeSource = settings.theme === 'light' ? 'light' : 'dark';
  if (window && !window.isDestroyed()) {
    window.setBackgroundColor(THEME_BACKGROUNDS[settings.theme]);
  }
  for (const tab of tabs) {
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.setBackgroundColor(tabBackground());
    }
  }
}

/** Known actions only, short strings only, and one action per binding. */
function sanitizeBindings(value: unknown): Bindings {
  const result = defaultBindings();
  if (!value || typeof value !== 'object') return result;
  const used = new Set<string>();
  for (const action of ACTIONS) {
    const binding = (value as Record<string, unknown>)[action.id];
    if (typeof binding !== 'string') continue;
    const clean = binding.length <= 40 && !used.has(binding) ? binding : '';
    result[action.id] = clean;
    if (clean) used.add(clean);
  }
  return result;
}

/** Up to 50 custom shortcuts, each with a web link or nothing yet. */
function sanitizeCustomBindings(value: unknown): CustomBinding[] {
  if (!Array.isArray(value)) return [];
  const result: CustomBinding[] = [];
  for (const item of value.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue;
    const { id, url, binding } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[a-z0-9]{1,16}$/.test(id)) continue;
    const text = typeof url === 'string' ? url.trim() : '';
    result.push({
      id,
      // Keep what was typed while it isn't a full address yet.
      url: text.length <= 2048 ? text : '',
      binding:
        typeof binding === 'string' && binding.length <= 40 ? binding : '',
    });
  }
  return result;
}

function sendSettings() {
  sendToUi('browser:settings', settings);
}

// ---------------------------------------------------------------- helpers

function isWebUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

/**
 * Turns whatever the user typed into a URL to load. Text that isn't a URL
 * becomes a search, unless allowSearch is false.
 */
function toUrl(input: string, allowSearch = true): string | null {
  const value = input.trim();
  if (!value) return null;

  let candidate: string;
  if (isWebUrl(value)) {
    candidate = value;
  } else if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(value)) {
    candidate = `http://${value}`;
  } else if (/^[^\s.]+\.[^\s]+$/.test(value)) {
    candidate = `https://${value}`;
  } else {
    return allowSearch ? searchUrl(value) : null;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    // Not a valid URL (e.g. "https://"), search for it instead.
  }
  return allowSearch ? searchUrl(value) : null;
}

function searchUrl(text: string) {
  return SEARCH_ENGINES[settings.searchEngine].url + encodeURIComponent(text);
}

function errorPage(url: string, description: string) {
  const escape = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]!,
    );
  const html = `<!doctype html><meta charset="utf-8"><title>Can't reach this page</title>
<style>body{font-family:system-ui,sans-serif;background:#111318;color:#e0e0e0;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:520px;padding:24px}h1{font-size:22px}code{color:#9fb4ff;word-break:break-all}p{color:#a0a4ad}</style>
<main><h1>Can't reach this page</h1><p><code>${escape(url)}</code></p><p>${escape(description)}</p></main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function uiContents(): WebContents | null {
  if (!window || window.isDestroyed()) return null;
  return window.webContents;
}

function sendToUi(channel: string, payload: unknown) {
  uiContents()?.send(channel, payload);
}

// ---------------------------------------------------------------- tabs

function findTab(id: number) {
  return tabs.find((tab) => tab.id === id);
}

function activeTab(): Tab | null {
  return activeTabId === null ? null : (findTab(activeTabId) ?? null);
}

function activeContents(): WebContents | null {
  const tab = activeTab();
  if (!tab || tab.view.webContents.isDestroyed()) return null;
  return tab.view.webContents;
}

/** The URL to show for a tab (the failed URL instead of the error page). */
function shownUrl(tab: Tab) {
  if (tab.isNewTab) return '';
  const current = tab.view.webContents.getURL();
  return current.startsWith('data:') && tab.failedUrl ? tab.failedUrl : current;
}

function tabTitle(tab: Tab) {
  if (tab.isNewTab) return 'New tab';
  if (tab.title) return tab.title;
  const url = shownUrl(tab);
  try {
    return new URL(url).hostname || 'New tab';
  } catch {
    return 'New tab';
  }
}

function sendTabs() {
  const payload: TabsState = {
    tabs: tabs.map(
      (tab): TabInfo => ({
        id: tab.id,
        title: tabTitle(tab),
        url: shownUrl(tab),
        favicon: tab.favicon,
        loading: tab.view.webContents.isLoading(),
        isNewTab: tab.isNewTab,
      }),
    ),
    activeTabId,
    sidebarCollapsed: settings.sidebarCollapsed,
    fullScreen: htmlFullScreen,
    settingsOpen,
  };
  sendToUi('browser:tabs', payload);
}

function sendState() {
  const tab = activeTab();
  if (!tab) return;
  const contents = tab.view.webContents;
  const state: BrowserState = {
    url: shownUrl(tab),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    loading: contents.isLoading(),
  };
  sendToUi('browser:state', state);
}

function updateWindowTitle() {
  const tab = activeTab();
  if (!window || window.isDestroyed()) return;
  if (settingsOpen) window.setTitle(`Settings - ${APP_NAME}`);
  else window.setTitle(tab ? `${tabTitle(tab)} - ${APP_NAME}` : APP_NAME);
}

/** Places the active tab's page next to the sidebar and under the toolbar. */
function layout() {
  if (!window || window.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  const left = htmlFullScreen
    ? 0
    : settings.sidebarCollapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : SIDEBAR_WIDTH;
  const top = htmlFullScreen ? 0 : TOOLBAR_HEIGHT;
  const bounds = {
    x: left,
    y: top,
    width: Math.max(0, width - left),
    height: Math.max(0, height - top),
  };

  for (const tab of tabs) {
    // The settings page covers the whole window and the new-tab search page
    // is drawn by our UI, so hide the web page in both cases.
    const visible = tab.id === activeTabId && !settingsOpen && !tab.isNewTab;
    tab.view.setVisible(visible);
    if (visible) tab.view.setBounds(bounds);
  }
  samplePageEdgesSoon();
}

// ---------------------------------------------------------------- page edges

/**
 * Most common color in a captured strip of the page. Backgrounds are usually
 * one flat color, so this ignores text and images that cross the strip.
 */
function dominantColor(image: NativeImage): string | null {
  const bitmap = image.toBitmap(); // BGRA, 4 bytes per pixel
  const counts = new Map<number, number>();
  let best = -1;
  let bestCount = 0;
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    const rgb = (bitmap[i + 2] << 16) | (bitmap[i + 1] << 8) | bitmap[i];
    const count = (counts.get(rgb) ?? 0) + 1;
    counts.set(rgb, count);
    if (count > bestCount) {
      best = rgb;
      bestCount = count;
    }
  }
  return best < 0 ? null : `#${best.toString(16).padStart(6, '0')}`;
}

let lastPageEdges = '';

/**
 * Smooth dividers fade the sidebar and toolbar into the page. Sample the
 * website's real edge colors so the gradient ends exactly on them.
 */
async function samplePageEdges() {
  const tab = activeTab();
  const visible =
    tab &&
    !tab.isNewTab &&
    !settingsOpen &&
    !htmlFullScreen &&
    settings.showDividers &&
    settings.smoothDividers;
  if (!tab || !visible || tab.view.webContents.isDestroyed()) return;

  const { width, height } = tab.view.getBounds();
  if (width < 8 || height < 8) return;
  try {
    const [left, top] = await Promise.all([
      tab.view.webContents.capturePage({ x: 0, y: 0, width: 2, height }),
      tab.view.webContents.capturePage({ x: 0, y: 0, width, height: 2 }),
    ]);
    const edges: PageEdges = {
      left: dominantColor(left),
      top: dominantColor(top),
    };
    const key = JSON.stringify(edges);
    if (key === lastPageEdges || tab.id !== activeTabId) return;
    lastPageEdges = key;
    sendToUi('browser:page-edges', edges);
  } catch {
    // The page was closed or is not painted yet; try again next time.
  }
}

/** Sample now and again shortly after, once late content has painted. */
function samplePageEdgesSoon() {
  void samplePageEdges();
  setTimeout(() => void samplePageEdges(), 600);
}

function activateTab(id: number) {
  const tab = findTab(id);
  if (!tab) return;
  activeTabId = id;
  settingsOpen = false;
  layout();
  sendTabs();
  sendState();
  updateWindowTitle();
  if (tab.isNewTab) focusAddressBar();
  else if (!tab.view.webContents.isDestroyed()) tab.view.webContents.focus();
}

function setSettingsOpen(open: boolean) {
  if (settingsOpen === open) return;
  settingsOpen = open;
  layout();
  sendTabs();
  sendSettings();
  updateWindowTitle();
  if (open) uiContents()?.focus();
  else if (activeTab()?.isNewTab) focusAddressBar();
  else activeContents()?.focus();
}

async function clearBrowsingData() {
  await session.defaultSession.clearStorageData();
  await session.defaultSession.clearCache();
  closedTabUrls = [];
}

/** Opens a tab. With no URL it shows the clean search page. */
function createTab(
  url: string | null,
  options: { activate?: boolean; nextToActive?: boolean } = {},
) {
  const win = window;
  if (!win || win.isDestroyed()) return null;
  const { activate = true, nextToActive = false } = options;

  const view = new WebContentsView({
    webPreferences: {
      // Only hosts the dark mode forcer; exposes nothing to websites.
      preload: path.join(__dirname, 'tab-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  view.setBackgroundColor(tabBackground());
  view.setVisible(false);

  const tab: Tab = {
    id: nextTabId++,
    view,
    title: '',
    favicon: null,
    failedUrl: null,
    isNewTab: !url,
    focusAddressOnLoad: false,
  };

  const activeIndex = tabs.findIndex((t) => t.id === activeTabId);
  if (nextToActive && activeIndex !== -1) {
    // Like Chrome: links open right below the tab they came from.
    tabs.splice(activeIndex + 1, 0, tab);
  } else {
    tabs.push(tab);
  }

  win.contentView.addChildView(view);
  wireTab(tab);

  if (url) {
    view.webContents.loadURL(url).catch(() => {
      // Load errors are shown by the did-fail-load handler.
    });
  }

  if (activate) activateTab(tab.id);
  else sendTabs();
  return tab;
}

function closeTab(id: number) {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  const [tab] = tabs.splice(index, 1);

  const url = shownUrl(tab);
  if (isWebUrl(url)) {
    closedTabUrls.push(url);
    closedTabUrls = closedTabUrls.slice(-MAX_CLOSED_TABS);
  }

  if (window && !window.isDestroyed()) {
    window.contentView.removeChildView(tab.view);
  }
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();

  if (tabs.length === 0) {
    // Closing the last tab closes the window, like other browsers.
    activeTabId = null;
    window?.close();
    return;
  }

  if (activeTabId === id) {
    // Prefer the tab below the closed one, otherwise the one above.
    activateTab(tabs[Math.min(index, tabs.length - 1)].id);
  } else {
    sendTabs();
  }
}

function moveTab(id: number, toIndex: number) {
  const from = tabs.findIndex((tab) => tab.id === id);
  if (from === -1) return;
  const [tab] = tabs.splice(from, 1);
  // toIndex counts the moved tab in its old place, so adjust when moving down.
  const target = Math.max(
    0,
    Math.min(tabs.length, from < toIndex ? toIndex - 1 : toIndex),
  );
  tabs.splice(target, 0, tab);
  sendTabs();
}

function cycleTab(step: number) {
  if (tabs.length < 2) return;
  const index = tabs.findIndex((tab) => tab.id === activeTabId);
  activateTab(tabs[(index + step + tabs.length) % tabs.length].id);
}

function newTab() {
  const tab = createTab(settings.homePage || null);
  // A loading website can grab keyboard focus; keep it in the address bar.
  if (tab && !tab.isNewTab) tab.focusAddressOnLoad = true;
  focusAddressBar();
}

function reopenClosedTab() {
  const url = closedTabUrls.pop();
  if (url) createTab(url);
}

function toggleSidebar() {
  settings.sidebarCollapsed = !settings.sidebarCollapsed;
  saveSettings();
  layout();
  sendTabs();
  sendSettings();
}

// ---------------------------------------------------------------- dark mode

/** Tab background before a page paints: dark while the forcer is on. */
function tabBackground() {
  // Shown for a moment before a page paints. Match the color mode so new
  // pages never flash white in dark / OLED mode.
  if (settings.forceDark) return '#0a0a0a';
  return THEME_BACKGROUNDS[settings.theme];
}

/**
 * The forcer itself lives in tab-preload.ts, inside each page, so it can
 * decide before the first paint. Here we only tell open pages when the
 * setting changes.
 */
function updateForcedDarkAll() {
  for (const tab of tabs) {
    if (tab.view.webContents.isDestroyed()) continue;
    tab.view.setBackgroundColor(tabBackground());
    tab.view.webContents.send('browser:force-dark', settings.forceDark);
  }
}

/** Hooks up all events for one tab's web page. */
function wireTab(tab: Tab) {
  const contents = tab.view.webContents;
  const isActive = () => tab.id === activeTabId;

  const changed = () => {
    sendTabs();
    if (isActive()) {
      sendState();
      updateWindowTitle();
    }
  };

  contents.on('did-navigate', changed);
  contents.on('did-navigate-in-page', changed);
  contents.on('did-start-loading', changed);
  contents.on('did-stop-loading', changed);
  contents.on('did-stop-loading', () => {
    if (isActive()) samplePageEdgesSoon();
  });

  contents.on('did-finish-load', () => {
    if (!tab.focusAddressOnLoad) return;
    tab.focusAddressOnLoad = false;
    if (isActive()) focusAddressBar();
  });

  contents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    if (!details.url.startsWith('data:')) tab.failedUrl = null;
    if (tab.isNewTab) {
      // First website in this tab: swap the search page for the web page.
      tab.isNewTab = false;
      if (isActive()) {
        layout();
        contents.focus();
      }
    }
    tab.favicon = null;
    tab.title = '';
  });

  contents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // -3 = ERR_ABORTED: the load was replaced by another one, not an error.
      if (!isMainFrame || errorCode === -3) return;
      tab.failedUrl = validatedURL;
      contents
        .loadURL(errorPage(validatedURL, errorDescription))
        .catch(() => {});
    },
  );

  contents.on('page-title-updated', (_event, title) => {
    tab.title = title;
    changed();
  });

  contents.on('page-favicon-updated', (_event, favicons) => {
    tab.favicon =
      favicons.find((icon) => /^(https?:|data:image\/)/i.test(icon)) ?? null;
    sendTabs();
  });

  contents.on('before-input-event', (event, input) => {
    if (handleShortcut(input)) event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (!isWebUrl(url)) return { action: 'deny' };

    // Real popups (window.open with a size), e.g. OAuth sign-in windows,
    // need to stay connected to the page that opened them.
    if (disposition === 'new-window' && window) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          parent: window,
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        },
      };
    }

    // target="_blank" links, Ctrl+click, middle click: open as a new tab.
    createTab(url, {
      activate: disposition !== 'background-tab',
      nextToActive: true,
    });
    return { action: 'deny' };
  });
  contents.on('did-create-window', setUpPopup);

  contents.on('will-navigate', (event, url) => {
    if (isWebUrl(url)) return;
    event.preventDefault();
    // Let the OS handle email/phone links.
    if (/^(mailto|tel):/i.test(url)) shell.openExternal(url).catch(() => {});
  });

  // Video/YouTube fullscreen: hide the sidebar and toolbar.
  contents.on('enter-html-full-screen', () => {
    htmlFullScreen = true;
    window?.setFullScreen(true);
    layout();
    sendTabs();
  });
  contents.on('leave-html-full-screen', () => {
    htmlFullScreen = false;
    window?.setFullScreen(false);
    layout();
    sendTabs();
  });

  // A page can close itself with window.close().
  contents.on('destroyed', () => {
    if (findTab(tab.id)) closeTab(tab.id);
  });
}

/** Popup windows (e.g. "Sign in with Google") opened by websites. */
function setUpPopup(popup: BrowserWindow) {
  popup.setMenuBarVisibility(false);
  popup.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) createTab(url);
    return { action: 'deny' };
  });
  popup.webContents.on('will-navigate', (event, url) => {
    if (!isWebUrl(url)) event.preventDefault();
  });
}

// ---------------------------------------------------------------- actions

function navigate(input: string) {
  const url = toUrl(input);
  const contents = activeContents();
  if (!url) return;
  if (!contents) {
    createTab(url);
    return;
  }
  contents.loadURL(url).catch(() => {});
  contents.focus();
}

function goBack() {
  const contents = activeContents();
  if (contents?.navigationHistory.canGoBack()) {
    contents.navigationHistory.goBack();
  }
}

function goForward() {
  const contents = activeContents();
  if (contents?.navigationHistory.canGoForward()) {
    contents.navigationHistory.goForward();
  }
}

function reload(ignoreCache = false) {
  const contents = activeContents();
  if (!contents) return;
  if (ignoreCache) contents.reloadIgnoringCache();
  else contents.reload();
}

function changeZoom(delta: number | null) {
  const contents = activeContents();
  if (!contents) return;
  const level = delta === null ? 0 : contents.getZoomLevel() + delta;
  contents.setZoomLevel(Math.max(-5, Math.min(5, level)));
}

function focusAddressBar() {
  const ui = uiContents();
  if (!ui) return;
  ui.focus();
  ui.send('browser:focus-address');
}

/** Runs one bindable action. */
function runAction(action: ActionId) {
  switch (action) {
    case 'reload':
      return reload();
    case 'hardReload':
      return reload(true);
    case 'back':
      return goBack();
    case 'forward':
      return goForward();
    case 'newTab':
      return newTab();
    case 'closeTab':
      if (activeTabId !== null) closeTab(activeTabId);
      return;
    case 'reopenTab':
      return reopenClosedTab();
    case 'nextTab':
      return cycleTab(1);
    case 'previousTab':
      return cycleTab(-1);
    case 'focusAddress':
      return focusAddressBar();
    case 'toggleSidebar':
      return toggleSidebar();
    case 'openSettings':
      return setSettingsOpen(!settingsOpen);
    case 'zoomIn':
      return changeZoom(0.5);
    case 'zoomOut':
      return changeZoom(-0.5);
    case 'zoomReset':
      return changeZoom(null);
    case 'devTools':
      return activeContents()?.toggleDevTools();
  }
}

/** What a key combo or mouse button does, if anything. */
function actionFor(binding: string): (() => void) | null {
  if (!binding) return null;
  const action = ACTIONS.find((a) => settings.bindings[a.id] === binding);
  if (action) return () => runAction(action.id);
  const custom = settings.customBindings.find((c) => c.binding === binding);
  const url = custom ? toUrl(custom.url, false) : null;
  if (url) return () => createTab(url);
  return null;
}

/** While the UI is recording a new binding, presses must not run actions. */
let recordingBinding = false;

/**
 * Keyboard handling for the UI and every tab. Only user-set bindings run
 * (by default just F5). Escape leaving settings / video fullscreen is
 * built-in behavior, not a binding.
 */
function handleShortcut(input: Input): boolean {
  if (input.type !== 'keyDown') return false;

  if (input.key === 'Escape' && settingsOpen && !recordingBinding) {
    setSettingsOpen(false);
    return true;
  }
  if (input.key === 'Escape' && htmlFullScreen) {
    activeContents()?.executeJavaScript('document.exitFullscreen()', true);
    return true;
  }
  if (recordingBinding) return false;

  const action = actionFor(
    keyCombo({
      key: input.key,
      ctrl: input.control,
      alt: input.alt,
      shift: input.shift,
      meta: input.meta,
    }),
  );
  if (!action) return false;
  action();
  return true;
}

// ---------------------------------------------------------------- window

function createWindow() {
  htmlFullScreen = false;
  settingsOpen = false;
  tabs = [];
  activeTabId = null;

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 700,
    minHeight: 400,
    title: APP_NAME,
    backgroundColor: THEME_BACKGROUNDS[settings.theme],
    autoHideMenuBar: true,
    // No system title bar: our own bars go to the top edge and draw their
    // own window buttons. macOS keeps its native traffic lights instead.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window = win;

  win.on('resize', layout);
  // The UI page loses focus whenever you click into a website, so tell it
  // about the real window focus (for the grey traffic lights).
  win.on('focus', () => sendToUi('browser:window-focus', true));
  win.on('blur', () => sendToUi('browser:window-focus', false));
  win.on('maximize', layout);
  win.on('unmaximize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);

  // Our own UI must never navigate away or open windows.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  // The window title shows the active tab, not the UI page's own <title>.
  win.on('page-title-updated', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (event, input) => {
    if (handleShortcut(input)) event.preventDefault();
  });

  // Send everything again when the UI (re)loads.
  win.webContents.on('did-finish-load', () => {
    sendSettings();
    sendTabs();
    sendState();
  });

  win.on('closed', () => {
    const closing = tabs;
    tabs = [];
    activeTabId = null;
    if (window === win) window = null;
    for (const tab of closing) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  createTab(settings.homePage || null);
}

function setUpMenu() {
  if (process.platform === 'darwin') {
    // macOS needs an app + Edit menu or copy/paste shortcuts stop working.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]),
    );
  } else {
    // On Windows/Linux the default menu's "Reload" would reload the UI
    // instead of the page. Our shortcuts are handled in handleShortcut().
    Menu.setApplicationMenu(null);
  }
}

function setUpIpc() {
  // Only accept messages from our own UI, never from web pages.
  const fromUi = (sender: WebContents) => sender === uiContents();
  const isId = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value);

  ipcMain.on('browser:navigate', (event, url: unknown) => {
    if (fromUi(event.sender) && typeof url === 'string') navigate(url);
  });
  ipcMain.on('browser:back', (event) => fromUi(event.sender) && goBack());
  ipcMain.on('browser:forward', (event) => fromUi(event.sender) && goForward());
  ipcMain.on('browser:reload', (event) => fromUi(event.sender) && reload());
  ipcMain.on(
    'browser:stop',
    (event) => fromUi(event.sender) && activeContents()?.stop(),
  );
  ipcMain.on('browser:new-tab', (event) => fromUi(event.sender) && newTab());
  ipcMain.on('browser:close-tab', (event, id: unknown) => {
    if (fromUi(event.sender) && isId(id)) closeTab(id);
  });
  ipcMain.on('browser:activate-tab', (event, id: unknown) => {
    if (fromUi(event.sender) && isId(id)) activateTab(id);
  });
  ipcMain.on('browser:move-tab', (event, id: unknown, toIndex: unknown) => {
    if (fromUi(event.sender) && isId(id) && isId(toIndex)) moveTab(id, toIndex);
  });
  ipcMain.on(
    'browser:toggle-sidebar',
    (event) => fromUi(event.sender) && toggleSidebar(),
  );
  // Mouse side buttons, reported by the UI and by tab-preload.ts in pages.
  ipcMain.on('browser:mouse-button', (event, button: unknown) => {
    const fromTab = tabs.some((tab) => tab.view.webContents === event.sender);
    if (!fromUi(event.sender) && !fromTab) return;
    if (recordingBinding || typeof button !== 'number') return;
    const action = actionFor(MOUSE_BUTTONS[button] ?? '');
    action?.();
  });
  ipcMain.on('browser:recording-binding', (event, on: unknown) => {
    if (fromUi(event.sender)) recordingBinding = on === true;
  });
  // Our own window buttons (the window has no system title bar).
  ipcMain.on('browser:window', (event, action: unknown) => {
    if (!fromUi(event.sender) || !window || window.isDestroyed()) return;
    if (action === 'close') window.close();
    else if (action === 'minimize') window.minimize();
    else if (action === 'maximize') {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    }
  });
  ipcMain.on('browser:set-settings-open', (event, open: unknown) => {
    if (fromUi(event.sender) && typeof open === 'boolean') {
      setSettingsOpen(open);
    }
  });
  ipcMain.on('browser:update-settings', (event, changes: unknown) => {
    if (!fromUi(event.sender) || typeof changes !== 'object' || !changes) {
      return;
    }
    const before = settings.sidebarCollapsed;
    const beforeTheme = settings.theme;
    const beforeDark = settings.forceDark;
    settings = sanitizeSettings({ ...settings, ...changes });
    saveSettings();
    sendSettings();
    if (settings.theme !== beforeTheme) applyTheme();
    if (settings.forceDark !== beforeDark) updateForcedDarkAll();
    if (settings.sidebarCollapsed !== before) {
      layout();
      sendTabs();
    }
  });
  // Read-only, used by tab-preload.ts in every website tab.
  ipcMain.on('browser:force-dark-get', (event) => {
    event.returnValue = settings.forceDark;
  });
  ipcMain.handle('browser:clear-data', async (event) => {
    if (!fromUi(event.sender)) return false;
    await clearBrowsingData();
    return true;
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(
    (_contents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    },
  );
  session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );

  loadSettings();
  applyTheme();
  setUpIpc();
  // Pages change color as you scroll or switch dark mode: keep checking.
  setInterval(() => void samplePageEdges(), 1500);
  setUpMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
