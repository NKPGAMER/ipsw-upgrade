import { contextBridge, ipcRenderer } from 'electron';

const splashAPI = {
  onReady: (cb: () => void) => {
    ipcRenderer.on('splash:ready', () => cb());
  },
  done: () => {
    ipcRenderer.send('splash:animation-done');
  }
};

contextBridge.exposeInMainWorld('splashAPI', splashAPI);
