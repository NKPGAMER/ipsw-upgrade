export function getFileNameFromUrl(url: Firmware["url"]): string {
  return url.split("/").pop() ?? url;
}

export function getFilesFromId(identifier: Device["identifier"]) {
  
}