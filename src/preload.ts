import { contextBridge, ipcRenderer } from 'electron';
import type { BrowserState, Settings, TabsState } from './shared';

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

  setSettingsOpen: (open: boolean) =>
    ipcRenderer.send('browser:set-settings-open', open),
  updateSettings: (changes: Partial<Settings>) =>
    ipcRenderer.send('browser:update-settings', changes),
  clearBrowsingData: (): Promise<boolean> =>
    ipcRenderer.invoke('browser:clear-data'),

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
  onFocusAddress: (callback: () => void) => {
    ipcRenderer.on('browser:focus-address', () => callback());
  },
});
