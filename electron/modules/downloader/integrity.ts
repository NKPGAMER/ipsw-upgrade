import * as fs from "fs";
import * as crypto from "crypto";

type HashAlgo = "sha256" | "sha1" | "md5";

export class IntegrityChecker {
  /**
   * Compute hash of a file using streaming (memory-efficient for large files)
   */
  async computeHash(filePath: string, algo: HashAlgo): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algo);
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 * 1024 }); // 64MB chunks
      stream.on("data", chunk => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  /**
   * Verify firmware integrity — tries md5 → sha1 → sha256 in order
   */
  async verify(
    filePath: string,
    firmware: Firmware,
    onProgress?: (info: { pct: number; speed: number; eta?: number }) => void,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; algo: HashAlgo | null; expected: string; actual: string }> {
    const checks: { algo: HashAlgo; expected: string }[] = [];

    // Priority: md5 (fastest for large files) → sha1 → sha256
    if (firmware.md5sum) checks.push({ algo: "md5", expected: firmware.md5sum });
    if (firmware.sha1sum) checks.push({ algo: "sha1", expected: firmware.sha1sum });
    if (firmware.sha256sum) checks.push({ algo: "sha256", expected: firmware.sha256sum });

    if (checks.length === 0) {
      return { ok: true, algo: null, expected: "", actual: "" };
    }

    // Use best available hash
    const { algo, expected } = checks[0];

    const fileSize = (() => { try { return fs.statSync(filePath).size; } catch { return 0; } })();

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let processed = 0;
      const startedAt = Date.now();

      try {
        const actual = await new Promise<string>((resolve, reject) => {
          if (signal?.aborted) return reject(new Error("ABORTED"));

          const hash = crypto.createHash(algo);
          const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 * 1024 });

          const onAbort = () => {
            stream.destroy();
            reject(new Error("ABORTED"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });

          const cleanup = () => signal?.removeEventListener("abort", onAbort);

          stream.on("data", (chunk: string | Buffer) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            hash.update(buf);
            processed += buf.length;
            if (onProgress && fileSize > 0) {
              const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 0.001);
              const speed = processed / elapsedSec;
              const eta = speed > 0 ? Math.round((fileSize - processed) / speed) : undefined;
              onProgress({ pct: Math.floor((processed / fileSize) * 100), speed, eta });
            }
          });

          stream.on("end", () => { cleanup(); resolve(hash.digest("hex")); });
          stream.on("error", (err) => { cleanup(); reject(err); });
        });

        return {
          ok: actual.toLowerCase() === expected.toLowerCase(),
          algo,
          expected: expected.toLowerCase(),
          actual: actual.toLowerCase(),
        };
      } catch (err: any) {
        if (err.message === "ABORTED") throw err;
        lastError = err;
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }

    throw lastError ?? new Error("Hash verification failed after retries");
  }
}
