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
   * Verify firmware integrity — tries sha256 → sha1 → md5 in order
   */
  async verify(
    filePath: string,
    firmware: Firmware,
    onProgress?: (info: { pct: number; speed: number; eta?: number }) => void
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

    const fileSize = fs.statSync(filePath).size;
    let processed = 0;
    const startedAt = Date.now();

    const actual = await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash(algo);
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 * 1024 });

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

      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });

    return {
      ok: actual.toLowerCase() === expected.toLowerCase(),
      algo,
      expected: expected.toLowerCase(),
      actual: actual.toLowerCase(),
    };
  }
}
