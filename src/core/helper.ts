import { state } from "../data";

export function getFileNameFromUrl(url: Firmware["url"]): string {
  return url.split("/").pop() ?? url;
}

export async function getFilesFromId(identifier: Device["identifier"]): IPSWFile[] {
  const allFiles = window.api.getFiles(state.currentFolder)
}