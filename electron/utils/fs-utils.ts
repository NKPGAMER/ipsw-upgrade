import fe from "fs-extra";
import path from "path";

export function isRoot(p: string): boolean {
    const resolve = path.resolve(p);
    const parsed = path.parse(resolve);

    return resolve === parsed.root;
}

export async function ensureDir(p: string): Promise<void> {
    const dir = path.dirname(p);

    if (!isRoot(dir)) {
        await fe.ensureDir(dir);
    }
};