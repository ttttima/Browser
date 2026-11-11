import './index.css';
import { pageShown } from './ui-pages';
import { cancelColorPanel, openColorPanel } from './ui-color-panel';
import { closeBookmarksPop } from './ui-bookmarks-pop';
import { updateAutoCompact } from './ui-auto-compact';
import { icon } from './ui-common';
import {
  attachSuggestions,
  closeSuggestions,
  suggestKeydown,
} from './ui-toolbar';
import {
  ACCENT_PRESETS,
  ACTIONS,
  TINT_AMOUNT,
  activeTint,
  mixHex,
  MOUSE_BUTTONS,
  bindingLabel,
  defaultBindings,
  keyCombo,
  type ActionId,
  type CustomBinding,
  type DefaultBrowserState,
  type DownloadAction,
  type DownloadInfo,
  type HistoryEntry,
  type PanelPage,
  SEARCH_ENGINES,
  type BrowserState,
  type PageEdges,
  type SearchEngine,
  type Settings,
  type Theme,
  type TabInfo,
  type TabsState,
} from './shared';

interface BrowserAPI {
  navigate: (url: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
  newTab: () => void;
  closeTab: (id: number) => void;
  activateTab: (id: number) => void;
  moveTab: (id: number, toIndex: number) => void;
  toggleSidebar: () => void;
  getHistory: () => Promise<HistoryEntry[]>;
  deleteHistory: (id: string) => void;
  clearHistory: () => void;
  openUrl: (url: string) => void;
  downloadAction: (id: string, action: DownloadAction) => void;
  clearDownloads: () => void;
  openDownloadsFolder: () => void;
  showPage: (page: PanelPage) => void;
  onDownloads: (callback: (downloads: DownloadInfo[]) => void) => void;
  onHistoryChanged: (callback: () => void) => void;
  onShowPage: (callback: (page: PanelPage) => void) => void;
  windowAction: (action: 'close' | 'minimize' | 'maximize') => void;
  platform: string;
  mouseButton: (button: number) => void;
  setRecordingBinding: (on: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  updateSettings: (changes: Partial<Settings>) => void;
  clearBrowsingData: () => Promise<boolean>;
  getDefaultBrowser: () => Promise<DefaultBrowserState>;
  makeDefaultBrowser: () => void;
  onStateChanged: (callback: (state: BrowserState) => void) => void;
  onTabsChanged: (callback: (state: TabsState) => void) => void;
  onSettingsChanged: (callback: (settings: Settings) => void) => void;
  onPageEdges: (callback: (edges: PageEdges) => void) => void;
  onWindowFocus: (callback: (focused: boolean) => void) => void;
  onFocusAddress: (callback: () => void) => void;
}

declare global {
  interface Window {
    browser: BrowserAPI;
  }
}

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

// ---------------------------------------------------------------- toolbar

const address = $<HTMLInputElement>('#address');

let currentUrl = '';

/**
 * What the address bar shows while you're not editing it: just the site
 * ("chatgpt.com"), without https://, www. or the rest of the address.
 */
function shortUrl(url: string) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    return hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Puts the right text in the bar for its current state. */
function showAddress() {
  const editing = document.activeElement === address;
  address.value = editing ? currentUrl : shortUrl(currentUrl);
  address.classList.toggle('empty', !currentUrl);
}

function navigate() {
  window.browser.navigate(address.value);
  address.blur();
}

address.addEventListener('keydown', (event) => {
  if (suggestKeydown(event)) return;
  if (event.key === 'Enter') {
    closeSuggestions();
    navigate();
  } else if (event.key === 'Escape') {
    // Undo what was typed and go back to the page's real URL.
    address.blur();
  }
});

// Editing shows the full address, selected, like other browsers.
address.addEventListener('focus', () => {
  address.dataset.justFocused = '1';
  showAddress();
  address.select();
});
address.addEventListener('blur', showAddress);
address.addEventListener('mouseup', (event) => {
  if (address.dataset.justFocused) {
    event.preventDefault();
    address.select();
    delete address.dataset.justFocused;
  }
});

window.browser.onStateChanged((state) => {
  currentUrl = state.url;
  // Don't overwrite what the user is typing.
  if (document.activeElement !== address) showAddress();
});

// The UI page loses focus when the user clicks into a website. Put the
// real URL back so half-typed text doesn't stay in the address bar.
window.addEventListener('blur', () => {
  if (document.activeElement === address) address.blur();
});

// The website's real edge colors, so smooth dividers fade exactly into them.
window.browser.onPageEdges((edges) => {
  const style = document.documentElement.style;
  const isColor = (value: string | null) =>
    value !== null && /^#[0-9a-f]{6}$/i.test(value);
  if (isColor(edges.left)) style.setProperty('--page-left', edges.left);
  else style.removeProperty('--page-left');
  if (isColor(edges.top)) style.setProperty('--page-top', edges.top);
  else style.removeProperty('--page-top');
});

window.browser.onFocusAddress(() => {
  // On a new tab, type into the big search box in the middle instead.
  const target = startPage.hidden ? address : startSearch;
  if (document.activeElement === target) return; // keep what's typed
  target.focus();
  target.select();
});

// ---------------------------------------------------------------- new tab page

const startPage = $<HTMLElement>('#start-page');
const startSearch = $<HTMLInputElement>('#start-search');
const privateNote = $<HTMLElement>('#private-note');
attachSuggestions(address);
attachSuggestions(startSearch);

$('#start-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!startSearch.value.trim()) return;
  closeSuggestions();
  window.browser.navigate(startSearch.value);
  startSearch.value = '';
  startSearch.blur();
});
startSearch.addEventListener('keydown', (event) => {
  if (suggestKeydown(event)) return;
  if (event.key === 'Escape') startSearch.value = '';
});

// ---------------------------------------------------------------- window

// Our own traffic-light window buttons (the window has no system title bar).
document.body.classList.add(`platform-${window.browser.platform}`);
for (const button of document.querySelectorAll<HTMLButtonElement>('.light')) {
  button.addEventListener('click', () =>
    window.browser.windowAction(
      button.dataset.action as 'close' | 'minimize' | 'maximize',
    ),
  );
}
// Back from Windows Settings: show whether Terra became the default. (The
// window buttons keep their colors when the window is in the background.)
window.browser.onWindowFocus((focused) => {
  if (focused) void updateDefaultBrowser();
});

// ---------------------------------------------------------- default browser

const defaultBrowserRow = $<HTMLDivElement>('#default-browser-row');
const defaultBrowserText = $<HTMLElement>('#default-browser-text');
const makeDefault = $<HTMLButtonElement>('#make-default');

async function updateDefaultBrowser() {
  let state: DefaultBrowserState;
  try {
    state = await window.browser.getDefaultBrowser();
  } catch {
    return;
  }
  defaultBrowserRow.hidden = !state.supported;
  defaultBrowserText.textContent = state.isDefault
    ? 'Terra opens links from other apps'
    : 'Open links from other apps in Terra';
  makeDefault.disabled = state.isDefault;
  makeDefault.textContent = state.isDefault ? 'Default' : 'Make default';
}
makeDefault.addEventListener('click', () =>
  window.browser.makeDefaultBrowser(),
);
void updateDefaultBrowser();

// ---------------------------------------------------------------- tabs

const CLOSE_ICON =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>';

const PRIVATE_ICON = icon('eyeOff');

const tabList = $<HTMLUListElement>('#tabs');
const tabElements = new Map<number, HTMLLIElement>();
let tabOrder: number[] = [];
let activeTabId: number | null = null;
let draggedTabId: number | null = null;

$('#new-tab').addEventListener('click', () => window.browser.newTab());
$('#toggle-sidebar').addEventListener('click', () =>
  window.browser.toggleSidebar(),
);

function createTabElement(id: number) {
  const item = document.createElement('li');
  item.className = 'tab';
  item.role = 'tab';
  item.tabIndex = 0;
  item.draggable = true;
  item.dataset.id = String(id);

  const icon = document.createElement('span');
  icon.className = 'tab-icon';

  const title = document.createElement('span');
  title.className = 'tab-title';

  // Speaker: shows while the tab plays sound (or is muted); click to mute.
  const audio = document.createElement('button');
  audio.className = 'tab-audio';
  audio.hidden = true;
  audio.addEventListener('click', (event) => {
    event.stopPropagation();
    window.terra.send('terra:tab-mute', id);
  });

  const close = document.createElement('button');
  close.className = 'tab-close';
  close.title = 'Close tab';
  close.innerHTML = CLOSE_ICON;
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    window.browser.closeTab(id);
  });

  item.append(icon, title, audio, close);
  item.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    window.terra.send('terra:tab-menu', id);
  });

  item.addEventListener('click', () => window.browser.activateTab(id));
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      window.browser.activateTab(id);
    }
  });
  // Middle click closes the tab.
  item.addEventListener('mousedown', (event) => {
    if (event.button === 1) event.preventDefault();
  });
  item.addEventListener('auxclick', (event) => {
    if (event.button === 1) window.browser.closeTab(id);
  });

  // Drag and drop to reorder.
  item.addEventListener('dragstart', (event) => {
    draggedTabId = id;
    item.classList.add('dragging');
    event.dataTransfer?.setData('text/plain', String(id));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  item.addEventListener('dragend', () => {
    draggedTabId = null;
    item.classList.remove('dragging');
    clearDropMarkers();
  });
  item.addEventListener('dragover', (event) => {
    if (draggedTabId === null) return;
    event.preventDefault();
    clearDropMarkers();
    item.classList.add(dropBelow(item, event) ? 'drop-below' : 'drop-above');
  });
  item.addEventListener('drop', (event) => {
    if (draggedTabId === null) return;
    event.preventDefault();
    const index = tabOrder.indexOf(id) + (dropBelow(item, event) ? 1 : 0);
    window.browser.moveTab(draggedTabId, index);
    clearDropMarkers();
  });

  return item;
}

function dropBelow(item: HTMLElement, event: DragEvent) {
  const box = item.getBoundingClientRect();
  return event.clientY > box.top + box.height / 2;
}

function clearDropMarkers() {
  for (const element of tabElements.values()) {
    element.classList.remove('drop-above', 'drop-below');
  }
}

function renderTabIcon(icon: HTMLElement, tab: TabInfo) {
  const key = tab.loading
    ? 'loading'
    : tab.isPrivate
      ? 'private'
      : (tab.favicon ?? `letter:${tab.title}`);
  if (icon.dataset.key === key) return;
  icon.dataset.key = key;
  icon.replaceChildren();
  icon.classList.remove('spinner', 'letter', 'private');

  if (tab.loading) {
    icon.classList.add('spinner');
  } else if (tab.isPrivate) {
    icon.classList.add('private');
    icon.innerHTML = PRIVATE_ICON;
  } else if (tab.favicon) {
    const image = document.createElement('img');
    image.src = tab.favicon;
    image.alt = '';
    image.addEventListener('error', () => {
      icon.dataset.key = '';
      renderTabIcon(icon, { ...tab, favicon: null });
    });
    icon.append(image);
  } else {
    icon.classList.add('letter');
    icon.textContent = (tab.title.trim()[0] ?? '•').toUpperCase();
  }
}

function renderTabs(state: TabsState) {
  setSidebarCollapsed(state.sidebarCollapsed);
  if (state.sidebarCollapsed) closeBookmarksPop();
  updateAutoCompact({
    collapsed: state.sidebarCollapsed,
    settingsOpen: state.settingsOpen,
  });
  document.body.classList.toggle('fullscreen', state.fullScreen);
  setSettingsVisible(state.settingsOpen);

  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  const showStart =
    !!active?.isNewTab && !state.settingsOpen && !state.fullScreen;
  if (startPage.hidden === showStart) {
    startPage.hidden = !showStart;
    document.body.classList.toggle('start-open', showStart);
    if (showStart) startSearch.value = '';
  }
  privateNote.hidden = !active?.isPrivate;

  $('#toggle-sidebar').title = state.sidebarCollapsed
    ? 'Expand sidebar'
    : 'Collapse sidebar';

  const ids = new Set(state.tabs.map((tab) => tab.id));
  for (const [id, element] of tabElements) {
    if (!ids.has(id)) {
      element.remove();
      tabElements.delete(id);
    }
  }

  tabOrder = state.tabs.map((tab) => tab.id);
  activeTabId = state.activeTabId;

  state.tabs.forEach((tab, index) => {
    let item = tabElements.get(tab.id);
    if (!item) {
      item = createTabElement(tab.id);
      tabElements.set(tab.id, item);
    }

    const active = tab.id === state.activeTabId && !state.settingsOpen;
    item.classList.toggle('active', active);
    item.ariaSelected = String(active);
    item.title = `${tab.title}\n${tab.url}`;
    item.querySelector('.tab-title')!.textContent = tab.title;
    const next = state.tabs[index + 1];
    item.classList.toggle('pinned', tab.pinned);
    item.classList.toggle('pinned-last', tab.pinned && !!next && !next.pinned);
    item.classList.toggle('private', tab.isPrivate);
    const audio = item.querySelector<HTMLButtonElement>('.tab-audio')!;
    audio.hidden = !tab.audible && !tab.muted;
    const audioKey = tab.muted ? 'muted' : 'playing';
    if (audio.dataset.key !== audioKey) {
      audio.dataset.key = audioKey;
      audio.innerHTML = icon(tab.muted ? 'speakerOff' : 'speaker', 'icon-sm');
      audio.title = tab.muted ? 'Unmute tab' : 'Mute tab';
      audio.ariaLabel = audio.title;
    }
    renderTabIcon(item.querySelector<HTMLElement>('.tab-icon')!, tab);

    // Keep DOM order in sync without recreating elements.
    if (tabList.children[index] !== item) {
      tabList.insertBefore(item, tabList.children[index] ?? null);
    }
  });

  tabElements
    .get(state.activeTabId ?? -1)
    ?.scrollIntoView({ block: 'nearest' });
}

// ---- sidebar slide

const pageShot = $<HTMLDivElement>('#page-shot');
const pageShotImage = pageShot.querySelector('img')!;
let slideTimer = 0;

/** The one UI duration (--duration in index.css), in ms. */
function uiDuration() {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--duration')
    .trim();
  return value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
}

/**
 * Compact <-> normal: the width slides (.sidebar-narrow, see index.css) and
 * the labels go away only once it's narrow, or come back before it widens,
 * so they are covered and uncovered instead of popping.
 */
function setSidebarCollapsed(collapsed: boolean) {
  const body = document.body;
  if (body.classList.contains('sidebar-narrow') === collapsed) return;
  window.clearTimeout(slideTimer);
  body.classList.toggle('sidebar-narrow', collapsed);
  const animate =
    !body.classList.contains('starting') &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate) {
    body.classList.toggle('sidebar-collapsed', collapsed);
    body.classList.remove('sidebar-sliding');
    return;
  }
  body.classList.add('sidebar-sliding');
  if (!collapsed) body.classList.remove('sidebar-collapsed');
  slideTimer = window.setTimeout(() => {
    body.classList.toggle('sidebar-collapsed', collapsed);
    body.classList.remove('sidebar-sliding');
  }, uiDuration());
}

