import './index.css';
import {
  ACCENT_PRESETS,
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
  windowAction: (action: 'close' | 'minimize' | 'maximize') => void;
  platform: string;
  setSettingsOpen: (open: boolean) => void;
  updateSettings: (changes: Partial<Settings>) => void;
  clearBrowsingData: () => Promise<boolean>;
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
  if (event.key === 'Enter') {
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

$('#start-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!startSearch.value.trim()) return;
  window.browser.navigate(startSearch.value);
  startSearch.value = '';
  startSearch.blur();
});
startSearch.addEventListener('keydown', (event) => {
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
// Like macOS: grey lights while the window is in the background.
window.browser.onWindowFocus((focused) =>
  document.body.classList.toggle('window-inactive', !focused),
);

// ---------------------------------------------------------------- tabs

const CLOSE_ICON =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>';

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

  const close = document.createElement('button');
  close.className = 'tab-close';
  close.title = 'Close tab (Ctrl+W)';
  close.innerHTML = CLOSE_ICON;
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    window.browser.closeTab(id);
  });

  item.append(icon, title, close);

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
  const key = tab.loading ? 'loading' : (tab.favicon ?? `letter:${tab.title}`);
  if (icon.dataset.key === key) return;
  icon.dataset.key = key;
  icon.replaceChildren();
  icon.classList.remove('spinner', 'letter');

  if (tab.loading) {
    icon.classList.add('spinner');
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
  document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
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

  $('#toggle-sidebar').title = state.sidebarCollapsed
    ? 'Expand sidebar (Ctrl+Shift+B)'
    : 'Collapse sidebar (Ctrl+Shift+B)';

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

window.browser.onTabsChanged(renderTabs);

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
const showDividers = $<HTMLInputElement>('#setting-show-dividers');
const forceDark = $<HTMLInputElement>('#setting-force-dark');
const scrollTabs = $<HTMLInputElement>('#setting-scroll-tabs');
const smoothDividers = $<HTMLInputElement>('#setting-smooth-dividers');
const smoothDividersRow = $<HTMLElement>('#smooth-dividers-row');

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
  settingsPage.hidden = !open;
  document.body.classList.toggle('settings-open', open);
  openSettings.classList.toggle('active', open);
}

// Categories on the left of the settings page.
const categories = document.querySelectorAll<HTMLButtonElement>('.category');
const panels = document.querySelectorAll<HTMLElement>('.settings-panel');
for (const button of categories) {
  button.addEventListener('click', () => {
    for (const other of categories) {
      other.classList.toggle('active', other === button);
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.panel !== button.dataset.category;
    }
    $('#settings-title').textContent =
      button.querySelector('.label')?.textContent ?? '';
  });
}

openSettings.addEventListener('click', () =>
  window.browser.setSettingsOpen(
    !document.body.classList.contains('settings-open'),
  ),
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
const accentCustom = $<HTMLLabelElement>('.accent-custom');
const accentCustomInput = $<HTMLInputElement>('#accent-custom-input');

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

  accentCustomInput.value = hex;
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

// "input" fires while dragging in the color window: preview live.
accentCustomInput.addEventListener('input', () =>
  applyAccent(accentCustomInput.value),
);
// "change" fires when the color window closes: save it.
accentCustomInput.addEventListener('change', () =>
  chooseAccent(accentCustomInput.value),
);

// ---- dithering

/**
 * Dark gradients only have a few brightness steps, so they show bands
 * (especially on VA monitors). A tile of tiny noise that nudges pixels one
 * level up or down hides the steps. It is built for the current panel color
 * so it is zero-mean: it adds grain without making anything lighter or darker.
 */
let ditherFor = '';

function updateDither() {
  const panel = getComputedStyle(document.documentElement)
    .getPropertyValue('--panel')
    .trim();
  if (panel === ditherFor) return;
  ditherFor = panel;

  const match = /^#([0-9a-f]{6})$/i.exec(panel);
  if (!match) return;
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
    updateDither();
    window.browser.updateSettings({ theme: input.value as Theme });
  });
}

window.browser.onSettingsChanged((settings) => {
  document.documentElement.dataset.theme = settings.theme;
  updateDither();
  applyAccent(settings.accentColor);
  for (const input of themeInputs) {
    input.checked = input.value === settings.theme;
  }
  searchEngine.value = settings.searchEngine;
  if (document.activeElement !== homePage) homePage.value = settings.homePage;
  sidebarCollapsed.checked = settings.sidebarCollapsed;
  showDividers.checked = settings.showDividers;
  smoothDividers.checked = settings.smoothDividers;
  forceDark.checked = settings.forceDark;
  scrollTabs.checked = settings.scrollTabs;
  scrollTabsEnabled = settings.scrollTabs;
  applyDividers(settings.showDividers, settings.smoothDividers);
});
