import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  BrowserState,
  DefaultBrowserState,
  DownloadAction,
  DownloadInfo,
  HistoryEntry,
  PageEdges,
  PanelPage,
  Settings,
  TabsState,
} from './shared';

contextBridge.exposeInMainWorld('browser', {
  navigate: (url: string) => ipcRenderer.send('browser:navigate', url),
  back: () => ipcRenderer.send('browser:back'),
  forward: () => ipcRenderer.send('browser:forward'),
  reload: () => ipcRenderer.send('browser:reload'),
  stop: () => ipcRenderer.send('browser:stop'),

  newTab: () => ipcRenderer.send('browser:new-tab'),
  closeTab: (id: number) => ipcRenderer.send('browser:close-tab', id),
  activateTab: (id: number) => ipcRenderer.send('browser:activate-tab', id),
  moveTab: (id: number, toIndex: number) =>
    ipcRenderer.send('browser:move-tab', id, toIndex),
  toggleSidebar: () => ipcRenderer.send('browser:toggle-sidebar'),

  getHistory: (): Promise<HistoryEntry[]> =>
    ipcRenderer.invoke('browser:history-get'),
  deleteHistory: (id: string) => ipcRenderer.send('browser:history-delete', id),
  clearHistory: () => ipcRenderer.send('browser:history-clear'),
  openUrl: (url: string) => ipcRenderer.send('browser:open-url', url),
  downloadAction: (id: string, action: DownloadAction) =>
    ipcRenderer.send('browser:download-action', id, action),
  clearDownloads: () => ipcRenderer.send('browser:downloads-clear'),
  openDownloadsFolder: () => ipcRenderer.send('browser:downloads-folder'),
  showPage: (page: PanelPage) => ipcRenderer.send('browser:show-page', page),
  onDownloads: (callback: (downloads: DownloadInfo[]) => void) => {
    ipcRenderer.on('browser:downloads', (_event, downloads: DownloadInfo[]) =>
      callback(downloads),
    );
  },
  onHistoryChanged: (callback: () => void) => {
    ipcRenderer.on('browser:history-changed', () => callback());
  },
  onShowPage: (callback: (page: PanelPage) => void) => {
    ipcRenderer.on('browser:show-page', (_event, page: PanelPage) =>
      callback(page),
    );
  },
  windowAction: (action: 'close' | 'minimize' | 'maximize') =>
    ipcRenderer.send('browser:window', action),
  platform: process.platform,
  mouseButton: (button: number) =>
    ipcRenderer.send('browser:mouse-button', button),
  setRecordingBinding: (on: boolean) =>
    ipcRenderer.send('browser:recording-binding', on),

  setSettingsOpen: (open: boolean) =>
    ipcRenderer.send('browser:set-settings-open', open),
  updateSettings: (changes: Partial<Settings>) =>
    ipcRenderer.send('browser:update-settings', changes),
  clearBrowsingData: (): Promise<boolean> =>
    ipcRenderer.invoke('browser:clear-data'),
  getDefaultBrowser: (): Promise<DefaultBrowserState> =>
    ipcRenderer.invoke('browser:default-browser-get'),
  makeDefaultBrowser: () => ipcRenderer.send('browser:default-browser-set'),

  onStateChanged: (callback: (state: BrowserState) => void) => {
    ipcRenderer.on('browser:state', (_event, state: BrowserState) =>
      callback(state),
    );
  },
  onTabsChanged: (callback: (state: TabsState) => void) => {
    ipcRenderer.on('browser:tabs', (_event, state: TabsState) =>
      callback(state),
    );
  },
  onSettingsChanged: (callback: (settings: Settings) => void) => {
    ipcRenderer.on('browser:settings', (_event, settings: Settings) =>
      callback(settings),
    );
  },
  onPageEdges: (callback: (edges: PageEdges) => void) => {
    ipcRenderer.on('browser:page-edges', (_event, edges: PageEdges) =>
      callback(edges),
    );
  },
  onWindowFocus: (callback: (focused: boolean) => void) => {
    ipcRenderer.on('browser:window-focus', (_event, focused: boolean) =>
      callback(focused),
    );
  },
  onFocusAddress: (callback: () => void) => {
    ipcRenderer.on('browser:focus-address', () => callback());
  },
});

// Newer features talk over "terra:" messages through this small bridge. Only
// those channels pass; the main process still checks every message comes
// from this UI.
const allowed = (channel: unknown): channel is string =>
  typeof channel === 'string' && channel.startsWith('terra:');

contextBridge.exposeInMainWorld('terra', {
  send: (channel: string, ...args: unknown[]) => {
    if (allowed(channel)) ipcRenderer.send(channel, ...args);
  },
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    allowed(channel)
      ? ipcRenderer.invoke(channel, ...args)
      : Promise.reject(new Error(`Blocked channel ${channel}`)),
  on: (channel: string, callback: (payload: unknown) => void) => {
    if (allowed(channel)) {
      ipcRenderer.on(channel, (_event, payload: unknown) => callback(payload));
    }
  },
  /** Where a file dropped on the window is on disk. */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
});