/**
 * Most common color in the picture's rightmost column: what the page looks
 * like at its right edge. It fills the strip the picture doesn't cover while
 * the page area grows, so a white page doesn't get a dark band.
 */
function rightEdgeColor(image: HTMLImageElement) {
  const height = image.naturalHeight;
  if (!image.naturalWidth || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(
    image,
    image.naturalWidth - 1,
    0,
    1,
    height,
    0,
    0,
    1,
    height,
  );
  const data = context.getImageData(0, 0, 1, height).data;
  const counts = new Map<number, number>();
  let best = -1;
  let bestCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const count = (counts.get(rgb) ?? 0) + 1;
    counts.set(rgb, count);
    if (count > bestCount) {
      best = rgb;
      bestCount = count;
    }
  }
  return best < 0 ? null : `#${best.toString(16).padStart(6, '0')}`;
}

// Main sends a picture of the web page before the slide (the real page
// can't move with it) and takes it away once the page is back.
window.terra.on<{
  image: string;
  bounds: { width: number; height: number };
}>('terra:slide-shot', async ({ image, bounds }) => {
  pageShotImage.style.width = `${bounds.width}px`;
  pageShotImage.style.height = `${bounds.height}px`;
  pageShotImage.src = image;
  await pageShotImage.decode().catch(() => {});
  pageShot.style.background = rightEdgeColor(pageShotImage) ?? '';
  pageShot.hidden = false;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => window.terra.send('terra:slide-shot-ready')),
  );
});
window.terra.on('terra:slide-shot-clear', () => {
  pageShot.hidden = true;
  pageShot.style.background = '';
  pageShotImage.removeAttribute('src');
});

