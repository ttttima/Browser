import {
  app,
  BrowserWindow,
  Menu,
  components,
  desktopCapturer,
  dialog,
  webContents as allWebContents,
  WebContentsView,
  ipcMain,
  nativeTheme,
  session,
  shell,
  systemPreferences,
  type Input,
  type NativeImage,
  type Session,
  type WebContents,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachAdblock, initAdblock } from './adblock';
import {
  getBookmarks,
  initBookmarks,
  isBookmarked,
  removeBookmark,
  createFolder,
  deleteFolder,
  getFolders,
  moveBookmark,
  renameBookmark,
  renameFolder,
  setBookmarkFavicon,
  toggleBookmark,
} from './bookmarks';
import { showEditMenu, showPageMenu } from './context-menu';
import { importFrom, importSources } from './importer';
import {
  canStorePasswords,
  deleteLogin,
  importPasswordsCsv,
  initPasswords,
  isSaved,
  listLogins,
  loginsFor,
  revealPassword,
  saveLogin,
} from './passwords';
import { loadSession, saveSession } from './session-store';
import {
  adsAllowed,
  getPermission,
  getSites,
  getZoom,
  initSites,
  originOf,
  passwordsNeverSaved,
  resetSite,
  setAdsAllowed,
  setNeverSavePasswords,
  setPermission,
  setZoom,
} from './site-settings';
import { localSuggestions, remoteSuggestions } from './suggest';
import {
  checkForUpdate,
  installUpdate,
  updatesSupported,
  type ReadyUpdate,
} from './updater';
import started from 'electron-squirrel-startup';
import {
  defaultBrowserSupported,
  isDefaultBrowser,
  openDefaultAppsSettings,
  FILE_EXTENSIONS,
  registerAsBrowser,
  unregisterAsBrowser,
} from './default-browser';
import { copyNyaData, removeNyaApp } from './from-nya';
import {
  clearDownloads,
  clearHistory,
  deleteHistoryEntry,
  deleteHistoryUrl,
  downloadAction,
  getDownloads,
  getHistory,
  initDownloads,
  initHistory,
  openDownloadsFolder,
  recordVisit,
  updateVisitTitle,
} from './library';
import {
  DEFAULT_SETTINGS,
  GLASS_COLORS,
  type GlassColors,
  SEARCH_ENGINES,
  themeBackground,
  THEMES,
  type BrowserState,
  type PageEdges,
  type SearchEngine,
  type Settings,
  type Theme,
  type TabInfo,
  type TabsState,
  ACTIONS,
  BINDINGS_VERSION,
  MOUSE_BUTTONS,
  defaultBindings,
  keyCombo,
  type ActionId,
  type Bindings,
  type CustomBinding,
  type DefaultBrowserState,
  type DownloadAction,
  type PanelPage,
  type Rect,
  type Notice,
  type PageSecurity,
  type PermissionDecision,
  PANEL_PAGES,
} from './shared';
import {
  destroyOverlay,
  overlaySourceId,
  playWindowAnimation,
  prepareOverlay,
  type Layer,
} from './window-animation';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

// Windows installer (Squirrel) launches the app several times during
// install/uninstall to create shortcuts. Quit right away in that case.
if (process.argv.includes('--squirrel-uninstall')) unregisterAsBrowser();
if (started) app.quit();

// Terra used to be called Nya: bring Nya's data over on the first start,
// before anything in Terra's own folder is opened.
const fromNya = started ? null : copyNyaData();

// One running Terra: links opened from other apps start a second copy, which
// hands them to the first (see 'second-instance') and quits. Development
// copies skip this so they can run next to the installed app.
const isFirstInstance =
  started || !app.isPackaged || app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();

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
/** Rounded corners of the web page (= --radius-page in index.css). */
const PAGE_RADIUS = 35;

const APP_NAME = 'Terra';
const MAX_CLOSED_TABS = 25;

// Permissions websites get without asking. Others are asked about in the
// bar under the toolbar (see setUpSession), and the rest are denied.
const AUTO_ALLOWED = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'keyboardLock',
  'speaker-selection',
  // Protected video and music (Netflix, Spotify...) through Widevine.
  'mediaKeySystem',
]);

/** Height of the question bar under the toolbar (= --control-lg). */
const NOTICE_HEIGHT = 48;
const PRIVATE_PARTITION = 'terra-private';

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
  /** History entry of the page shown now (to add its title later). */
  historyId: string | null;
  pinned: boolean;
  audible: boolean;
  /** Private tab: separate in-memory session, nothing is remembered. */
  isPrivate: boolean;
  /** Restored tab that loads only when first opened. */
  lazyUrl: string | null;
}

let window: BrowserWindow | null = null;
let tabs: Tab[] = [];
let activeTabId: number | null = null;
let nextTabId = 1;
let closedTabUrls: string[] = [];
let htmlFullScreen = false;
let settingsOpen = false;
/** Web pages are hidden while the window zooms in or out (see animations). */
let windowAnimating = false;
/** The address bar dropdown covers the page (a picture is shown instead). */
let suggestOpen = false;
/** The next download asks where to save ("Save image as..."). */
let askNextDownload = false;
/** Stop saving the session once the window is closing. */
let sessionFrozen = false;
/** Decisions made in private tabs, forgotten when the last one closes. */
const privateDecisions = new Map<string, PermissionDecision>();
let readyUpdate: ReadyUpdate | null = null;

// ---------------------------------------------------------------- settings

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings: Settings = { ...DEFAULT_SETTINGS };

/**
 * Settings from before the app had a name lived in the old app folder.
 * Copy them over once so nobody loses their setup.
 */
function migrateOldSettings() {
  const target = settingsFile();
  if (fs.existsSync(target)) return;
  for (const oldName of ['browser', 'Browser']) {
    const old = path.join(app.getPath('appData'), oldName, 'settings.json');
    if (path.resolve(old) === path.resolve(target) || !fs.existsSync(old)) {
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(old, target);
      return;
    } catch {
      // Not important enough to stop the app from starting.
    }
  }
}

function loadSettings() {
  migrateOldSettings();
  try {
    // Strip a byte-order mark some editors add, or JSON.parse fails.
    const text = fs.readFileSync(settingsFile(), 'utf-8').replace(/^﻿/, '');
    const saved = JSON.parse(text);
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...saved });
    if (!(Number(saved.bindingsVersion) >= BINDINGS_VERSION)) {
      addNewDefaultBindings();
      saveSettings();
    }
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

/**
 * Settings saved by an older Terra: give every action the user never bound
 * its new default shortcut, unless that key is already used for something.
 */
function addNewDefaultBindings() {
  const used = new Set([
    ...Object.values(settings.bindings),
    ...settings.customBindings.map((custom) => custom.binding),
  ]);
  for (const action of ACTIONS) {
    if (settings.bindings[action.id] || !action.binding) continue;
    if (used.has(action.binding)) continue;
    settings.bindings[action.id] = action.binding;
    used.add(action.binding);
  }
  settings.bindingsVersion = BINDINGS_VERSION;
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
    autoCompactSidebar: value.autoCompactSidebar === true,
    showDividers: value.showDividers !== false,
    smoothDividers: value.smoothDividers === true,
    forceDark: value.forceDark === true,
    scrollTabs: value.scrollTabs === true,
    askDownloadLocation: value.askDownloadLocation === true,
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
    liquidGlass: value.liquidGlass === true,
    // "Background tint" became "Behind the window".
    glassColors:
      (value.glassColors as string | undefined) === 'tint'
        ? 'behind'
        : GLASS_COLORS.includes(value.glassColors as GlassColors)
          ? (value.glassColors as GlassColors)
          : DEFAULT_SETTINGS.glassColors,
    backgroundTint:
      value.backgroundTint === 'accent' ||
      (typeof value.backgroundTint === 'string' &&
        /^#[0-9a-f]{6}$/i.test(value.backgroundTint))
        ? (value.backgroundTint as string).toLowerCase()
        : '',
    windowAnimations: value.windowAnimations !== false,
    bindingsVersion: Number.isInteger(value.bindingsVersion)
      ? Number(value.bindingsVersion)
      : 1,
    startup: value.startup === 'newTab' ? 'newTab' : 'restore',
    searchSuggestions: value.searchSuggestions === true,
    blockAds: value.blockAds !== false,
    offerPasswords: value.offerPasswords !== false,
    clearOnExit: value.clearOnExit === true,
    autoUpdate: value.autoUpdate !== false,
  };
}

/**
 * Liquid glass showing what's behind the window: Windows' acrylic material,
 * which blurs the desktop and apps behind Terra live (the system compositor
 * does it, so moving the window or anything changing behind it updates by
 * itself, at no cost to Terra). Not in OLED dark, and not when Windows'
 * transparency effects are off.
 */
function glassBehind() {
  return (
    settings.liquidGlass &&
    settings.glassColors === 'behind' &&
    settings.theme !== 'oled' &&
    process.platform === 'win32' &&
    !nativeTheme.prefersReducedTransparency
  );
}

/** The window's own background: acrylic for "behind" glass, else solid. */
function applyWindowMaterial(win: BrowserWindow) {
  if (win.isDestroyed()) return;
  const behind = glassBehind();
  win.setBackgroundMaterial(behind ? 'acrylic' : 'none');
  win.setBackgroundColor(behind ? '#00000000' : themeBackground(settings));
}

