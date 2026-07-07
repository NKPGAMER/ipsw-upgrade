import * as path from "path";

/** Extract the drive root key from a file path (e.g. "C:\\" on Windows, "/" on Unix). */
export function driveKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (process.platform === "win32") return path.parse(resolved).root.toUpperCase();
  const parts = resolved.split(path.sep).filter(Boolean);
  return path.sep + (parts[0] ?? "");
}