// ---- first paint
//
// The window stays hidden until the UI looks like the user set it up: their
// colors and tabs. Then main shows it (and pictures it for the
// opening animation), so nothing flashes in default colors or unstyled.

let resolveSettings = () => {};
let resolveTabs = () => {};
let resolveState = () => {};
const settingsSeen = new Promise<void>((r) => (resolveSettings = r));
const tabsSeen = new Promise<void>((r) => (resolveTabs = r));
const stateSeen = new Promise<void>((r) => (resolveState = r));
window.browser.onStateChanged(() => resolveState());
void Promise.all([settingsSeen, tabsSeen, stateSeen]).then(() =>
  // Two frames: the first lays the new state out, the second paints it.
  // Only then turn color transitions on (body.starting in index.css), so
  // the first frame doesn't fade in from the default colors.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.body.classList.remove('starting');
      window.terra.send('terra:ui-ready');
    }),
  ),
);

window.browser.onTabsChanged((state) => {
  renderTabs(state);
  resolveTabs();
});

// ---- scroll through tabs

let scrollTabsEnabled = false;
let wheelDelta = 0;

/**
 * With "Scroll through tabs" on, the wheel over the sidebar moves to the next
 * or previous tab. Deltas are added up so one mouse notch = one tab, and a
 * touchpad doesn't fly through every tab at once.
 */
