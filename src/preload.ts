
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('browser', {
  navigate: (url: string) =>
    ipcRenderer.send('browser:navigate', url),

  back: () =>
    ipcRenderer.send('browser:back'),

  forward: () =>
    ipcRenderer.send('browser:forward'),

  reload: () =>
    ipcRenderer.send('browser:reload'),

  onUrlChanged: (callback: (url: string) => void) => {
    ipcRenderer.on('browser:url-changed', (_event, url) => {
      callback(url);
    });
  },
});
