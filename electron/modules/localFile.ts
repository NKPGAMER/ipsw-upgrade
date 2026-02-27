import { join } from "path";
import { readdirSync, statSync, createReadStream, stat } from "fs";
import { createHash } from 'crypto';


function scanFolder(folder: string): IPSWFile[] {
  const files = readdirSync(folder)
    .filter(f => f.endsWith(".ipsw"))
    .map(f => ({
      name: f,
      path: join(folder, f),
      sizeMB: Math.round(statSync(join(folder, f)).size / 1e6),
      size: statSync(join(folder, f)).size
    }));

  return files;
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

export { 
  scanFolder,
  createMd5
};