$('#sidebar').addEventListener(
  'wheel',
  (event) => {
    if (!scrollTabsEnabled || tabOrder.length < 2) return;
    event.preventDefault();
    wheelDelta += event.deltaY;
    const NOTCH = 100;
    if (Math.abs(wheelDelta) < NOTCH) return;
    const step = Math.sign(wheelDelta);
    wheelDelta = 0;
    const index = tabOrder.indexOf(activeTabId ?? -1);
    const next = tabOrder[index + step];
    // Stop at the first and last tab instead of wrapping around.
    if (next !== undefined) window.browser.activateTab(next);
  },
  { passive: false },
);

// ---------------------------------------------------------------- settings

const settingsPage = $<HTMLElement>('#settings');
const searchEngine = $<HTMLSelectElement>('#setting-search-engine');
const homePage = $<HTMLInputElement>('#setting-home-page');
const sidebarCollapsed = $<HTMLInputElement>('#setting-sidebar-collapsed');
const autoCompact = $<HTMLInputElement>('#setting-auto-compact');
const showDividers = $<HTMLInputElement>('#setting-show-dividers');
const forceDark = $<HTMLInputElement>('#setting-force-dark');
const scrollTabs = $<HTMLInputElement>('#setting-scroll-tabs');
const askDownload = $<HTMLInputElement>('#setting-ask-download');
const smoothDividers = $<HTMLInputElement>('#setting-smooth-dividers');
const smoothDividersRow = $<HTMLElement>('#smooth-dividers-row');
const windowAnimations = $<HTMLInputElement>('#setting-window-animations');

/** Applies both divider settings to the page. */
function applyDividers(show: boolean, smooth: boolean) {
  document.body.classList.toggle('no-dividers', !show);
  document.body.classList.toggle('smooth-dividers', show && smooth);
  // Smoothing only matters while dividers are shown.
  smoothDividers.disabled = !show;
  smoothDividersRow.classList.toggle('disabled', !show);
}
const clearData = $<HTMLButtonElement>('#clear-data');
const openSettings = $<HTMLButtonElement>('#open-settings');

for (const [value, engine] of Object.entries(SEARCH_ENGINES)) {
  searchEngine.add(new Option(engine.name, value));
}

function setSettingsVisible(open: boolean) {
  if (!open) cancelColorPanel();
  if (open) closeBookmarksPop();
  settingsPage.hidden = !open;
  document.body.classList.toggle('settings-open', open);
  updatePanelButtons();
}

// Pages on the left of the panel: settings categories, History, Downloads.
const categories = document.querySelectorAll<HTMLButtonElement>('.category');
const panels = document.querySelectorAll<HTMLElement>('.settings-panel');
const openDownloads = $<HTMLButtonElement>('#open-downloads');
const SETTINGS_PAGES: PanelPage[] = [
  'appearance',
  'navigation',
  'features',
  'privacy',
];
let currentPage: PanelPage = 'appearance';
let lastSettingsPage: PanelPage = 'appearance';

function showPage(page: PanelPage) {
  cancelColorPanel();
  currentPage = page;
  if (SETTINGS_PAGES.includes(page)) lastSettingsPage = page;
  for (const button of categories) {
    button.classList.toggle('active', button.dataset.category === page);
  }
  for (const panel of panels) panel.hidden = panel.dataset.panel !== page;
  const active = [...categories].find((b) => b.dataset.category === page);
  $('#settings-title').textContent =
    active?.querySelector('.label')?.textContent ?? '';
  updatePanelButtons();
  if (page === 'history') void loadHistory();
  if (page === 'downloads') renderDownloads();
  pageShown(page);
}

/** Gear lit on settings pages, download arrow lit on Downloads. */
function updatePanelButtons() {
  const open = document.body.classList.contains('settings-open');
  openSettings.classList.toggle(
    'active',
    open && SETTINGS_PAGES.includes(currentPage),
  );
  openDownloads.classList.toggle('active', open && currentPage === 'downloads');
}

for (const button of categories) {
  button.addEventListener('click', () =>
    showPage(button.dataset.category as PanelPage),
  );
}
window.browser.onShowPage(showPage);

/** Footer buttons: open their page, or close the panel if already there. */
function togglePage(page: PanelPage, isThere: boolean) {
  const open = document.body.classList.contains('settings-open');
  if (open && isThere) window.browser.setSettingsOpen(false);
  else window.browser.showPage(page);
}

openSettings.addEventListener('click', () =>
  togglePage(lastSettingsPage, SETTINGS_PAGES.includes(currentPage)),
);
openDownloads.addEventListener('click', () =>
  togglePage('downloads', currentPage === 'downloads'),
);
$('#close-settings').addEventListener('click', () =>
  window.browser.setSettingsOpen(false),
);

searchEngine.addEventListener('change', () =>
  window.browser.updateSettings({
    searchEngine: searchEngine.value as SearchEngine,
  }),
);
homePage.addEventListener('change', () =>
  window.browser.updateSettings({ homePage: homePage.value }),
);
homePage.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') homePage.blur();
});
showDividers.addEventListener('change', () => {
  // Switch right away so it feels instant, then save.
  applyDividers(showDividers.checked, smoothDividers.checked);
  window.browser.updateSettings({ showDividers: showDividers.checked });
});
forceDark.addEventListener('change', () =>
  window.browser.updateSettings({ forceDark: forceDark.checked }),
);
askDownload.addEventListener('change', () =>
  window.browser.updateSettings({ askDownloadLocation: askDownload.checked }),
);
windowAnimations.addEventListener('change', () =>
  window.browser.updateSettings({ windowAnimations: windowAnimations.checked }),
);
scrollTabs.addEventListener('change', () => {
  scrollTabsEnabled = scrollTabs.checked;
  window.browser.updateSettings({ scrollTabs: scrollTabs.checked });
});
smoothDividers.addEventListener('change', () => {
  applyDividers(showDividers.checked, smoothDividers.checked);
  window.browser.updateSettings({ smoothDividers: smoothDividers.checked });
});
sidebarCollapsed.addEventListener('change', () =>
  window.browser.updateSettings({ sidebarCollapsed: sidebarCollapsed.checked }),
);
autoCompact.addEventListener('change', () =>
  window.browser.updateSettings({ autoCompactSidebar: autoCompact.checked }),
);

