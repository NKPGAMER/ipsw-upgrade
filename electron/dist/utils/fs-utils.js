"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRoot = isRoot;
exports.ensureDir = ensureDir;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
function isRoot(p) {
    const resolve = path_1.default.resolve(p);
    const parsed = path_1.default.parse(resolve);
    return resolve === parsed.root;
}
async function ensureDir(p) {
    const dir = path_1.default.dirname(p);
    if (!isRoot(dir)) {
        await fs_extra_1.default.ensureDir(dir);
    }
}
;
