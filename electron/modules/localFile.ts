import { join } from "path";
import { createReadStream, stat, promises } from "fs";
import { createHash } from 'crypto';

async function scanFolder(folder: string): Promise<IPSWFile[]> {
  let entries: string[];
  try {
    entries = await promises.readdir(folder);
  } catch {
    return [];
  }

  const ipswEntries = entries.filter(f => f.endsWith(".ipsw"));

  const files = await Promise.all(
    ipswEntries.map(async (f) => {
      const filePath = join(folder, f);
      try {
        const { size } = await promises.stat(filePath);
        return { name: f, path: filePath, size };
      } catch {
        return null;
      }
    })
  );

  return files.filter((f): f is IPSWFile => f !== null);
}

async function createMd5(
  filePath: string,
  options?: Md5Options
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');

    // Tăng buffer size cho file lớn (mặc định 64KB -> 1MB)
    const highWaterMark = options?.highWaterMark || 1024 * 1024; // 1MB
    const throttleMs = options?.throttleMs || 500; // Update mỗi 500ms

    const stream = createReadStream(filePath, {
      highWaterMark,
      autoClose: true
    });

    let totalBytes = 0;
    let bytesRead = 0;
    let lastTime = Date.now();
    let lastBytesRead = 0;
    let lastProgressUpdate = 0;

    // Lấy kích thước file trước khi bắt đầu stream
    stat(filePath, (err, stats) => {
      if (err) {
        reject(err);
        return;
      }
      totalBytes = stats.size;
    });

    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk);
      bytesRead += chunk.length;

      // Throttle progress updates để tránh gọi quá nhiều
      if (options?.onProgress && totalBytes > 0) {
        const now = Date.now();

        if (now - lastProgressUpdate >= throttleMs) {
          const timeDiff = (now - lastTime) / 1000; // giây
          const bytesDiff = bytesRead - lastBytesRead;

          const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
          const percent = (bytesRead / totalBytes) * 100;

          // Tính ETA (Estimated Time of Arrival)
          const remainingBytes = totalBytes - bytesRead;
          const eta = speed > 0 ? Math.round(remainingBytes / speed) : 0;

          options.onProgress({
            percent: Math.round(Math.min(percent, 100)),
            speed: Math.round(speed),
            totalBytes,
            bytesRead,
            eta
          });

          lastTime = now;
          lastBytesRead = bytesRead;
          lastProgressUpdate = now;
        }
      }
    });

    stream.on('end', () => {
      // Gọi progress callback lần cuối với 100%
      if (options?.onProgress && totalBytes > 0) {
        options.onProgress({
          percent: 100,
          speed: 0,
          totalBytes,
          bytesRead: totalBytes,
          eta: 0
        });
      }

      const md5 = hash.digest('hex');
      resolve(md5);
    });

    stream.on('error', (err) => {
      // Đảm bảo stream được đóng khi có lỗi
      stream.destroy();
      reject(err);
    });
  });
}

async function deleteFile(filePath: string): Promise<{
  success: boolean;
  error?: string;
  code?: string;
}> {
  try {
    await promises.unlink(filePath);
    return { success: true };
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return { success: true };
    }

    return {
      success: false,
      error: err.message,
      code: err.code,
    };
  }
}

export {
  scanFolder,
  createMd5,
  deleteFile
};