clearData.addEventListener('click', async () => {
  if (
    !confirm(
      'Delete cookies, cache and site data? You will be signed out of websites.',
    )
  ) {
    return;
  }
  clearData.disabled = true;
  clearData.textContent = 'Clearing…';
  try {
    await window.browser.clearBrowsingData();
    clearData.textContent = 'Cleared ✓';
  } catch {
    clearData.textContent = 'Failed, try again';
  }
  setTimeout(() => {
    clearData.disabled = false;
    clearData.textContent = 'Clear data';
  }, 2000);
});

// ---- accent color

const accentSwatches = $<HTMLDivElement>('#accent-swatches');
const accentCustom = $<HTMLButtonElement>('#accent-custom');

/**
 * A color token as #rrggbb, or null. The production build shortens colors
 * (#ffffff becomes #fff), so short ones are expanded.
 */
function fullHex(value: string) {
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${[...color.slice(1)].map((c) => c + c).join('')}`;
  }
  return null;
}

function hexToRgb(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mix(hex: string, target: number, amount: number) {
  const [r, g, b] = hexToRgb(hex).map((c) =>
    Math.round(c + (target - c) * amount),
  );
  return `rgb(${r}, ${g}, ${b})`;
}

/** Sets the accent CSS variables used everywhere in the UI. */
function applyAccent(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  // Pick black or white text so text on the accent stays readable.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const style = document.documentElement.style;
  style.setProperty('--accent', hex);
  style.setProperty('--accent-strong', hex);
  style.setProperty(
    '--accent-hover',
    luminance > 0.6 ? mix(hex, 0, 0.12) : mix(hex, 255, 0.15),
  );
  style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.18)`);
  style.setProperty('--on-accent', luminance > 0.6 ? '#111318' : '#ffffff');

  colors.accentColor = hex;
  applyBackground();

  const isPreset = ACCENT_PRESETS.some((preset) => preset.color === hex);
  accentCustom.classList.toggle('selected', !isPreset);
  for (const swatch of accentSwatches.querySelectorAll<HTMLElement>(
    '.accent-swatch',
  )) {
    swatch.classList.toggle('selected', swatch.dataset.color === hex);
  }
}

function chooseAccent(hex: string) {
  applyAccent(hex);
  window.browser.updateSettings({ accentColor: hex });
}

for (const preset of ACCENT_PRESETS) {
  const swatch = document.createElement('button');
  swatch.className = 'accent-swatch';
  swatch.title = preset.name;
  swatch.ariaLabel = `${preset.name} accent`;
  swatch.dataset.color = preset.color;
  swatch.style.background = preset.color;
  swatch.addEventListener('click', () => chooseAccent(preset.color));
  accentSwatches.append(swatch);
}

// Custom: preview in the color panel, keep it only on Apply.
accentCustom.addEventListener('click', () => {
  const saved = colors.accentColor;
  openColorPanel(accentCustom, {
    color: saved,
    label: 'Custom accent color',
    onPreview: applyAccent,
    onApply: chooseAccent,
    onCancel: () => applyAccent(saved),
  });
});

// ---- background tint

/** What the UI colors depend on, kept current for live previews. */
const colors: Pick<Settings, 'theme' | 'accentColor' | 'backgroundTint'> = {
  theme: 'dark',
  accentColor: ACCENT_PRESETS[0].color,
  backgroundTint: '',
};

/** Surfaces the tint is blended into (lines and controls too). */
const TINTED_TOKENS = [
  '--bg',
  '--panel',
  '--border',
  '--hover',
  '--input-bg',
  '--input-border',
  '--chip',
  '--spinner-track',
];

const tintRow = $<HTMLDivElement>('#tint-row');
const tintNote = $<HTMLElement>('#tint-note');
const tintSwatches = $<HTMLDivElement>('#tint-swatches');
const tintCustom = $<HTMLButtonElement>('#tint-custom');

/**
 * Blends the tint into the theme's own colors (read from the stylesheet,
 * so index.css stays the one place they're defined).
 */
function applyBackground() {
  const style = document.documentElement.style;
  for (const token of TINTED_TOKENS) style.removeProperty(token);
  const tint = activeTint(colors);
  if (tint) {
    const computed = getComputedStyle(document.documentElement);
    for (const token of TINTED_TOKENS) {
      const base = fullHex(computed.getPropertyValue(token));
      if (base) {
        style.setProperty(token, mixHex(base, tint, TINT_AMOUNT[colors.theme]));
      }
    }
  }
  updateDither();

  const oled = colors.theme === 'oled';
  tintRow.classList.toggle('disabled', oled);
  tintNote.textContent = oled ? 'Off in OLED dark' : 'Dark and light mode';
  for (const control of tintRow.querySelectorAll<HTMLButtonElement>('button')) {
    control.disabled = oled;
  }
  const choice = colors.backgroundTint;
  const isPreset = [
    '',
    'accent',
    ...ACCENT_PRESETS.map((p) => p.color),
  ].includes(choice);
  tintCustom.classList.toggle('selected', !isPreset);
  if (!isPreset) {
    tintCustom.style.setProperty('--tint-custom', choice);
  }
  for (const swatch of tintSwatches.querySelectorAll<HTMLElement>(
    '.accent-swatch',
  )) {
    swatch.classList.toggle('selected', swatch.dataset.tint === choice);
  }
}

function chooseTint(value: string) {
  colors.backgroundTint = value;
  applyBackground();
  window.browser.updateSettings({ backgroundTint: value });
}

