import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';

export async function selectFolder(): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  });

  return canceled ? null : filePaths[0] ?? null;
}

export async function selectFile(options?: OpenDialogOptions): Promise<string | null> {
  const dialogOptions: OpenDialogOptions = {
    properties: ['openFile'],
    ...options,
  };

  if (!dialogOptions.properties?.includes('openFile')) {
    dialogOptions.properties = ['openFile', ...(dialogOptions.properties ?? [])];
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(dialogOptions);
  return canceled ? null : filePaths[0] ?? null;
}

let win: BrowserWindow | null = null;

export function setWin(window: BrowserWindow) {
  win = window;
}

export function sendMessage(message: string, options: { type: 'success' | 'error' | 'warning' | 'info' } = { type: 'success' }) {
  if (!win) {
    console.warn("[system] sendMessage dropped — no window:", message);
    return;
  }

  win.webContents.send('message', message, options);
}