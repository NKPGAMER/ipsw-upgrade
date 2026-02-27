"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDir = void 0;
exports.write = write;
exports.read = read;
exports.deleteFile = deleteFile;
const electron_1 = require("electron");
const fs_1 = require("fs");
const path_1 = require("path");
const dataDir = (0, path_1.join)(electron_1.app.getPath("userData"));
fs_1.promises.mkdir(dataDir, { recursive: true });
const ensureExt = (fileName, ext = ".json") => (0, path_1.extname)(fileName) ? fileName : fileName + ext;
const resolvePath = (fileName) => (0, path_1.join)(dataDir, ensureExt(fileName));
const ensureDir = (filePath) => fs_1.promises.mkdir((0, path_1.dirname)(filePath), { recursive: true });
exports.ensureDir = ensureDir;
async function write(fileName, data) {
    try {
        const filePath = resolvePath(fileName);
        ensureDir(filePath);
        await fs_1.promises.writeFile(filePath, typeof data !== 'string' ? JSON.stringify(data, null, 2) : data, "utf-8");
        return true;
    }
    catch {
        return false;
    }
}
async function read(fileName) {
    const filePath = resolvePath(fileName);
    if (!(0, fs_1.existsSync)(filePath))
        return null;
    return fs_1.promises.readFile(filePath, "utf-8");
}
function deleteFile(fileName) {
    const filePath = resolvePath(fileName);
    if ((0, fs_1.existsSync)(filePath)) {
        fs_1.promises.unlink(filePath);
    }
    return true;
}