for (const option of [
  { tint: '', name: 'None', extra: 'tint-none' },
  { tint: 'accent', name: 'Same as accent', extra: 'tint-accent' },
  ...ACCENT_PRESETS.map((preset) => ({
    tint: preset.color,
    name: preset.name,
    extra: '',
  })),
]) {
  const swatch = document.createElement('button');
  swatch.className = `accent-swatch ${option.extra}`.trim();
  swatch.title = option.name;
  swatch.ariaLabel = `${option.name} background`;
  swatch.dataset.tint = option.tint;
  if (option.tint.startsWith('#')) swatch.style.background = option.tint;
  swatch.addEventListener('click', () => chooseTint(option.tint));
  tintSwatches.append(swatch);
}

tintCustom.addEventListener('click', () => {
  const saved = colors.backgroundTint;
  const preview = (value: string) => {
    colors.backgroundTint = value;
    applyBackground();
  };
  openColorPanel(tintCustom, {
    // Start from the tint in use, or the accent when there is none.
    color: activeTint(colors) ?? colors.accentColor,
    label: 'Custom background tint',
    onPreview: preview,
    onApply: chooseTint,
    onCancel: () => preview(saved),
  });
});

// ---- dithering

/**
 * Dark gradients only have a few brightness steps, so they show bands
 * (especially on VA monitors). A tile of tiny noise that nudges pixels one
 * level up or down hides the steps. It is built for the current panel color
 * so it is zero-mean: it adds grain without making anything lighter or darker.
 */
let ditherFor = '';

function updateDither() {
  const panel = fullHex(
    getComputedStyle(document.documentElement).getPropertyValue('--panel'),
  );
  if (!panel || panel === ditherFor) return;
  ditherFor = panel;

  const [r, g, b] = hexToRgb(panel);
  const base = Math.max(1, Math.min(254, (r + g + b) / 3));

  // Alpha so that one white pixel adds ~1 level and one black pixel
  // removes ~1 level on this background.
  const whiteAlpha = Math.max(1, Math.round(255 / (255 - base)));
  const blackAlpha = Math.max(1, Math.round(255 / base));

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const roll = Math.random();
    if (roll < 1 / 3) {
      image.data.set([255, 255, 255, whiteAlpha], i);
    } else if (roll < 2 / 3) {
      image.data.set([0, 0, 0, blackAlpha], i);
    }
  }
  context.putImageData(image, 0, 0);
  document.documentElement.style.setProperty(
    '--dither',
    `url("${canvas.toDataURL('image/png')}")`,
  );
}

// ---- color mode

const themeInputs = document.querySelectorAll<HTMLInputElement>(
  'input[name="theme"]',
);
for (const input of themeInputs) {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    // Switch right away so it feels instant, then save.
    document.documentElement.dataset.theme = input.value;
    colors.theme = input.value as Theme;
    applyBackground();
    window.browser.updateSettings({ theme: input.value as Theme });
  });
}

// ---- history

const historyList = $<HTMLDivElement>('#history-list');
const historySearch = $<HTMLInputElement>('#history-search');
const HISTORY_PAGE = 300;
let historyEntries: HistoryEntry[] = [];
let historyShown = HISTORY_PAGE;

const ICONS = {
  remove:
    '<line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />',
  pause:
    '<line x1="9" y1="5" x2="9" y2="19" /><line x1="15" y1="5" x2="15" y2="19" />',
  resume: '<polygon points="7 5 19 12 7 19 7 5" />',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />',
  retry:
    '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5" /><polyline points="20 4 20 8.5 15.5 8.5" />',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="14 3 14 9 20 9" />',
};

function iconButton(
  icon: keyof typeof ICONS,
  title: string,
  onClick: () => void,
) {
  const button = document.createElement('button');
  button.className = 'icon-button list-action';
  button.title = title;
  button.ariaLabel = title;
  button.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function dayLabel(time: number) {
  const day = new Date(time);
  const today = new Date();
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(day)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

async function loadHistory() {
  historyEntries = await window.browser.getHistory();
  renderHistory();
}

function renderHistory() {
  const query = historySearch.value.trim().toLowerCase();
  const matches = query
    ? historyEntries.filter(
        (e) =>
          e.title.toLowerCase().includes(query) ||
          e.url.toLowerCase().includes(query),
      )
    : historyEntries;

  if (matches.length === 0) {
    historyList.replaceChildren(
      emptyState(query ? 'Nothing matches your search' : 'No history yet'),
    );
    return;
  }

  // One card per day, newest first.
  const cards: HTMLElement[] = [];
  let card: HTMLElement | null = null;
  let label = '';
  for (const entry of matches.slice(0, historyShown)) {
    const day = dayLabel(entry.time);
    if (!card || day !== label) {
      label = day;
      card = document.createElement('div');
      card.className = 'settings-card list-card';
      const title = document.createElement('div');
      title.className = 'card-title';
      title.textContent = day;
      card.append(title);
      cards.push(card);
    }
    card.append(historyRow(entry));
  }

  if (matches.length > historyShown) {
    const more = document.createElement('button');
    more.className = 'text-button show-more';
    more.textContent = `Show more (${matches.length - historyShown})`;
    more.addEventListener('click', () => {
      historyShown += HISTORY_PAGE;
      renderHistory();
    });
    cards.push(more);
  }
  historyList.replaceChildren(...cards);
}

function historyRow(entry: HistoryEntry) {
  const row = document.createElement('div');
  row.className = 'list-row clickable';
  row.tabIndex = 0;
  row.title = entry.url;

  const badge = document.createElement('span');
  badge.className = 'tab-icon letter';
  badge.textContent = (hostOf(entry.url)[0] ?? '•').toUpperCase();

  const text = document.createElement('span');
  text.className = 'list-text';
  const title = document.createElement('span');
  title.className = 'list-title';
  title.textContent = entry.title || hostOf(entry.url);
  const sub = document.createElement('small');
  sub.textContent = hostOf(entry.url);
  text.append(title, sub);

  const time = document.createElement('small');
  time.className = 'list-meta';
  time.textContent = new Date(entry.time).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  const remove = iconButton('remove', 'Remove from history', () => {
    window.browser.deleteHistory(entry.id);
    historyEntries = historyEntries.filter((e) => e.id !== entry.id);
    renderHistory();
  });

  const open = () => window.browser.openUrl(entry.url);
  row.addEventListener('click', open);
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') open();
  });
  row.append(badge, text, time, remove);
  return row;
}

