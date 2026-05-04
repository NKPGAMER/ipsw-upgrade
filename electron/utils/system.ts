import { dialog, type OpenDialogOptions } from 'electron';

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