/** Applies the color mode to the window and tells websites about it. */
function applyTheme() {
  // Websites that support dark mode (prefers-color-scheme) follow our theme.
  nativeTheme.themeSource = settings.theme === 'light' ? 'light' : 'dark';
  if (window && !window.isDestroyed()) applyWindowMaterial(window);
  for (const tab of tabs) {
    if (pageOf(tab)) {
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

  // Local files: "C:\folder\page.html" or "file:///C:/...".
  if (/^[a-z]:[\\/]/i.test(value)) return pathToFileURL(value).href;
  if (/^file:\/\//i.test(value)) {
    try {
      return new URL(value).href;
    } catch {
      return null;
    }
  }
  if (/^view-source:https?:\/\//i.test(value)) return value;

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

/**
 * A tab's page, or null once it is gone. When a page is destroyed (e.g.
 * while the app quits) Electron removes it entirely, so never touch
 * tab.view.webContents directly.
 */
function pageOf(tab: Tab | null | undefined): WebContents | null {
  const contents = tab?.view.webContents as WebContents | undefined;
  return contents && !contents.isDestroyed() ? contents : null;
}

function activeContents(): WebContents | null {
  return pageOf(activeTab());
}

/** The URL to show for a tab (the failed URL instead of the error page). */
function shownUrl(tab: Tab) {
  if (tab.isNewTab) return '';
  if (tab.lazyUrl) return tab.lazyUrl;
  const current = pageOf(tab)?.getURL() ?? '';
  return current.startsWith('data:') && tab.failedUrl ? tab.failedUrl : current;
}

function tabTitle(tab: Tab) {
  if (tab.isNewTab) return tab.isPrivate ? 'Private tab' : 'New tab';
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
        loading: pageOf(tab)?.isLoading() ?? false,
        isNewTab: tab.isNewTab,
        pinned: tab.pinned,
        audible: tab.audible,
        muted: pageOf(tab)?.isAudioMuted() ?? false,
        isPrivate: tab.isPrivate,
      }),
    ),
    activeTabId,
    sidebarCollapsed: settings.sidebarCollapsed,
    fullScreen: htmlFullScreen,
    settingsOpen,
  };
  sendToUi('browser:tabs', payload);
  persistSession();
}

/** Remembers the open tabs (not private ones) for the next start. */
function persistSession() {
  if (sessionFrozen) return;
  const saved = tabs.filter((tab) => !tab.isPrivate && !tab.isNewTab);
  const active = saved.findIndex((tab) => tab.id === activeTabId);
  saveSession({
    tabs: saved
      .map((tab) => ({
        url: shownUrl(tab),
        title: tabTitle(tab),
        pinned: tab.pinned,
      }))
      .filter((tab) => /^(https?|file):/i.test(tab.url)),
    active: Math.max(0, active),
  });
}

function securityOf(url: string): PageSecurity {
  if (/^https:/i.test(url)) return 'secure';
  if (/^http:/i.test(url)) return 'insecure';
  if (/^file:/i.test(url)) return 'local';
  return 'none';
}

function sendState() {
  const tab = activeTab();
  const contents = pageOf(tab);
  if (!tab || !contents) return;
  const state: BrowserState = {
    url: shownUrl(tab),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    loading: contents.isLoading(),
    zoom: Math.round(contents.getZoomFactor() * 100),
    security: securityOf(shownUrl(tab)),
    bookmarked: isBookmarked(shownUrl(tab)),
    isPrivate: tab.isPrivate,
  };
  sendToUi('browser:state', state);
}

function updateWindowTitle() {
  const tab = activeTab();
  if (!window || window.isDestroyed()) return;
  if (settingsOpen) window.setTitle(`Settings - ${APP_NAME}`);
  else window.setTitle(tab ? `${tabTitle(tab)} - ${APP_NAME}` : APP_NAME);
}

/** Where web pages go: next to the sidebar and under the toolbar. */
function pageBounds(win: BrowserWindow): Rect {
  const [width, height] = win.getContentSize();
  const left = htmlFullScreen
    ? 0
    : settings.sidebarCollapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : SIDEBAR_WIDTH;
  const notice =
    !htmlFullScreen && !settingsOpen && visibleNotice() ? NOTICE_HEIGHT : 0;
  const top = htmlFullScreen ? 0 : TOOLBAR_HEIGHT + notice;
  return {
    x: left,
    y: top,
    width: Math.max(0, width - left),
    height: Math.max(0, height - top),
  };
}

/** Places the active tab's page next to the sidebar and under the toolbar. */
/**
 * Whether this tab's web page is on screen. The settings page covers the
 * whole window and the new-tab search page is drawn by our UI, so the web
 * page is hidden in both cases, and during animations that use a picture.
 */
function pageShouldShow(tab: Tab) {
  return (
    tab.id === activeTabId &&
    !settingsOpen &&
    !tab.isNewTab &&
    !tab.lazyUrl &&
    !windowAnimating &&
    !suggestOpen
  );
}

