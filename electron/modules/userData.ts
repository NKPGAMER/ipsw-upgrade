import { app } from "electron";
import { promises as fs, existsSync } from "fs";
import { join, extname, dirname, parse } from "path";

const dataDir = join(app.getPath("userData"));

fs.mkdir(dataDir, { recursive: true });

const ensureExt = (fileName: string, ext: string = ".json") => extname(fileName) ? fileName : fileName + ext;
const resolvePath = (fileName: string) => join(dataDir, ensureExt(fileName));
const ensureDir = async (filePath: string) => {
	const dir = dirname(filePath);
	const root = parse(dir).root;

	if (dir === root) {
		return;
	}

	await fs.mkdir(dir, { recursive: true });
};

async function write(fileName: string, data: any): Promise<void> {
	const filePath = resolvePath(fileName);
	await ensureDir(filePath);
	await fs.writeFile(filePath, typeof data !== 'string' ? JSON.stringify(data, null, 2) : data, "utf-8");
}

async function read(fileName: string): Promise<string | null> {
	const filePath = resolvePath(fileName);
	if (!existsSync(filePath)) return null;

	return fs.readFile(filePath, "utf-8");
}

async function deleteFile(fileName: string): Promise<void> {
	const filePath = resolvePath(fileName);
	if (existsSync(filePath)) {
		await fs.unlink(filePath);
	}
}

export { write, read, deleteFile, ensureDir };