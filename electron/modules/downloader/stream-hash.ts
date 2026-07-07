import crypto from "crypto";

export type HashAlgo = "md5" | "sha1" | "sha256";

/**
 * Incremental hash wrapper using Node.js crypto.
 * Feeds data during download (via flushBuffers in ChunkManager),
 * then finalizes to compare against expected checksum.
 */
export class StreamHasher {
  private hash: crypto.Hash;
  private algo: HashAlgo;
  private bytesHashed = 0;
  private finalized = false;

  constructor(algo: HashAlgo) {
    this.algo = algo;
    this.hash = crypto.createHash(algo);
  }

  /** Feed data into the hasher (called from flushBuffers in ChunkManager). */
  update(data: Buffer): void {
    if (this.finalized) return;
    this.hash.update(data);
    this.bytesHashed += data.length;
  }

  /** Finalize and return hex digest. Can only be called once. */
  finalize(): string {
    if (this.finalized) return "";
    this.finalized = true;
    return this.hash.digest("hex");
  }

  getBytesHashed(): number {
    return this.bytesHashed;
  }

  getAlgo(): HashAlgo {
    return this.algo;
  }

  isFinalized(): boolean {
    return this.finalized;
  }
}
