import { nativeBridge } from "./native-bridge";

type HashAlgo = "sha256" | "sha1" | "md5";

export class IntegrityChecker {
  /**
   * Compute hash of a file using the native Rust hasher — streams the file
   * on the native side instead of through Node's crypto + fs.createReadStream,
   * avoiding JS event-loop/GC overhead for large (multi-GB) IPSW files.
   */
  async computeHash(filePath: string, algo: HashAlgo): Promise<string> {
    const result = await nativeBridge.hash(filePath, { sum: algo, value: "" });
    if (result.error) throw new Error(result.error);
    return result.computed;
  }

  /**
   * Verify firmware integrity — tries md5 → sha1 → sha256 in order.
   * The native hasher both computes and matches the hash in one pass
   * (result.matched), so we no longer compare strings on the JS side.
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

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new Error("ABORTED");

      // Speed/ETA smoothing for verify progress
      const VERIFY_ALPHA = 0.15;
      let smoothedSpeed = 0;
      let smoothedEta = 0;

      try {
        const result = await nativeBridge.hash(
          filePath,
          { sum: algo, value: expected },
          (p) => {
            if (!onProgress) return;

            const rawSpeed = p.speedBps;
            const rawEta = p.etaSeconds >= 0 ? p.etaSeconds : 0;

            // EMA smooth speed
            smoothedSpeed = smoothedSpeed === 0
              ? rawSpeed
              : smoothedSpeed * (1 - VERIFY_ALPHA) + rawSpeed * VERIFY_ALPHA;

            // EMA smooth ETA
            smoothedEta = smoothedEta === 0
              ? rawEta
              : smoothedEta * (1 - VERIFY_ALPHA) + rawEta * VERIFY_ALPHA;

            onProgress({
              pct: Math.floor(p.percent),
              speed: Math.round(smoothedSpeed),
              eta: Math.max(0, Math.round(smoothedEta)),
            });
          },
          signal,
        );

        if (result.error) throw new Error(result.error);

        return {
          ok: result.matched,
          algo,
          expected: expected.toLowerCase(),
          actual: result.computed.toLowerCase(),
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