function layout() {
  if (!window || window.isDestroyed()) return;
  const bounds = pageBounds(window);

  for (const tab of tabs) {
    const visible = pageShouldShow(tab) && !sidebarSliding;
    // A rounded card next to the sidebar and toolbar; edge to edge in
    // video fullscreen.
    tab.view.setBorderRadius(htmlFullScreen ? 0 : PAGE_RADIUS);
    tab.view.setVisible(visible);
    // While the page moves with the sidebar (slidePageLive), it's placed by
    // that animation, not here.
    if (visible) tab.view.setBounds(liveBounds ?? bounds);
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
  if (!tab || !visible || !pageOf(tab)) return;

  const { width, height } = tab.view.getBounds();
  if (width < 8 || height < 8) return;
  try {
    const [left, top] = await Promise.all([
      pageOf(tab)!.capturePage({ x: 0, y: 0, width: 2, height }),
      pageOf(tab)!.capturePage({ x: 0, y: 0, width, height: 2 }),
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
  samplePageColorsSoon();
}

// ------------------------------------------------- liquid glass page colors

/** Hue in degrees (0-360) of an RGB color. */
function hueOf(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (!delta) return 0;
  const h =
    max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}

/**
 * The page's main colors for the liquid glass light: the vivid colors that
 * cover the most of it, up to three with clearly different hues. A page
 * with none (plain white or black) gives just its main color.
 */
function pagePalette(image: NativeImage): string[] {
  const bitmap = image.resize({ width: 48, quality: 'good' }).toBitmap(); // BGRA
  const buckets = new Map<
    number,
    { n: number; r: number; g: number; b: number }
  >();
  let total = 0;
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    const b = bitmap[i];
    const g = bitmap[i + 1];
    const r = bitmap[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
    total++;
  }
  const colors = [...buckets.values()].map((bucket) => {
    const r = bucket.r / bucket.n;
    const g = bucket.g / bucket.n;
    const b = bucket.b / bucket.n;
    const max = Math.max(r, g, b);
    return {
      r,
      g,
      b,
      n: bucket.n,
      saturation: max ? (max - Math.min(r, g, b)) / max : 0,
      value: max / 255,
      hue: hueOf(r, g, b),
    };
  });
  const hex = (c: { r: number; g: number; b: number }) =>
    `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const vivid = colors
    .filter((c) => c.saturation > 0.25 && c.value > 0.2 && c.n >= total * 0.002)
    .sort((a, b) => b.n * b.saturation - a.n * a.saturation);
  const picked: typeof colors = [];
  for (const color of vivid) {
    const apart = picked.every((p) => {
      const distance = Math.abs(p.hue - color.hue);
      return Math.min(distance, 360 - distance) > 30;
    });
    if (apart) picked.push(color);
    if (picked.length === 3) break;
  }
  if (picked.length) return picked.map(hex);
  const main = colors.sort((a, b) => b.n - a.n)[0];
  return main ? [hex(main)] : [];
}

let lastPageColors = '';
/** While the page's colors keep changing: a sample every 250 ms. */
const PAGE_COLORS_FAST_MS = 250;
/** While they stay the same: every 750 ms, so a still page costs little. */
const PAGE_COLORS_SLOW_MS = 750;
/** How long after a change the fast rate is kept. */
const PAGE_COLORS_FAST_FOR_MS = 3000;
let pageColorsLoop: ReturnType<typeof setTimeout> | null = null;
let pageColorsChangedAt = 0;
let samplingPageColors = false;

/** Glass is on with "Open website" colors, so page colors are needed. */
function pageColorsWanted() {
  return (
    settings.liquidGlass &&
    settings.glassColors === 'page' &&
    settings.theme !== 'oled'
  );
}

/** A palette's identity, ignoring tiny changes (noise, video grain). */
function paletteKey(colors: string[] | null) {
  if (!colors) return 'none';
  return colors
    .map((hex) =>
      [1, 3, 5]
        .map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) / 12))
        .join(','),
    )
    .join('|');
}

/**
 * Sends the open website's main colors to the UI, or null when no website
 * is showing (new tab page, settings): the glass then uses the accent.
 * One small picture of the visible page; nothing leaves this computer.
 */
async function samplePageColors() {
  if (!pageColorsWanted() || samplingPageColors) return;
  if (!window || window.isDestroyed() || window.isMinimized()) return;
  if (!window.isVisible()) return;
  samplingPageColors = true;
  try {
    const tab = activeTab();
    const contents = tab ? pageOf(tab) : null;
    let colors: string[] | null = null;
    if (tab && contents && pageShouldShow(tab) && !htmlFullScreen) {
      // Covered by other windows, Chromium stops drawing the page and a
      // picture would be a blank gray: keep the last real colors instead.
      // A busy page may answer late: never let it hold up the loop.
      const shown = await Promise.race([
        contents
          .executeJavaScript('document.visibilityState', false)
          .catch(() => 'hidden'),
        wait(250).then(() => 'busy'),
      ]);
      if (shown !== 'visible') return;
      // Times out (null) if no picture comes: keep the last colors too.
      const picture = await capture(contents);
      if (!picture || tab.id !== activeTabId) return;
      colors = pagePalette(picture);
    }
    const key = paletteKey(colors);
    if (key === lastPageColors) return;
    lastPageColors = key;
    pageColorsChangedAt = Date.now();
    sendToUi('terra:page-colors', colors);
  } finally {
    samplingPageColors = false;
  }
}

/**
 * Real time: keeps sampling while "Open website" glass is in use, fast
 * while the colors are changing (scrolling, video, loading) and slower
 * once they settle. Stops by itself when the option is off.
 */
function runPageColorsLoop() {
  if (pageColorsLoop) clearTimeout(pageColorsLoop);
  pageColorsLoop = null;
  if (!pageColorsWanted() || !window || window.isDestroyed()) return;
  const changing = Date.now() - pageColorsChangedAt < PAGE_COLORS_FAST_FOR_MS;
  pageColorsLoop = setTimeout(
    () => {
      void samplePageColors().finally(runPageColorsLoop);
    },
    changing ? PAGE_COLORS_FAST_MS : PAGE_COLORS_SLOW_MS,
  );
}

/**
 * Something changed (a page loaded, another tab, a resize): sample almost
 * right away and keep the fast rate for a while.
 */
function samplePageColorsSoon() {
  if (!pageColorsWanted()) {
    runPageColorsLoop(); // stops it
    return;
  }
  pageColorsChangedAt = Date.now();
  if (pageColorsLoop) clearTimeout(pageColorsLoop);
  pageColorsLoop = setTimeout(() => {
    void samplePageColors().finally(runPageColorsLoop);
  }, 80);
}

function activateTab(id: number) {
  const tab = findTab(id);
  if (!tab) return;
  if (activeTabId !== id) sendToUi('terra:find-close', null);
  activeTabId = id;
  settingsOpen = false;
  if (tab.lazyUrl) {
    const url = tab.lazyUrl;
    tab.lazyUrl = null;
    pageOf(tab)
      ?.loadURL(url)
      .catch(() => {});
  }
  sendNotice();
  layout();
  sendTabs();
  sendState();
  updateWindowTitle();
  if (tab.isNewTab) focusAddressBar();
  else pageOf(tab)?.focus();
}

/** Opens the full-window panel on one page (e.g. History). */
function showPanelPage(page: PanelPage) {
  setSettingsOpen(true);
  sendToUi('browser:show-page', page);
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
  clearHistory();
}

/** Opens a tab. With no URL it shows the clean search page. */
function createTab(
  url: string | null,
  options: {
    activate?: boolean;
    nextToActive?: boolean;
    /** First of the unpinned tabs (scrolling past the top). */
    atTop?: boolean;
    isPrivate?: boolean;
    pinned?: boolean;
    /** Restored tab: show it, but load only when it's opened. */
    lazyTitle?: string;
  } = {},
) {
  const win = window;
  if (!win || win.isDestroyed()) return null;
  const { activate = true, nextToActive = false } = options;
  const isPrivate = options.isPrivate === true;
  if (isPrivate) setUpPrivateSession();

  const view = new WebContentsView({
    webPreferences: {
      // Hosts the dark mode forcer and the password helper; exposes
      // nothing to websites.
      preload: path.join(__dirname, 'tab-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Built-in PDF viewer.
      plugins: true,
      spellcheck: true,
      // Private tabs live in a session that is only kept in memory.
      ...(isPrivate ? { partition: PRIVATE_PARTITION } : {}),
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
    historyId: null,
    pinned: options.pinned === true,
    audible: false,
    isPrivate,
    lazyUrl: options.lazyTitle !== undefined ? url : null,
  };
  if (options.lazyTitle) tab.title = options.lazyTitle;

  const activeIndex = tabs.findIndex((t) => t.id === activeTabId);
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  if (tab.pinned || options.atTop) {
    tabs.splice(pinnedCount, 0, tab);
  } else if (nextToActive && activeIndex !== -1) {
    // Like Chrome: links open right below the tab they came from.
    tabs.splice(Math.max(pinnedCount, activeIndex + 1), 0, tab);
  } else {
    tabs.push(tab);
  }

  win.contentView.addChildView(view);
  wireTab(tab);

  if (url && !tab.lazyUrl) {
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
  dropNotices(tab.id);

  const url = shownUrl(tab);
  if (isWebUrl(url) && !tab.isPrivate) {
    closedTabUrls.push(url);
    closedTabUrls = closedTabUrls.slice(-MAX_CLOSED_TABS);
  }

  if (window && !window.isDestroyed()) {
    window.contentView.removeChildView(tab.view);
  }
  pageOf(tab)?.close();
  if (tab.isPrivate && !tabs.some((t) => t.isPrivate)) clearPrivateSession();

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
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  // Pinned tabs stay above the others.
  const [min, max] = tab.pinned ? [0, pinnedCount] : [pinnedCount, tabs.length];
  const target = Math.max(
    min,
    Math.min(max, from < toIndex ? toIndex - 1 : toIndex),
  );
  tabs.splice(target, 0, tab);
  sendTabs();
}

function togglePin(id: number) {
  const tab = findTab(id);
  if (!tab) return;
  tabs.splice(tabs.indexOf(tab), 1);
  tab.pinned = !tab.pinned;
  // Pinning puts it last among pinned tabs; unpinning, first of the rest.
  const pinnedCount = tabs.filter((t) => t.pinned).length;
  tabs.splice(pinnedCount, 0, tab);
  sendTabs();
}

function toggleMute(id: number) {
  const contents = pageOf(findTab(id));
  if (!contents) return;
  contents.setAudioMuted(!contents.isAudioMuted());
  sendTabs();
}

function duplicateTab(id: number) {
  const tab = findTab(id);
  const url = tab ? shownUrl(tab) : '';
  if (!tab || !url) return;
  createTab(url, { nextToActive: true, isPrivate: tab.isPrivate });
}

function newPrivateTab() {
  createTab(null, { isPrivate: true });
  focusAddressBar();
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

/** The empty new tab page "Scroll through tabs" opened past the top. */
let scrolledNewTabId: number | null = null;

/**
 * "Scroll through tabs": one wheel step over the sidebar (-1 up, 1 down).
 * Scrolling up past the first tab opens a fresh new tab page (search) at
 * the top; scrolling on without using it tidies it away again, so no
 * empty tabs pile up.
 */
function scrollTabs(step: number) {
  const index = tabs.findIndex((t) => t.id === activeTabId);
  const current = tabs[index];
  if (!current) return;
  if (step < 0 && index === 0) {
    if (current.isNewTab) return; // already on a fresh new tab page
    const tab = createTab(null, { atTop: true });
    scrolledNewTabId = tab?.id ?? null;
    focusAddressBar();
    return;
  }
  const next = tabs[index + step];
  if (!next) return;
  activateTab(next.id);
  if (current.id === scrolledNewTabId) {
    scrolledNewTabId = null;
    if (current.isNewTab) closeTab(current.id);
  }
}

function reopenClosedTab() {
  const url = closedTabUrls.pop();
  if (url) createTab(url);
}

/** Same as --duration in index.css: the sidebar slide's length. */
const SLIDE_MS = 150;
/** The web page is swapped for a picture while the sidebar slides. */
let sidebarSliding = false;
/** The picture is being taken: clicks meanwhile wait for it, then flip. */
let slidePreparing: Promise<void> | null = null;
let slideEndTimer: ReturnType<typeof setTimeout> | null = null;
let slideShotShown: (() => void) | null = null;
/** Where the page is right now while it moves with the sidebar. */
let liveBounds: Rect | null = null;
let liveTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Compact <-> normal sidebar. The UI slides the width; the web page is a
 * separate layer that can't follow frame by frame, so for the slide it's
 * replaced by a picture of itself in the UI, then put back at its new size.
 *
 * Every click flips right away, even mid-slide: the slide just turns around
 * from where it is (it's a CSS transition), and the page comes back once
 * the clicking stops. So it can be clicked as fast as anyone likes.
 */
async function toggleSidebar() {
  if (slidePreparing) await slidePreparing;
  // Someone is typing in the web page (it has the keyboard focus): don't
  // swap it for a picture, which would take the focus and drop keys. Move
  // the real page along with the sidebar instead.
  const tab = activeTab();
  const contents = pageOf(tab);
  const typingInPage =
    !sidebarSliding &&
    !!window &&
    !!tab &&
    !!contents &&
    pageShouldShow(tab) &&
    (contents.isFocused() || liveTimer !== null) &&
    !systemPreferences.getAnimationSettings().prefersReducedMotion;
  if (typingInPage && window) {
    const from = liveBounds ?? pageBounds(window);
    settings.sidebarCollapsed = !settings.sidebarCollapsed;
    saveSettings();
    sendTabs();
    sendSettings();
    slidePageLive(from, pageBounds(window));
    return;
  }
  if (!sidebarSliding && window) {
    slidePreparing = coverPageForSlide();
    await slidePreparing;
    slidePreparing = null;
  }
  settings.sidebarCollapsed = !settings.sidebarCollapsed;
  saveSettings();
  sendTabs();
  sendSettings();
  if (!sidebarSliding) {
    layout();
    return;
  }
  if (slideEndTimer) clearTimeout(slideEndTimer);
  slideEndTimer = setTimeout(() => void endSlide(), SLIDE_MS + 32);
}

/** CSS's "ease" curve, cubic-bezier(0.25, 0.1, 0.25, 1): the UI's slide. */
function cssEase(t: number) {
  const curve = (a: number, b: number, u: number) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  let low = 0;
  let high = 1;
  let u = t;
  for (let i = 0; i < 20; i++) {
    u = (low + high) / 2;
    if (curve(0.25, 0.25, u) < t) low = u;
    else high = u;
  }
  return curve(0.1, 1, u);
}

/**
 * Moves the visible web page from one place to another on the same curve
 * and in the same time as the sidebar's CSS slide, keeping it visible and
 * focused. A new toggle mid-way starts again from where the page is.
 */
function slidePageLive(from: Rect, to: Rect) {
  if (liveTimer) clearInterval(liveTimer);
  // Starts right away: the UI's slide starts as soon as it hears about it,
  // and the page has the longer way to go (a native move per step).
  const start = Date.now();
  const step = () => {
    const progress = Math.min(1, Math.max(0, (Date.now() - start) / SLIDE_MS));
    const eased = cssEase(progress);
    const mix = (a: number, b: number) => Math.round(a + (b - a) * eased);
    liveBounds = {
      x: mix(from.x, to.x),
      y: mix(from.y, to.y),
      width: mix(from.width, to.width),
      height: mix(from.height, to.height),
    };
    const page = activeTab()?.view;
    if (page) page.setBounds(liveBounds);
    if (progress >= 1) {
      if (liveTimer) clearInterval(liveTimer);
      liveTimer = null;
      liveBounds = null;
      layout();
    }
  };
  liveBounds = from;
  liveTimer = setInterval(step, 8);
}

/** Shows a picture of the web page in its place and hides the real one. */
async function coverPageForSlide() {
  const tab = activeTab();
  const contents = pageOf(tab);
  if (
    !window ||
    !tab ||
    !contents ||
    !pageShouldShow(tab) ||
    systemPreferences.getAnimationSettings().prefersReducedMotion
  ) {
    return;
  }
  const picture = await capture(contents);
  if (!picture || !window || window.isDestroyed()) return;
  const shown = new Promise<void>((resolve) => {
    slideShotShown = resolve;
    setTimeout(resolve, 200);
  });
  sendToUi('terra:slide-shot', {
    image: `data:image/jpeg;base64,${picture.toJPEG(90).toString('base64')}`,
    bounds: pageBounds(window),
  });
  await shown;
  slideShotShown = null;
  sidebarSliding = true;
  layout();
}

/** The clicking stopped: the real page comes back at its new size. */
async function endSlide() {
  slideEndTimer = null;
  sidebarSliding = false;
  layout();
  // Let the page paint at its new size before the picture goes, unless a
  // new slide started meanwhile and needs it.
  await wait(48);
  if (!sidebarSliding && !slidePreparing) {
    sendToUi('terra:slide-shot-clear', null);
  }
}

// ---------------------------------------------------------------- dark mode

/** Tab background before a page paints: dark while the forcer is on. */
function tabBackground() {
  // Shown for a moment before a page paints. Match the color mode so new
  // pages never flash white in dark / OLED mode.
  if (settings.forceDark) return '#0a0a0a';
  return themeBackground(settings);
}

/**
 * The forcer itself lives in tab-preload.ts, inside each page, so it can
 * decide before the first paint. Here we only tell open pages when the
 * setting changes.
 */
function updateForcedDarkAll() {
  for (const tab of tabs) {
    if (!pageOf(tab)) continue;
    tab.view.setBackgroundColor(tabBackground());
    pageOf(tab)?.send('browser:force-dark', settings.forceDark);
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

  // Speaker icon on tabs that play sound.
  contents.on('audio-state-changed', (event) => {
    tab.audible = event.audible;
    sendTabs();
  });

  contents.on('found-in-page', (_event, result) => {
    if (!isActive()) return;
    sendToUi('terra:find-result', {
      active: result.activeMatchOrdinal,
      total: result.matches,
    });
  });

  contents.on('context-menu', (_event, params) => {
    if (!window || window.isDestroyed()) return;
    const url = shownUrl(tab);
    showPageMenu(window, contents, params, {
      openTab: (link, options = {}) =>
        createTab(link, {
          nextToActive: true,
          activate: !options.background,
          isPrivate: options.private || tab.isPrivate,
        }),
      saveAs: (link) => {
        askNextDownload = true;
        contents.downloadURL(link);
      },
      search: (text) =>
        createTab(searchUrl(text), {
          nextToActive: true,
          isPrivate: tab.isPrivate,
        }),
      searchEngineName: SEARCH_ENGINES[settings.searchEngine].name,
      print: () => printPage(contents),
      savePage: () => void savePageAs(contents),
      viewSource: () => viewSource(tab),
      toggleBookmark: () => toggleBookmarkFor(tab),
      isBookmarked: isBookmarked(url),
      isPrivate: tab.isPrivate,
    });
  });

  // Ctrl + mouse wheel.
  contents.on('zoom-changed', (_event, direction) =>
    changeZoomFor(tab, direction === 'in' ? 0.5 : -0.5),
  );

  // Each site opens at the zoom it had last time.
  contents.on('did-navigate', (_event, url) => applySiteZoom(tab, url));

  // History: every page you go to, including in-page navigation on sites
  // like YouTube that change the address without reloading.
  const remember = (url: string) => {
    if (!isWebUrl(url) || tab.isPrivate) return;
    tab.historyId = recordVisit(url, contents.getTitle());
  };
  contents.on('did-navigate', (_event, url) => remember(url));
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) remember(url);
  });
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
    dropNotices(tab.id, true);
    if (!details.url.startsWith('data:')) tab.failedUrl = null;
    if (tab.isNewTab) {
      // First website in this tab: swap the search page for the web page.
      tab.isNewTab = false;
      if (isActive()) {
        layout();
        contents.focus();
      }
    }
  });

  // A new page really loaded: forget the old title and icon. (Not on
  // did-start-navigation: a link that turns out to be a download never
  // leaves the page, and the tab would lose its title.)
  contents.on('did-navigate', () => {
    tab.favicon = null;
    tab.title =
      contents.getTitle() === contents.getURL() ? '' : contents.getTitle();
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
    if (tab.historyId) updateVisitTitle(tab.historyId, title);
    changed();
  });

  contents.on('page-favicon-updated', (_event, favicons) => {
    tab.favicon =
      favicons.find((icon) => /^(https?:|data:image\/)/i.test(icon)) ?? null;
    // Bookmarks show the site's icon in the sidebar. Not from private tabs.
    if (tab.favicon && !tab.isPrivate) {
      setBookmarkFavicon(shownUrl(tab), tab.favicon);
    }
    sendTabs();
  });

  contents.on('before-input-event', (event, input) => {
    if (handleShortcut(input)) event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (!isWebUrl(url)) {
      openOutsideLink(tab, url);
      return { action: 'deny' };
    }

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
      isPrivate: tab.isPrivate,
    });
    return { action: 'deny' };
  });
  contents.on('did-create-window', setUpPopup);

  contents.on('will-navigate', (event, url) => {
    if (isWebUrl(url)) return;
    // Local pages may link to other local files.
    if (/^file:/i.test(url) && /^file:/i.test(contents.getURL())) return;
    event.preventDefault();
    openOutsideLink(tab, url);
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

/**
 * Links for other apps: email and phone links open right away; anything
 * else (spotify:, zoommtg:, ...) asks first.
 */
function openOutsideLink(tab: Tab, url: string) {
  if (/^(mailto|tel):/i.test(url)) {
    shell.openExternal(url).catch(() => {});
    return;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  const ignored = [
    'javascript',
    'data',
    'about',
    'blob',
    'file',
    'chrome',
    'devtools',
    'view-source',
  ];
  if (!scheme || ignored.includes(scheme)) return;
  const site = hostLabel(originOf(shownUrl(tab))) || 'This page';
  void ask({
    kind: 'external',
    tabId: tab.id,
    text: `${site} wants to open a “${scheme}” link in another app`,
    actions: [
      { id: 'open', label: 'Open app' },
      { id: 'cancel', label: 'Cancel' },
    ],
  }).then((response) => {
    if (response.action === 'open') shell.openExternal(url).catch(() => {});
  });
}

/** "example.com" for "https://www.example.com". */
function hostLabel(origin: string) {
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
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
  const tab = activeTab();
  if (tab) changeZoomFor(tab, delta);
}

/** Zooms a tab and remembers the zoom for its site. */
function changeZoomFor(tab: Tab, delta: number | null) {
  const contents = pageOf(tab);
  if (!contents || tab.isNewTab) return;
  const level = Math.max(
    -5,
    Math.min(5, delta === null ? 0 : contents.getZoomLevel() + delta),
  );
  contents.setZoomLevel(level);
  if (!tab.isPrivate) setZoom(originOf(contents.getURL()), level);
  if (tab.id === activeTabId) sendState();
}

function applySiteZoom(tab: Tab, url: string) {
  const contents = pageOf(tab);
  const origin = originOf(url);
  if (!contents || !origin || tab.isPrivate) return;
  const level = getZoom(origin);
  if (contents.getZoomLevel() !== level) contents.setZoomLevel(level);
  if (tab.id === activeTabId) sendState();
}

// ---------------------------------------------------------------- page actions

function openFind() {
  const tab = activeTab();
  if (!tab || tab.isNewTab || settingsOpen || !pageOf(tab)) return;
  uiContents()?.focus();
  sendToUi('terra:find-open', null);
}

function toggleBookmarkFor(tab: Tab | null) {
  const url = tab ? shownUrl(tab) : '';
  if (!tab || !/^(https?|file):/i.test(url)) return;
  toggleBookmark(url, tabTitle(tab), tab.isPrivate ? null : tab.favicon);
  sendState();
}

/**
 * A bookmark in the sidebar was clicked: go to its tab if it's open,
 * otherwise open it in the new tab page you're on, or in a new tab.
 */
function openBookmark(id: string, inNewTab: boolean) {
  const bookmark = getBookmarks().find((b) => b.id === id);
  if (!bookmark) return;
  if (!inNewTab) {
    const open = tabs.find((t) => !t.isPrivate && shownUrl(t) === bookmark.url);
    if (open) {
      activateTab(open.id);
      return;
    }
    const active = activeTab();
    if (active?.isNewTab && !active.isPrivate) {
      setSettingsOpen(false);
      navigate(bookmark.url);
      return;
    }
  }
  createTab(bookmark.url, { activate: !inNewTab, nextToActive: inNewTab });
}

function showBookmarkMenu(id: string) {
  const bookmark = getBookmarks().find((b) => b.id === id);
  if (!bookmark || !window) return;
  Menu.buildFromTemplate([
    { label: 'Open', click: () => openBookmark(id, false) },
    { label: 'Open in new tab', click: () => openBookmark(id, true) },
    {
      label: 'Open in private tab',
      click: () => createTab(bookmark.url, { isPrivate: true }),
    },
    { type: 'separator' },
    {
      label: 'Move to folder',
      enabled: getFolders().length > 0,
      submenu: [
        {
          label: 'No folder',
          type: 'radio',
          checked: !bookmark.folderId,
          click: () => moveBookmark(id, null),
        },
        { type: 'separator' },
        ...getFolders().map((folder) => ({
          label: folder.title.replace(/&/g, '&&'),
          type: 'radio' as const,
          checked: bookmark.folderId === folder.id,
          click: () => moveBookmark(id, folder.id),
        })),
      ],
    },
    { label: 'Remove bookmark', click: () => removeBookmark(id) },
    { type: 'separator' },
    { label: 'All bookmarks', click: () => showPanelPage('bookmarks') },
  ]).popup({ window });
}

function printPage(contents: WebContents | null) {
  contents?.print({}, () => {});
}

async function savePageAs(contents: WebContents | null) {
  if (!contents || !window) return;
  const name =
    (contents.getTitle() || 'page').replace(/[\\/:*?"<>|]+/g, ' ').trim() ||
    'page';
  const result = await dialog.showSaveDialog(window, {
    defaultPath: path.join(app.getPath('downloads'), `${name}.html`),
    filters: [{ name: 'Web page, complete', extensions: ['html', 'htm'] }],
  });
  if (result.canceled || !result.filePath) return;
  contents.savePage(result.filePath, 'HTMLComplete').catch(() => {});
}

function viewSource(tab: Tab | null) {
  const url = tab ? shownUrl(tab) : '';
  if (!tab || !isWebUrl(url)) return;
  createTab(`view-source:${url}`, {
    nextToActive: true,
    isPrivate: tab.isPrivate,
  });
}

async function openFileDialog() {
  if (!window) return;
  const result = await dialog.showOpenDialog(window, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Pages, PDFs and images',
        extensions: [
          'html',
          'htm',
          'pdf',
          'svg',
          'png',
          'jpg',
          'jpeg',
          'gif',
          'webp',
          'txt',
        ],
      },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (!result.canceled) openPaths(result.filePaths);
}

function openPaths(paths: string[]) {
  for (const file of paths.slice(0, 20)) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      createTab(pathToFileURL(file).href);
    }
  }
}

function toggleFullScreen() {
  if (!window || window.isDestroyed()) return;
  window.setFullScreen(!window.isFullScreen());
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
    case 'privateTab':
      return newPrivateTab();
    case 'duplicateTab':
      if (activeTabId !== null) duplicateTab(activeTabId);
      return;
    case 'pinTab':
      if (activeTabId !== null) togglePin(activeTabId);
      return;
    case 'muteTab':
      if (activeTabId !== null) toggleMute(activeTabId);
      return;
    case 'find':
      return openFind();
    case 'bookmarkPage':
      return toggleBookmarkFor(activeTab());
    case 'print':
      return printPage(activeContents());
    case 'savePage':
      return void savePageAs(activeContents());
    case 'openFile':
      return void openFileDialog();
    case 'viewSource':
      return viewSource(activeTab());
    case 'fullScreen':
      return toggleFullScreen();
    case 'openBookmarks':
      return showPanelPage('bookmarks');
    case 'openPasswords':
      return showPanelPage('passwords');
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
    case 'openHistory':
      return showPanelPage('history');
    case 'openDownloads':
      return showPanelPage('downloads');
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

// ---------------------------------------------------------------- questions

interface NoticeResponse {
  action: string | null;
  fields: Record<string, string>;
  choice: string;
}

interface PendingNotice extends Notice {
  /** What it is about, so a newer question of the same kind replaces it. */
  kind: string;
  /** Stays when its tab goes to another page (password saving). */
  keepOnNavigate: boolean;
  resolve: (response: NoticeResponse) => void;
}

const NO_ANSWER: NoticeResponse = { action: null, fields: {}, choice: '' };
let notices: PendingNotice[] = [];
let nextNoticeId = 1;

/** Shows a question in the bar under the toolbar and waits for the answer. */
function ask(
  notice: Omit<Notice, 'id'> & { kind: string },
  keepOnNavigate = false,
): Promise<NoticeResponse> {
  // A newer question of the same kind for the same tab replaces the old one.
  for (const old of notices.filter(
    (n) => n.kind === notice.kind && n.tabId === notice.tabId,
  )) {
    answerNotice(old.id, NO_ANSWER);
  }
  return new Promise((resolve) => {
    notices.push({ ...notice, id: nextNoticeId++, keepOnNavigate, resolve });
    sendNotice();
    layout();
  });
}

function visibleNotice(): PendingNotice | null {
  return (
    notices.find((n) => n.tabId === null || n.tabId === activeTabId) ?? null
  );
}

function sendNotice() {
  const notice = visibleNotice();
  sendToUi(
    'terra:notice',
    notice
      ? {
          id: notice.id,
          tabId: notice.tabId,
          text: notice.text,
          fields: notice.fields,
          choices: notice.choices,
          actions: notice.actions,
        }
      : null,
  );
}

function answerNotice(id: number, response: NoticeResponse) {
  const index = notices.findIndex((n) => n.id === id);
  if (index === -1) return;
  const [notice] = notices.splice(index, 1);
  notice.resolve(response);
  sendNotice();
  layout();
}

/** A tab closed or went to another page: its questions get no answer. */
function dropNotices(tabId: number, navigation = false) {
  for (const notice of notices.filter(
    (n) => n.tabId === tabId && !(navigation && n.keepOnNavigate),
  )) {
    answerNotice(notice.id, NO_ANSWER);
  }
}

// ---------------------------------------------------------------- sessions

/** How each permission is described: "example.com wants to ...". */
const PERMISSION_PHRASES: Record<string, string> = {
  camera: 'use your camera',
  microphone: 'use your microphone',
  geolocation: 'know your location',
  notifications: 'send you notifications',
  midi: 'use your MIDI devices',
  'clipboard-read': 'see what you copied',
  'idle-detection': 'know when you are away',
  'window-management': 'manage windows on your screens',
  'display-capture': 'see your screen',
};

/** Our permission names for an Electron permission request. */
function permissionNames(
  permission: string,
  details: { mediaTypes?: string[]; mediaType?: string },
): string[] {
  switch (permission) {
    case 'media': {
      const types =
        details.mediaTypes ??
        (details.mediaType && details.mediaType !== 'unknown'
          ? [details.mediaType]
          : ['video', 'audio']);
      return [
        ...(types.includes('video') ? ['camera'] : []),
        ...(types.includes('audio') ? ['microphone'] : []),
      ];
    }
    case 'midi':
    case 'midiSysex':
      return ['midi'];
    case 'geolocation':
    case 'notifications':
    case 'clipboard-read':
    case 'idle-detection':
    case 'window-management':
    case 'display-capture':
      return [permission];
    default:
      return [];
  }
}

function decisionFor(isPrivate: boolean, origin: string, name: string) {
  return (
    (isPrivate ? privateDecisions.get(`${origin} ${name}`) : undefined) ??
    getPermission(origin, name)
  );
}

function rememberDecision(
  isPrivate: boolean,
  origin: string,
  name: string,
  decision: PermissionDecision,
) {
  if (isPrivate) privateDecisions.set(`${origin} ${name}`, decision);
  else setPermission(origin, name, decision);
}

/** Permissions, screen sharing and ad blocking for a session. */
function setUpSession(ses: Session, isPrivate: boolean) {
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (AUTO_ALLOWED.has(permission)) return callback(true);
    const origin = originOf(details.requestingUrl || contents.getURL());
    // Screen sharing asks once, in its own picker (setDisplayMediaRequestHandler).
    if (permission === 'display-capture') {
      return callback(
        !!origin &&
          decisionFor(isPrivate, origin, 'display-capture') !== 'block',
      );
    }
    const names = permissionNames(
      permission,
      details as { mediaTypes?: string[] },
    );
    if (!names.length || !origin) return callback(false);
    const decisions = names.map((n) => decisionFor(isPrivate, origin, n));
    if (decisions.every((d) => d === 'allow')) return callback(true);
    if (decisions.some((d) => d === 'block')) return callback(false);
    const tab = tabs.find((t) => pageOf(t) === contents);
    if (!tab) return callback(false);
    const what = names.map((n) => PERMISSION_PHRASES[n] ?? n).join(' and ');
    void ask({
      kind: `permission:${names.join('+')}`,
      tabId: tab.id,
      text: `${hostLabel(origin)} wants to ${what}`,
      actions: [
        { id: 'allow', label: 'Allow' },
        { id: 'block', label: 'Block' },
      ],
    }).then((response) => {
      if (response.action === 'allow' || response.action === 'block') {
        for (const name of names) {
          rememberDecision(isPrivate, origin, name, response.action);
        }
      }
      callback(response.action === 'allow');
    });
  });
  ses.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin, details) => {
      if (AUTO_ALLOWED.has(permission)) return true;
      const origin = originOf(requestingOrigin);
      if (permission === 'display-capture') {
        return (
          !!origin &&
          decisionFor(isPrivate, origin, 'display-capture') !== 'block'
        );
      }
      const names = permissionNames(
        permission,
        details as { mediaType?: string },
      );
      return (
        names.length > 0 &&
        !!origin &&
        names.every((n) => decisionFor(isPrivate, origin, n) === 'allow')
      );
    },
  );
  ses.setDisplayMediaRequestHandler((request, callback) => {
    void (async () => {
      const contents = request.frame
        ? allWebContents.fromFrame(request.frame)
        : null;
      const tab = tabs.find((t) => pageOf(t) === contents);
      const origin = originOf(request.frame?.url ?? '');
      if (!tab || !origin) return callback({});
      if (decisionFor(isPrivate, origin, 'display-capture') === 'block') {
        return callback({});
      }
      const hidden = overlaySourceId();
      const sources = (
        await desktopCapturer.getSources({ types: ['screen', 'window'] })
      )
        .filter((source) => source.id !== hidden)
        // Whole screens first, then windows.
        .sort(
          (a, b) =>
            Number(b.id.startsWith('screen:')) -
            Number(a.id.startsWith('screen:')),
        );
      const response = await ask({
        kind: 'screen',
        tabId: tab.id,
        text: `${hostLabel(origin)} wants to see your screen. Share:`,
        choices: sources.map((source) => ({
          value: source.id,
          label: source.name,
        })),
        actions: [
          { id: 'share', label: 'Share' },
          { id: 'cancel', label: 'Cancel' },
        ],
      });
      const source = sources.find((s) => s.id === response.choice);
      if (response.action !== 'share' || !source) return callback({});
      callback({
        video: source,
        // A whole screen can share its sound too.
        ...(source.id.startsWith('screen:') ? { audio: 'loopback' } : {}),
      });
    })();
  });
  attachAdblock(
    ses,
    (pageUrl) => settings.blockAds && !adsAllowed(originOf(pageUrl)),
  );
}

let privateSessionReady = false;

function setUpPrivateSession() {
  if (privateSessionReady) return;
  privateSessionReady = true;
  setUpSession(session.fromPartition(PRIVATE_PARTITION), true);
}

/** The last private tab closed: forget everything it did. */
function clearPrivateSession() {
  const ses = session.fromPartition(PRIVATE_PARTITION);
  void ses.clearStorageData();
  void ses.clearCache();
  ses.clearAuthCache().catch(() => {});
  privateDecisions.clear();
}

// ---------------------------------------------------------------- passwords

/** A page sent a sign-in form: offer to save (or update) the password. */
function offerToSave(
  tab: Tab,
  origin: string,
  username: string,
  password: string,
) {
  if (isSaved(origin, username, password)) return;
  const update = loginsFor(origin).some((l) => l.username === username);
  const site = hostLabel(origin);
  void ask(
    {
      kind: 'save-password',
      tabId: tab.id,
      text: update
        ? `Update the saved password for ${username || 'this login'} on ${site}?`
        : `Save your password for ${site}? It stays encrypted on this computer.`,
      actions: [
        { id: 'save', label: update ? 'Update' : 'Save' },
        { id: 'never', label: 'Never for this site' },
        { id: 'later', label: 'Not now' },
      ],
    },
    true,
  ).then((response) => {
    if (response.action === 'save') saveLogin(origin, username, password);
    else if (response.action === 'never') setNeverSavePasswords(origin, true);
  });
}

/** A page with a sign-in form: offer to fill in a saved login. */
function offerToFill(tab: Tab, origin: string) {
  const saved = loginsFor(origin);
  if (!saved.length) return;
  const site = hostLabel(origin);
  void ask({
    kind: 'fill-password',
    tabId: tab.id,
    text:
      saved.length === 1
        ? `Sign in to ${site} as ${saved[0].username || 'your saved login'}?`
        : `Sign in to ${site} as`,
    choices:
      saved.length > 1
        ? saved.map((l) => ({ value: l.id, label: l.username || '(no name)' }))
        : undefined,
    actions: [
      { id: 'fill', label: 'Fill in' },
      { id: 'later', label: 'Not now' },
    ],
  }).then((response) => {
    if (response.action !== 'fill') return;
    const login =
      saved.length === 1
        ? saved[0]
        : saved.find((l) => l.id === response.choice);
    const contents = pageOf(tab);
    if (!login || !contents || originOf(contents.getURL()) !== origin) return;
    const password = revealPassword(login.id);
    if (password !== null) {
      contents.send('terra:login-fill', login.username, password);
    }
  });
}

// ---------------------------------------------------------------- menus

function showTabMenu(id: number) {
  const tab = findTab(id);
  if (!tab || !window) return;
  const contents = pageOf(tab);
  const index = tabs.indexOf(tab);
  const url = shownUrl(tab);
  const closeAll = (ids: number[]) => ids.forEach((tabId) => closeTab(tabId));
  Menu.buildFromTemplate([
    { label: 'New tab', click: () => newTab() },
    {
      label: 'Reload',
      enabled: !tab.isNewTab,
      click: () => contents?.reload(),
    },
    { label: 'Duplicate', enabled: !!url, click: () => duplicateTab(id) },
    { label: tab.pinned ? 'Unpin' : 'Pin', click: () => togglePin(id) },
    {
      label: contents?.isAudioMuted() ? 'Unmute tab' : 'Mute tab',
      click: () => toggleMute(id),
    },
    {
      label: isBookmarked(url) ? 'Remove bookmark' : 'Bookmark',
      enabled: /^(https?|file):/i.test(url),
      click: () => toggleBookmarkFor(tab),
    },
    { type: 'separator' },
    { label: 'Close', click: () => closeTab(id) },
    {
      label: 'Close other tabs',
      enabled: tabs.some((t) => t.id !== id && !t.pinned),
      click: () =>
        closeAll(tabs.filter((t) => t.id !== id && !t.pinned).map((t) => t.id)),
    },
    {
      label: 'Close tabs below',
      enabled: index < tabs.length - 1,
      click: () => closeAll(tabs.slice(index + 1).map((t) => t.id)),
    },
    { type: 'separator' },
    {
      label: 'Reopen closed tab',
      enabled: closedTabUrls.length > 0,
      click: () => reopenClosedTab(),
    },
  ]).popup({ window });
}

/** The lock icon in the address bar: about this site. */
function showSiteMenu(x: number, y: number) {
  const tab = activeTab();
  const contents = pageOf(tab);
  if (!tab || !contents || !window) return;
  const url = shownUrl(tab);
  const origin = originOf(url);
  const security = securityOf(url);
  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label:
        security === 'secure'
          ? 'Connection is secure'
          : security === 'insecure'
            ? 'Connection is not secure'
            : security === 'local'
              ? 'File on this computer'
              : 'Terra page',
      enabled: false,
    },
  ];
  if (origin) {
    items.push(
      { type: 'separator' },
      {
        label: 'Block ads and trackers here',
        type: 'checkbox',
        enabled: settings.blockAds,
        checked: settings.blockAds && !adsAllowed(origin),
        click: () => {
          setAdsAllowed(origin, !adsAllowed(origin));
          contents.reload();
        },
      },
      {
        label: 'Delete cookies and data for this site',
        click: async () => {
          await contents.session.clearStorageData({ origin });
          contents.reload();
        },
      },
      { label: 'Site permissions…', click: () => showPanelPage('privacy') },
    );
  }
  Menu.buildFromTemplate(items).popup({
    window,
    x: Math.round(x),
    y: Math.round(y),
  });
}

// ---------------------------------------------------------------- updates

async function lookForUpdate(announce: boolean) {
  const update = await checkForUpdate();
  if (!update) return null;
  readyUpdate = update;
  sendToUi('terra:update-ready', update.version);
  if (announce) {
    void ask({
      kind: 'update',
      tabId: null,
      text: `Terra ${update.version} is ready to install.`,
      actions: [
        { id: 'restart', label: 'Restart to update' },
        { id: 'later', label: 'Later' },
      ],
    }).then((response) => {
      if (response.action === 'restart') installUpdate(update);
    });
  }
  return update.version;
}

// ---------------------------------------------------------------- window

/**
 * Web links and files in a command line (Windows passes clicked links and
 * "Open with" files this way).
 */
function linksFromArgs(argv: string[]): string[] {
  return argv
    .slice(1)
    .filter((arg) => isWebUrl(arg) || isOpenableFile(arg))
    .map((arg) => toUrl(arg, false))
    .filter((url): url is string => url !== null)
    .slice(0, 20);
}

function isOpenableFile(arg: string) {
  if (!/^[a-z]:[\\/]/i.test(arg)) return false;
  if (!FILE_EXTENSIONS.includes(path.extname(arg).toLowerCase())) return false;
  try {
    return fs.statSync(arg).isFile();
  } catch {
    return false;
  }
}

/** Opens links from another app in new tabs and brings Terra to the front. */
function openLinks(urls: string[]) {
  const win = window;
  if (!win || win.isDestroyed()) {
    createWindow(urls);
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  for (const url of urls) createTab(url);
}

// ------------------------------------------------------ window animations
//
// The animation itself lives in window-animation.ts: a stand-in picture of
// the window flies on a transparent overlay and hands over to the real
// window. Here we take the pictures and do the hand-over.

function animationsOn() {
  return (
    settings.windowAnimations &&
    !systemPreferences.getAnimationSettings().prefersReducedMotion
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A picture of a page, or null if it takes too long or fails. */
async function capture(contents: WebContents): Promise<NativeImage | null> {
  const image = await Promise.race([
    contents.capturePage().catch(() => null),
    wait(250).then(() => null),
  ]);
  return image && !image.isEmpty() ? image : null;
}

function animationLook() {
  return {
    background: themeBackground(settings),
    accent: settings.accentColor,
  };
}

let showingWindow = false;

async function showWindowAnimated(win: BrowserWindow) {
  if (win.isDestroyed() || win.isVisible() || showingWindow) return;
  showingWindow = true;
  if (!animationsOn()) {
    win.show();
    return;
  }
  // Web pages wait until the window is in place.
  windowAnimating = true;
  layout();
  // Shown fully transparent: it paints (so it can be pictured) and Windows'
  // own opening animation plays invisibly. Ours makes it opaque at the end.
  win.setOpacity(0);
  win.show();
  // The headline uses a web font: picture the page once it's loaded.
  await Promise.race([
    win.webContents
      .executeJavaScript('document.fonts.ready.then(() => true)')
      .catch(() => false),
    wait(600),
  ]);
  await wait(32);
  const [width, height] = win.getContentSize();
  const image = await capture(win.webContents);
  const reveal = () => {
    if (!win.isDestroyed()) win.setOpacity(1);
  };
  const played =
    image !== null &&
    (await playWindowAnimation(
      'open',
      {
        win,
        layers: [{ image, bounds: { x: 0, y: 0, width, height } }],
        ...animationLook(),
      },
      reveal,
    ));
  if (!played) reveal();
  windowAnimating = false;
  layout();
}

async function closeWindowAnimated(win: BrowserWindow) {
  const tab = activeTab();
  const page =
    !settingsOpen && tab && !tab.isNewTab && !windowAnimating
      ? pageOf(tab)
      : null;
  const [ui, pageImage] = await Promise.all([
    capture(win.webContents),
    page ? capture(page) : Promise.resolve(null),
  ]);
  if (!ui || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const layers: Layer[] = [
    { image: ui, bounds: { x: 0, y: 0, width, height } },
  ];
  if (pageImage) layers.push({ image: pageImage, bounds: pageBounds(win) });
  await playWindowAnimation(
    'close',
    { win, layers, ...animationLook() },
    () => {
      // The stand-in covers the window now: hide the real one instantly.
      if (!win.isDestroyed()) win.setOpacity(0);
    },
  );
}

function createWindow(urls: string[] = []) {
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
    // Window/taskbar icon while developing. The installed app uses the icon
    // built into Terra.exe instead (assets/ isn't packaged).
    ...(fs.existsSync(path.join(app.getAppPath(), 'assets', 'icon.png'))
      ? { icon: path.join(app.getAppPath(), 'assets', 'icon.png') }
      : {}),
    backgroundColor: glassBehind() ? '#00000000' : themeBackground(settings),
    backgroundMaterial: glassBehind() ? 'acrylic' : 'none',
    // Shown once the UI has painted, with the opening animation.
    show: false,
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

  if (animationsOn()) prepareOverlay();
  // Shown when the UI says it has painted the user's colors, tabs and
  // bookmarks ("terra:ui-ready"), not at its first paint, which still has
  // the default colors. Never stay invisible if that takes too long.
  setTimeout(() => void showWindowAnimated(win), 3000);

  let closeAnimated = false;
  let closing = false;
  win.on('close', (event) => {
    // Remember the tabs as they are now, before they close one by one.
    if (!sessionFrozen) {
      persistSession();
      sessionFrozen = true;
    }
    if (closeAnimated || !animationsOn()) return;
    if (!win.isVisible() || win.isMinimized()) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    void closeWindowAnimated(win).finally(() => {
      closeAnimated = true;
      if (!win.isDestroyed()) win.close();
    });
  });

  win.on('resize', layout);
  // The UI page loses focus whenever you click into a website, so tell it
  // about the real window focus (to refresh the default browser status).
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
  win.webContents.on('context-menu', (_event, params) =>
    showEditMenu(win, params),
  );
  win.webContents.on('before-input-event', (event, input) => {
    if (handleShortcut(input)) event.preventDefault();
  });

  // Send everything again when the UI (re)loads.
  win.webContents.on('did-finish-load', () => {
    sendToUi('browser:downloads', getDownloads());
    sendSettings();
    sendTabs();
    sendState();
    sendNotice();
    lastPageColors = '';
    samplePageColorsSoon();
  });

  win.on('closed', () => {
    const closing = tabs;
    tabs = [];
    activeTabId = null;
    if (window === win) window = null;
    for (const tab of closing) {
      pageOf(tab)?.close();
    }
    // The animation overlay is a window too; without this Terra never quits.
    destroyOverlay();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  let restored = false;
  if (!sessionRestored && settings.startup === 'restore') {
    const saved = loadSession();
    for (const tab of saved.tabs) {
      createTab(tab.url, {
        lazyTitle: tab.title,
        pinned: tab.pinned,
        activate: false,
      });
    }
    restored = tabs.length > 0;
    if (restored && urls.length === 0) {
      activateTab(tabs[Math.min(saved.active, tabs.length - 1)].id);
    }
  }
  sessionRestored = true;
  if (urls.length === 0 && !restored) createTab(settings.homePage || null);
  for (const url of urls) createTab(url);
}

let sessionRestored = false;

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
    const fromTab = tabs.some((tab) => pageOf(tab) === event.sender);
    if (!fromUi(event.sender) && !fromTab) return;
    if (recordingBinding || typeof button !== 'number') return;
    const action = actionFor(MOUSE_BUTTONS[button] ?? '');
    action?.();
  });
  ipcMain.on('browser:recording-binding', (event, on: unknown) => {
    if (fromUi(event.sender)) recordingBinding = on === true;
  });
  // History and Downloads pages.
  ipcMain.handle('browser:history-get', (event) =>
    fromUi(event.sender) ? getHistory() : [],
  );
  ipcMain.on('browser:history-delete', (event, id: unknown) => {
    if (fromUi(event.sender) && typeof id === 'string') deleteHistoryEntry(id);
  });
  ipcMain.on('browser:history-clear', (event) => {
    if (fromUi(event.sender)) clearHistory();
  });
  ipcMain.on('browser:open-url', (event, url: unknown) => {
    if (!fromUi(event.sender) || typeof url !== 'string' || !isWebUrl(url)) {
      return;
    }
    createTab(url);
  });
  ipcMain.on(
    'browser:download-action',
    (event, id: unknown, action: unknown) => {
      const actions: DownloadAction[] = [
        'pause',
        'resume',
        'cancel',
        'open',
        'show',
        'retry',
        'remove',
      ];
      if (
        fromUi(event.sender) &&
        typeof id === 'string' &&
        actions.includes(action as DownloadAction)
      ) {
        downloadAction(id, action as DownloadAction);
      }
    },
  );
  ipcMain.on('browser:downloads-clear', (event) => {
    if (fromUi(event.sender)) clearDownloads();
  });
  ipcMain.on('browser:downloads-folder', (event) => {
    if (fromUi(event.sender)) openDownloadsFolder();
  });
  ipcMain.on('browser:show-page', (event, page: unknown) => {
    if (fromUi(event.sender) && PANEL_PAGES.includes(page as PanelPage)) {
      showPanelPage(page as PanelPage);
    }
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
    const beforeBackground = `${themeBackground(settings)} ${glassBehind()}`;
    const beforeDark = settings.forceDark;
    settings = sanitizeSettings({ ...settings, ...changes });
    saveSettings();
    sendSettings();
    if (`${themeBackground(settings)} ${glassBehind()}` !== beforeBackground) {
      applyTheme();
    }
    // Switched to "Open website" glass colors: pick them up right away.
    lastPageColors = '';
    samplePageColorsSoon();
    if (settings.forceDark !== beforeDark) updateForcedDarkAll();
    if (animationsOn()) prepareOverlay();
    else destroyOverlay();
    if (settings.sidebarCollapsed !== before) {
      layout();
      sendTabs();
    }
  });
  // Read-only, used by tab-preload.ts in every website tab.
  ipcMain.on('browser:force-dark-get', (event) => {
    event.returnValue = settings.forceDark;
  });
  ipcMain.handle(
    'browser:default-browser-get',
    async (event): Promise<DefaultBrowserState> => ({
      supported: fromUi(event.sender) && defaultBrowserSupported(),
      isDefault: fromUi(event.sender) && (await isDefaultBrowser()),
    }),
  );
  ipcMain.on('browser:default-browser-set', (event) => {
    if (fromUi(event.sender)) void openDefaultAppsSettings();
  });
  // ---- everything below uses "terra:" messages from our UI only
  const on = (channel: string, handler: (...args: unknown[]) => void) =>
    ipcMain.on(channel, (event, ...args) => {
      if (fromUi(event.sender)) handler(...args);
    });
  const handle = (channel: string, handler: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) =>
      fromUi(event.sender) ? handler(...args) : null,
    );
  const isText = (value: unknown, max = 4096): value is string =>
    typeof value === 'string' && value.length <= max;

  on('terra:slide-shot-ready', () => slideShotShown?.());
  on('terra:scroll-tabs', (step) => {
    if (step === 1 || step === -1) scrollTabs(step);
  });
  // Auto-compact sidebar (ui-auto-compact.ts) asks for a state, not a flip.
  on('terra:sidebar-set', (collapsed) => {
    if (typeof collapsed !== 'boolean' || !settings.autoCompactSidebar) return;
    if (settings.sidebarCollapsed !== collapsed) void toggleSidebar();
  });
  on('terra:ui-ready', () => {
    if (window) void showWindowAnimated(window);
  });
  on('terra:notice-answer', (id, action, fields, choice) => {
    if (!isId(id)) return;
    const clean: Record<string, string> = {};
    if (fields && typeof fields === 'object') {
      for (const [key, value] of Object.entries(fields)) {
        if (isText(key, 64) && isText(value, 1024)) clean[key] = value;
      }
    }
    answerNotice(id, {
      action: isText(action, 64) ? action : null,
      fields: clean,
      choice: isText(choice, 512) ? choice : '',
    });
  });

  // Find on page.
  on('terra:find', (text, forward, newSearch) => {
    const contents = activeContents();
    if (!contents || !isText(text, 500)) return;
    if (!text) {
      contents.stopFindInPage('clearSelection');
      sendToUi('terra:find-result', { active: 0, total: 0 });
      return;
    }
    contents.findInPage(text, {
      forward: forward !== false,
      findNext: newSearch === true,
    });
  });
  on('terra:find-stop', () =>
    activeContents()?.stopFindInPage('keepSelection'),
  );

  // Address bar suggestions.
  const suggestContext = () => ({
    tabs: tabs
      .filter((t) => t.id !== activeTabId && !t.isNewTab)
      .map((t) => ({ id: t.id, title: tabTitle(t), url: shownUrl(t) })),
    bookmarks: getBookmarks(),
    history: getHistory(),
    asAddress: (text: string) => {
      const url = toUrl(text, false);
      return url && !url.startsWith(SEARCH_ENGINES[settings.searchEngine].url)
        ? url
        : null;
    },
    searchUrl,
    engineName: SEARCH_ENGINES[settings.searchEngine].name,
  });
  handle('terra:suggest', (query) =>
    isText(query, 500)
      ? localSuggestions(query, suggestContext())
      : { suggestions: [], complete: '' },
  );
  handle('terra:suggest-remote', async (query) => {
    if (!isText(query, 500) || !settings.searchSuggestions) return [];
    if (activeTab()?.isPrivate) return [];
    const terms = await remoteSuggestions(query, settings.searchEngine);
    return terms.map((term) => ({
      kind: 'search',
      value: searchUrl(term),
      title: term,
      detail: `Search ${SEARCH_ENGINES[settings.searchEngine].name}`,
    }));
  });
  // The dropdown covers the page, which is a separate layer the UI can't
  // draw over: show a picture of the page under it instead.
  handle('terra:suggest-open', async () => {
    const tab = activeTab();
    const contents = pageOf(tab);
    let image: string | null = null;
    if (
      window &&
      tab &&
      contents &&
      !tab.isNewTab &&
      !tab.lazyUrl &&
      !settingsOpen &&
      !suggestOpen
    ) {
      try {
        const picture = await contents.capturePage();
        if (!picture.isEmpty()) {
          image = `data:image/jpeg;base64,${picture.toJPEG(85).toString('base64')}`;
        }
      } catch {
        // No picture: the dropdown shows over the plain background.
      }
    }
    return image && window ? { image, bounds: pageBounds(window) } : null;
  });
  // The UI shows the picture first, then asks for the page to be hidden.
  on('terra:suggest-cover', () => {
    suggestOpen = true;
    layout();
  });
  on('terra:suggest-close', () => {
    suggestOpen = false;
    layout();
  });
  on('terra:switch-tab', (id) => isId(id) && activateTab(id));
  on('terra:history-forget', (url) => isText(url) && deleteHistoryUrl(url));

  // Bookmarks.
  handle('terra:bookmarks', () => getBookmarks());
  handle('terra:bookmark-folders', () => getFolders());
  handle('terra:folder-create', (title) =>
    isText(title, 256) ? createFolder(title) : null,
  );
  on('terra:folder-rename', (id, title) => {
    if (isText(id, 64) && isText(title, 256)) renameFolder(id, title);
  });
  on('terra:folder-delete', (id) => isText(id, 64) && deleteFolder(id));
  on('terra:bookmark-move', (id, folderId) => {
    if (isText(id, 64) && (folderId === null || isText(folderId, 64))) {
      moveBookmark(id, folderId);
    }
  });
  on('terra:bookmark-toggle', () => toggleBookmarkFor(activeTab()));
  on('terra:bookmark-open', (id, inNewTab) => {
    if (isText(id, 64)) openBookmark(id, inNewTab === true);
  });
  on('terra:bookmark-menu', (id) => isText(id, 64) && showBookmarkMenu(id));
  on('terra:open-bookmarks', () => showPanelPage('bookmarks'));
  on('terra:bookmark-remove', (id) => isText(id, 64) && removeBookmark(id));
  on('terra:bookmark-rename', (id, title) => {
    if (isText(id, 64) && isText(title, 1024)) renameBookmark(id, title);
  });

  // Passwords.
  handle('terra:logins', () => ({
    available: canStorePasswords(),
    logins: listLogins(),
  }));
  handle('terra:login-reveal', (id) =>
    isText(id, 64) ? revealPassword(id) : null,
  );
  on('terra:login-delete', (id) => isText(id, 64) && deleteLogin(id));
  handle('terra:logins-import', async () => {
    if (!window || !canStorePasswords()) return null;
    const result = await dialog.showOpenDialog(window, {
      title: 'Import passwords',
      properties: ['openFile'],
      filters: [{ name: 'Passwords (CSV)', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      return importPasswordsCsv(fs.readFileSync(result.filePaths[0], 'utf-8'));
    } catch {
      return 0;
    }
  });

  // Site permissions and exceptions.
  handle('terra:sites', () => getSites());
  on('terra:site-reset', (origin, permission) => {
    if (!isText(origin, 512)) return;
    resetSite(origin, isText(permission, 64) ? permission : undefined);
  });
  on('terra:site-set', (origin, key, value) => {
    if (!isText(origin, 512)) return;
    if (key === 'allowAds') setAdsAllowed(origin, value === true);
    if (key === 'neverSavePasswords') {
      setNeverSavePasswords(origin, value === true);
    }
    if (key === 'zoom' && typeof value === 'number') setZoom(origin, value);
  });

  // Import from other browsers.
  handle('terra:import-sources', () => importSources());
  handle('terra:import', (id) => (isText(id, 32) ? importFrom(id) : null));

  // Updates.
  handle('terra:update-status', () => ({
    supported: updatesSupported(),
    current: app.getVersion(),
    ready: readyUpdate?.version ?? null,
  }));
  handle('terra:update-check', () =>
    updatesSupported() ? lookForUpdate(false) : null,
  );
  on('terra:update-install', () => readyUpdate && installUpdate(readyUpdate));

  // Tabs, files and the address bar's buttons.
  on('terra:tab-menu', (id) => isId(id) && showTabMenu(id));
  on('terra:tab-mute', (id) => isId(id) && toggleMute(id));
  on('terra:new-private-tab', () => newPrivateTab());
  on('terra:site-menu', (x, y) => {
    if (typeof x === 'number' && typeof y === 'number') showSiteMenu(x, y);
  });
  on('terra:zoom-reset', () => changeZoom(null));
  on('terra:open-file', () => void openFileDialog());
  on('terra:open-paths', (paths) => {
    if (Array.isArray(paths)) openPaths(paths.filter((p) => isText(p, 1024)));
  });
  on('terra:open-links', (links) => {
    if (!Array.isArray(links)) return;
    for (const link of links.slice(0, 20)) {
      const url = isText(link) ? toUrl(link, false) : null;
      if (url) createTab(url);
    }
  });

  // From the password helper in web pages (tab-preload.ts).
  const tabFor = (sender: WebContents) =>
    tabs.find((t) => pageOf(t) === sender) ?? null;
  const loginOrigin = (event: Electron.IpcMainEvent) => {
    const frame = event.senderFrame;
    // Only the page itself, never frames inside it.
    if (!frame || frame !== event.sender.mainFrame) return '';
    return originOf(frame.url);
  };
  ipcMain.on(
    'terra:login-submitted',
    (event, username: unknown, password: unknown) => {
      const tab = tabFor(event.sender);
      const origin = loginOrigin(event);
      if (!tab || tab.isPrivate || !origin || !settings.offerPasswords) return;
      if (!canStorePasswords() || passwordsNeverSaved(origin)) return;
      if (!isText(username, 512) || !isText(password, 1024) || !password)
        return;
      offerToSave(tab, origin, username, password);
    },
  );
  ipcMain.on('terra:login-form', (event) => {
    const tab = tabFor(event.sender);
    const origin = loginOrigin(event);
    if (!tab || tab.isPrivate || !origin || !settings.offerPasswords) return;
    offerToFill(tab, origin);
  });

  ipcMain.handle('browser:clear-data', async (event) => {
    if (!fromUi(event.sender)) return false;
    await clearBrowsingData();
    return true;
  });
}

app.whenReady().then(() => {
  // Started by the Windows installer only to create shortcuts: do nothing
  // else (electron-squirrel-startup already handled it and we are quitting).
  if (started || !isFirstInstance) {
    app.quit();
    return;
  }
  void registerAsBrowser();
  removeNyaApp();
  // Windows' transparency effects switched on or off: "behind" glass follows.
  nativeTheme.on('updated', () => {
    if (window) applyWindowMaterial(window);
  });
  app.on('second-instance', (_event, argv) => openLinks(linksFromArgs(argv)));

  // Widevine (DRM) is downloaded into the user's profile on first launch and
  // kept up to date by Chromium. The window doesn't wait for it: the new tab
  // page needs no DRM and the module is ready within seconds.
  components
    .whenReady()
    .catch((error: unknown) =>
      console.error('Widevine is unavailable:', error),
    );

  loadSettings();
  initHistory(() => sendToUi('browser:history-changed', null));
  initBookmarks(() => {
    sendToUi('terra:bookmarks-changed', null);
    sendState();
  });
  initSites(() => sendToUi('terra:sites-changed', null));
  initPasswords(() => sendToUi('terra:logins-changed', null));
  initAdblock();
  setUpSession(session.defaultSession, false);

  // Sites that ask for a username and password in a browser box.
  app.on('login', (event, contents, _details, authInfo, callback) => {
    event.preventDefault();
    const tab = tabs.find((t) => pageOf(t) === contents);
    void ask({
      kind: 'http-login',
      tabId: tab?.id ?? null,
      text: authInfo.isProxy
        ? `The proxy ${authInfo.host} needs you to sign in`
        : `${authInfo.host} asks you to sign in${authInfo.realm ? ` (${authInfo.realm})` : ''}`,
      fields: [
        { name: 'username', label: 'Username', type: 'text' },
        { name: 'password', label: 'Password', type: 'password' },
      ],
      actions: [
        { id: 'signin', label: 'Sign in' },
        { id: 'cancel', label: 'Cancel' },
      ],
    }).then((response) => {
      if (response.action === 'signin') {
        callback(
          response.fields.username ?? '',
          response.fields.password ?? '',
        );
      } else {
        callback();
      }
    });
  });

  initDownloads(session.defaultSession, {
    askWhere: () => {
      const ask = settings.askDownloadLocation || askNextDownload;
      askNextDownload = false;
      return ask;
    },
    onChange: () => sendToUi('browser:downloads', getDownloads()),
  });
  applyTheme();
  setUpIpc();
  // Pages change color as you scroll or switch dark mode: keep checking.
  setInterval(() => void samplePageEdges(), 1500);
  setUpMenu();
  createWindow(linksFromArgs(process.argv));
  if (fromNya) {
    void ask({
      kind: 'renamed',
      tabId: null,
      text: fromNya.wasDefault
        ? 'Nya is now Terra, and everything came along. Make Terra your default browser again?'
        : 'Nya is now Terra. Your tabs, bookmarks, passwords and settings came along.',
      actions: fromNya.wasDefault
        ? [
            { id: 'default', label: 'Make default' },
            { id: 'later', label: 'Later' },
          ]
        : [{ id: 'ok', label: 'OK' }],
    }).then((response) => {
      if (response.action === 'default') void openDefaultAppsSettings();
    });
  }

  // Look for a new version a little after starting, then twice a day.
  if (updatesSupported()) {
    const look = () => settings.autoUpdate && void lookForUpdate(true);
    setTimeout(look, 20_000);
    setInterval(look, 12 * 60 * 60 * 1000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (!settings.clearOnExit) {
    app.quit();
    return;
  }
  // "Clear data when Terra closes": cookies, cache and site data.
  const ses = session.defaultSession;
  void Promise.allSettled([ses.clearStorageData(), ses.clearCache()]).then(() =>
    app.quit(),
  );
});
