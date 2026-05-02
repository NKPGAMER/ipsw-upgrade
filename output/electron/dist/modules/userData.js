"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.write = write;
exports.read = read;
exports.deleteFile = deleteFile;
const electron_1 = require("electron");
const fs_1 = require("fs");
const path_1 = require("path");
const fs_extra_1 = __importDefault(require("fs-extra"));
const dataDir = (0, path_1.join)(electron_1.app.getPath("userData"));
void fs_extra_1.default.ensureDir(dataDir);
const ensureExt = (fileName, ext = ".json") => (0, path_1.extname)(fileName) ? fileName : fileName + ext;
const resolvePath = (fileName) => (0, path_1.join)(dataDir, ensureExt(fileName));
async function write(fileName, data) {
    const filePath = resolvePath(fileName);
    await fs_extra_1.default.ensureDir((0, path_1.dirname)(filePath));
    await fs_1.promises.writeFile(filePath, typeof data !== "string" ? JSON.stringify(data, null, 2) : data, "utf-8");
}
async function read(fileName) {
    const filePath = resolvePath(fileName);
    if (!(await fs_extra_1.default.pathExists(filePath)))
        return null;
    return fs_1.promises.readFile(filePath, "utf-8");
}
async function deleteFile(fileName) {
    const filePath = resolvePath(fileName);
    if (await fs_extra_1.default.pathExists(filePath)) {
        await fs_1.promises.unlink(filePath);
    }
}
