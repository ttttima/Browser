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
  theme: 'dark',
  accentColor: '#4f7cff',
};
