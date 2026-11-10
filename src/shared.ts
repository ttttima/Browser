// Types shared by the main process, the preload script and the UI.

export interface BrowserState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  favicon: string | null;
  loading: boolean;
  /** Showing our clean search page instead of a website. */
  isNewTab: boolean;
}

export interface TabsState {
  tabs: TabInfo[];
  activeTabId: number | null;
  sidebarCollapsed: boolean;
  fullScreen: boolean;
  settingsOpen: boolean;
}

/** Background colors at the website's left and top edges (#rrggbb). */
export interface PageEdges {
  left: string | null;
  top: string | null;
}

// ---------------------------------------------------------------- bindings

/** Everything a key or mouse button can be bound to. */
export const ACTIONS = [
  { id: 'reload', label: 'Refresh', binding: 'F5' },
  { id: 'back', label: 'Back', binding: 'Mouse4' },
  { id: 'forward', label: 'Forward', binding: 'Mouse5' },
  { id: 'hardReload', label: 'Refresh without cache', binding: '' },
  { id: 'newTab', label: 'New tab', binding: '' },
  { id: 'closeTab', label: 'Close tab', binding: '' },
  { id: 'reopenTab', label: 'Reopen closed tab', binding: '' },
  { id: 'nextTab', label: 'Next tab', binding: '' },
  { id: 'previousTab', label: 'Previous tab', binding: '' },
  { id: 'focusAddress', label: 'Address bar', binding: '' },
  { id: 'toggleSidebar', label: 'Compact sidebar', binding: '' },
  { id: 'openSettings', label: 'Settings', binding: '' },
  { id: 'openHistory', label: 'History', binding: '' },
  { id: 'openDownloads', label: 'Downloads', binding: '' },
  { id: 'zoomIn', label: 'Zoom in', binding: '' },
  { id: 'zoomOut', label: 'Zoom out', binding: '' },
  { id: 'zoomReset', label: 'Reset zoom', binding: '' },
  { id: 'devTools', label: 'Developer tools', binding: '' },
] as const;

/** A user-made shortcut: press it to open \`url\` in a new tab. */
export interface CustomBinding {
  id: string;
  url: string;
  binding: string;
}

export type ActionId = (typeof ACTIONS)[number]['id'];
export type Bindings = Record<ActionId, string>;

export function defaultBindings(): Bindings {
  return Object.fromEntries(
    ACTIONS.map((action) => [action.id, action.binding]),
  ) as Bindings;
}

/** Mouse side buttons, by DOM button number (3 = back, 4 = forward). */
export const MOUSE_BUTTONS: Record<number, string> = {
  3: 'Mouse4',
  4: 'Mouse5',
};

/**
 * One text form for a key press, used by both the main process and the
 * UI so a binding recorded in settings matches what is pressed later:
 * "F5", "Ctrl+Shift+T", "Alt+ArrowLeft". Returns "" for a lone modifier.
 */
export function keyCombo(press: {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}): string {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(press.key)) {
    return '';
  }
  const key =
    press.key === ' '
      ? 'Space'
      : press.key.length === 1
        ? press.key.toUpperCase()
        : press.key;
  return [
    press.ctrl && 'Ctrl',
    press.alt && 'Alt',
    press.shift && 'Shift',
    press.meta && 'Meta',
    key,
  ]
    .filter(Boolean)
    .join('+');
}

/** How a binding is shown in settings. */
export function bindingLabel(binding: string) {
  if (!binding) return 'Not set';
  if (binding === 'Mouse4') return 'Mouse back';
  if (binding === 'Mouse5') return 'Mouse forward';
  return binding
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓');
}

// ---------------------------------------------------------------- library

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  /** When it was visited, in ms since 1970. */
  time: number;
}

export type DownloadState =
  | 'progressing'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'interrupted';

export interface DownloadInfo {
  id: string;
  filename: string;
  url: string;
  /** Where the file is saved ("" until chosen in a Save dialog). */
  path: string;
  received: number;
  /** 0 when the server doesn't say how big the file is. */
  total: number;
  state: DownloadState;
  started: number;
  canResume: boolean;
  /** For completed downloads: is the file still on disk? */
  exists: boolean;
}

export type DownloadAction =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'open'
  | 'show'
  | 'retry'
  | 'remove';

/** Pages that open in the full-window panel next to the settings. */
export type PanelPage =
  | 'appearance'
  | 'navigation'
  | 'features'
  | 'history'
  | 'downloads';

export type Theme = 'dark' | 'light' | 'oled';

export const THEMES: Theme[] = ['dark', 'light', 'oled'];

/** Window background behind the UI for each theme (matches --bg in CSS). */
export const THEME_BACKGROUNDS: Record<Theme, string> = {
  dark: '#111318',
  light: '#f6f7f9',
  oled: '#000000',
};

/** Ready-made accent colors shown as swatches in settings. */
export const ACCENT_PRESETS = [
  { name: 'Blue', color: '#4f7cff' },
  { name: 'Purple', color: '#8b5cf6' },
  { name: 'Pink', color: '#ec4899' },
  { name: 'Red', color: '#ef4444' },
  { name: 'Orange', color: '#f97316' },
  { name: 'Yellow', color: '#eab308' },
  { name: 'Green', color: '#22c55e' },
  { name: 'Teal', color: '#14b8a6' },
];

export type SearchEngine = 'google' | 'duckduckgo' | 'bing' | 'brave';

export interface Settings {
  searchEngine: SearchEngine;
  homePage: string;
  sidebarCollapsed: boolean;
  /** Show the lines between sections (sidebar, bars, rows). */
  showDividers: boolean;
  /** Soft, faded dividers instead of sharp 1px lines. */
  smoothDividers: boolean;
  /** Make websites without a dark mode dark (built-in forcer). */
  forceDark: boolean;
  /** Mouse wheel over the sidebar switches tabs. */
  scrollTabs: boolean;
  /** Show a Save dialog for every download instead of using Downloads. */
  askDownloadLocation: boolean;
  /** Key or mouse button for each action ("" = not set). */
  bindings: Bindings;
  /** User-made shortcuts that open a site. */
  customBindings: CustomBinding[];
  theme: Theme;
  /** Main accent color as #rrggbb. */
  accentColor: string;
}

export const SEARCH_ENGINES: Record<
  SearchEngine,
  { name: string; url: string }
> = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
};

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'google',
  // Empty = new tabs show the clean search page.
  homePage: '',
  sidebarCollapsed: false,
  showDividers: true,
  smoothDividers: false,
  forceDark: false,
  scrollTabs: false,
  askDownloadLocation: false,
  bindings: defaultBindings(),
  customBindings: [],
  theme: 'dark',
  accentColor: '#4f7cff',
};
