import { app } from "electron";
import fe from "fs-extra";
import { join, extname, dirname } from "path";

class UserData {
  private readonly rootDir: string;

  constructor(root: string = "") {
    this.rootDir = join(app.getPath("userData"), root);
  }

  private ensureExt = (fileName: string, ext: string = ".json") =>
    extname(fileName) ? fileName : fileName + ext;

  private resolvePath = (fileName: string) =>
    join(this.rootDir, this.ensureExt(fileName));

  public async read<T = unknown>(fileName: string, timeout?: number): Promise<T | null> {
    const filePath = this.resolvePath(fileName);

    const readPromise = fe.readFile(filePath, "utf-8")
      .then((raw) => JSON.parse(raw) as T)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") {
          console.error(`[UserData] read failed for "${fileName}":`, error);
        }
        return null;
      });

    if (timeout == null || timeout <= 0) return readPromise;

    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), timeout);
    });

    return Promise.race([readPromise, timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
    });
  }

  public async write<T>(fileName: string, value: T): Promise<void> {
    const filePath = this.resolvePath(fileName);

    await fe.ensureDir(dirname(filePath));
    await fe.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
  }

  public async delete(fileName: string): Promise<void> {
    const filePath = this.resolvePath(fileName);

    try {
      await fe.unlink(filePath);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export { UserData };
export default new UserData();