import { HashType } from "../../i10r-addon";
import { startHash, cancelNativeHash, type HashOp } from "./native-ops";

export type HashAlgo = "md5" | "sha1" | "sha256";

function algoToHashType(algo: HashAlgo): HashType {
  switch (algo) {
    case "md5": return HashType.Md5;
    case "sha1": return HashType.Sha1;
    case "sha256": return HashType.Sha256;
  }
}

export class IntegrityChecker {
  private activeOps = new Map<string, HashOp>();

  async verify(
    filePath: string,
    algo: HashAlgo,
    expected: string,
    onProgress?: (info: { pct: number; speed: number; eta: number }) => void,
  ): Promise<{ ok: boolean; algo: HashAlgo; expected: string; actual: string }> {
    const op = startHash(filePath, algoToHashType(algo), onProgress);
    this.activeOps.set(op.id, op);

    const actual = await op.promise;
    this.activeOps.delete(op.id);

    return {
      ok: actual.toLowerCase() === expected.toLowerCase(),
      algo,
      expected: expected.toLowerCase(),
      actual: actual.toLowerCase(),
    };
  }

  cancel(id: string): void {
    const op = this.activeOps.get(id);
    if (op) {
      cancelNativeHash(op.id);
      this.activeOps.delete(id);
    }
  }
}
