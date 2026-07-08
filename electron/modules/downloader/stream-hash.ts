import crypto from "crypto";

type HashAlgo = "md5" | "sha1" | "sha256";

export class StreamHasher {
  private hash: crypto.Hash;
  private algo: HashAlgo;
  private bytesHashed = 0;

  constructor(algo: HashAlgo) {
    this.algo = algo;
    this.hash = crypto.createHash(algo);
  }

  update(data: Buffer): void {
    this.hash.update(data);
    this.bytesHashed += data.length;
  }

  finalize(): string {
    return this.hash.digest("hex");
  }

  getBytesHashed(): number {
    return this.bytesHashed;
  }

  getAlgo(): HashAlgo {
    return this.algo;
  }
}