function emptyState(message: string) {
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = message;
  return empty;
}

historySearch.addEventListener('input', () => {
  historyShown = HISTORY_PAGE;
  renderHistory();
});
$('#history-clear').addEventListener('click', () => {
  if (!confirm('Delete your whole browsing history?')) return;
  window.browser.clearHistory();
  historyEntries = [];
  renderHistory();
});
window.browser.onHistoryChanged(() => {
  if (currentPage === 'history' && !settingsPage.hidden) void loadHistory();
});

// ---- downloads

const downloadsList = $<HTMLDivElement>('#downloads-list');
let downloads: DownloadInfo[] = [];
/** Last measurement per download, to show the speed. */
const speeds = new Map<
  string,
  { bytes: number; time: number; speed: number }
>();

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function downloadStatus(d: DownloadInfo) {
  const size = d.total
    ? `${formatBytes(d.received)} of ${formatBytes(d.total)}`
    : formatBytes(d.received);
  switch (d.state) {
    case 'progressing': {
      const speed = speeds.get(d.id)?.speed ?? 0;
      return speed > 0 ? `${size} · ${formatBytes(speed)}/s` : size;
    }
    case 'paused':
      return `Paused · ${size}`;
    case 'completed':
      return d.exists
        ? `${formatBytes(d.total)} · ${hostOf(d.url)}`
        : 'File deleted or moved';
    case 'cancelled':
      return 'Cancelled';
    case 'interrupted':
      return 'Failed';
  }
}

function measureSpeeds() {
  const now = Date.now();
  for (const d of downloads) {
    const last = speeds.get(d.id);
    if (d.state !== 'progressing') {
      speeds.delete(d.id);
    } else if (!last) {
      speeds.set(d.id, { bytes: d.received, time: now, speed: 0 });
    } else if (now - last.time >= 500) {
      const current = ((d.received - last.bytes) * 1000) / (now - last.time);
      // Smooth it so the number doesn't jump around.
      const speed = last.speed ? last.speed * 0.6 + current * 0.4 : current;
      speeds.set(d.id, { bytes: d.received, time: now, speed });
    }
  }
}

function renderDownloads() {
  if (downloads.length === 0) {
    downloadsList.replaceChildren(emptyState('No downloads yet'));
    return;
  }
  downloadsList.replaceChildren(...downloads.map(downloadRow));
}

function downloadRow(d: DownloadInfo) {
  const row = document.createElement('div');
  row.className = 'list-row download-row';
  const canOpen = d.state === 'completed' && d.exists;
  row.classList.toggle('clickable', canOpen);
  row.classList.toggle(
    'faded',
    !canOpen && d.state !== 'progressing' && d.state !== 'paused',
  );

  const icon = document.createElement('span');
  icon.className = 'list-icon';
  icon.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS.file}</svg>`;

  const text = document.createElement('span');
  text.className = 'list-text';
  const name = document.createElement('span');
  name.className = 'list-title';
  name.textContent = d.filename || 'Download';
  const status = document.createElement('small');
  status.textContent = downloadStatus(d);
  text.append(name, status);

  if (d.state === 'progressing' || d.state === 'paused') {
    const bar = document.createElement('span');
    bar.className = 'progress';
    bar.classList.toggle('unknown', !d.total);
    const fill = document.createElement('span');
    fill.style.width = d.total
      ? `${Math.min(100, (d.received / d.total) * 100)}%`
      : '100%';
    bar.append(fill);
    text.append(bar);
  }

  const actions = document.createElement('span');
  actions.className = 'list-actions';
  const act = (action: DownloadAction) => () =>
    window.browser.downloadAction(d.id, action);
  if (d.state === 'progressing') {
    actions.append(iconButton('pause', 'Pause', act('pause')));
    actions.append(iconButton('remove', 'Cancel', act('cancel')));
  } else if (d.state === 'paused') {
    if (d.canResume)
      actions.append(iconButton('resume', 'Resume', act('resume')));
    actions.append(iconButton('remove', 'Cancel', act('cancel')));
  } else {
    if (canOpen)
      actions.append(iconButton('folder', 'Show in folder', act('show')));
    if (d.state !== 'completed')
      actions.append(iconButton('retry', 'Try again', act('retry')));
    actions.append(iconButton('remove', 'Remove from list', act('remove')));
  }

  if (canOpen) {
    row.tabIndex = 0;
    row.title = 'Open file';
    row.addEventListener('click', act('open'));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') act('open')();
    });
  }
  row.append(icon, text, actions);
  return row;
}

window.browser.onDownloads((list) => {
  downloads = list;
  measureSpeeds();
  // The footer arrow glows in the accent color while something downloads.
  openDownloads.classList.toggle(
    'busy',
    list.some((d) => d.state === 'progressing'),
  );
  if (currentPage === 'downloads' && !settingsPage.hidden) renderDownloads();
});
$('#downloads-folder').addEventListener('click', () =>
  window.browser.openDownloadsFolder(),
);
$('#downloads-clear').addEventListener('click', () =>
  window.browser.clearDownloads(),
);

// ---- shortcuts (bindings)

const bindingsList = $<HTMLDivElement>('#bindings');
const customList = $<HTMLDivElement>('#custom-bindings');
let currentBindings = defaultBindings();
let customBindings: CustomBinding[] = [];
/** What is being recorded: a built-in action, or "custom:<id>". */
let recording: string | null = null;

function saveBindings(
  bindings: typeof currentBindings,
  custom: CustomBinding[] = customBindings,
) {
  currentBindings = bindings;
  customBindings = custom;
  renderBindings();
  window.browser.updateSettings({ bindings, customBindings: custom });
}

/** Binds a key to a built-in action or a custom shortcut. */
function setBinding(target: string, binding: string) {
  const next = { ...currentBindings };
  // One thing per key: take it away from whatever had it.
  for (const other of ACTIONS) {
    if (binding && next[other.id] === binding) next[other.id] = '';
  }
  const custom = customBindings.map((c) =>
    binding && c.binding === binding ? { ...c, binding: '' } : c,
  );
  if (target.startsWith('custom:')) {
    const id = target.slice('custom:'.length);
    const index = custom.findIndex((c) => c.id === id);
    if (index !== -1) custom[index] = { ...custom[index], binding };
  } else {
    next[target as ActionId] = binding;
  }
  saveBindings(next, custom);
}

/** The key cap button + remove button used by every shortcut row. */
function bindingControls(target: string, value: string, name: string) {
  const controls = document.createElement('div');
  controls.className = 'binding-controls';

  const button = document.createElement('button');
  button.className = 'binding';
  button.classList.toggle('unset', !value);
  button.classList.toggle('recording', recording === target);
  button.textContent =
    recording === target ? 'Press a key or mouse button' : bindingLabel(value);
  button.title = 'Click, then press a key or mouse side button';
  button.addEventListener('click', () => {
    recording = target;
    window.browser.setRecordingBinding(true);
    renderBindings();
  });

  const clear = document.createElement('button');
  clear.className = 'icon-button binding-clear';
  clear.title = 'Remove';
  clear.ariaLabel = `Remove ${name} shortcut`;
  clear.innerHTML = CLOSE_ICON;
  clear.disabled = !value;
  clear.addEventListener('click', () => setBinding(target, ''));

  controls.append(button, clear);
  return controls;
}

function stopRecording() {
  recording = null;
  window.browser.setRecordingBinding(false);
  renderBindings();
}

function renderBindings() {
  bindingsList.replaceChildren(
    ...ACTIONS.map((action) => {
      const row = document.createElement('div');
      row.className = 'setting-row binding-row';

      const label = document.createElement('strong');
      label.textContent = action.label;

      const controls = bindingControls(
        action.id,
        currentBindings[action.id],
        action.label,
      );
      row.append(label, controls);
      return row;
    }),
  );

  customList.replaceChildren(
    ...customBindings.map((custom) => {
      const row = document.createElement('div');
      row.className = 'setting-row binding-row';

      const url = document.createElement('input');
      url.type = 'text';
      url.className = 'custom-url';
      url.placeholder = 'Site or link, e.g. youtube.com';
      url.spellcheck = false;
      url.value = custom.url;
      url.addEventListener('change', () =>
        saveBindings(
          currentBindings,
          customBindings.map((c) =>
            c.id === custom.id ? { ...c, url: url.value.trim() } : c,
          ),
        ),
      );
      url.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') url.blur();
      });

      const controls = bindingControls(
        `custom:${custom.id}`,
        custom.binding,
        custom.url || 'custom',
      );
      // On a custom row, the remove button deletes the whole shortcut.
      const remove =
        controls.querySelector<HTMLButtonElement>('.binding-clear')!;
      const fresh = remove.cloneNode(true) as HTMLButtonElement;
      fresh.disabled = false;
      fresh.title = 'Delete shortcut';
      fresh.addEventListener('click', () =>
        saveBindings(
          currentBindings,
          customBindings.filter((c) => c.id !== custom.id),
        ),
      );
      remove.replaceWith(fresh);

      row.append(url, controls);
      return row;
    }),
  );
}

$('#add-custom').addEventListener('click', () => {
  const id = Math.random().toString(36).slice(2, 10);
  saveBindings(currentBindings, [
    ...customBindings,
    { id, url: '', binding: '' },
  ]);
  // Start with the link: focus the new row's input.
  customList
    .querySelector<HTMLInputElement>('.binding-row:last-child input')
    ?.focus();
});

// Record the next key press (Escape cancels) or mouse side button.
window.addEventListener(
  'keydown',
  (event) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') return stopRecording();
    const combo = keyCombo({
      key: event.key,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
    });
    if (!combo) return; // only a modifier so far, keep waiting
    const action = recording;
    stopRecording();
    setBinding(action, combo);
  },
  true,
);

window.addEventListener(
  'mouseup',
  (event) => {
    const button = MOUSE_BUTTONS[event.button];
    if (!button) return;
    event.preventDefault();
    if (recording) {
      const action = recording;
      stopRecording();
      setBinding(action, button);
    } else {
      // Side buttons over our own UI run their binding too.
      window.browser.mouseButton(event.button);
    }
  },
  true,
);

$('#reset-bindings').addEventListener('click', () => {
  if (recording) stopRecording();
  saveBindings(defaultBindings());
});

window.browser.onSettingsChanged((settings) => {
  document.documentElement.dataset.theme = settings.theme;
  colors.theme = settings.theme;
  colors.backgroundTint = settings.backgroundTint;
  // Also applies the background tint.
  applyAccent(settings.accentColor);
  for (const input of themeInputs) {
    input.checked = input.value === settings.theme;
  }
  searchEngine.value = settings.searchEngine;
  if (document.activeElement !== homePage) homePage.value = settings.homePage;
  sidebarCollapsed.checked = settings.sidebarCollapsed;
  autoCompact.checked = settings.autoCompactSidebar;
  updateAutoCompact({ enabled: settings.autoCompactSidebar });
  showDividers.checked = settings.showDividers;
  smoothDividers.checked = settings.smoothDividers;
  forceDark.checked = settings.forceDark;
  scrollTabs.checked = settings.scrollTabs;
  scrollTabsEnabled = settings.scrollTabs;
  windowAnimations.checked = settings.windowAnimations;
  askDownload.checked = settings.askDownloadLocation;
  currentBindings = settings.bindings;
  customBindings = settings.customBindings;
  // Don't rebuild the list under the user's cursor while they type a link.
  if (!customList.contains(document.activeElement)) renderBindings();
  applyDividers(settings.showDividers, settings.smoothDividers);
  resolveSettings();
});
