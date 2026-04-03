"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTempDir = exports.getDriveLetter = exports.getDriveType = exports.checkRangeSupport = exports.manager = exports.registerDownloadManagerIPC = exports.DownloadManager = void 0;
var DownloadManager_1 = require("./DownloadManager");
Object.defineProperty(exports, "DownloadManager", { enumerable: true, get: function () { return DownloadManager_1.DownloadManager; } });
var ipcBridge_1 = require("./ipcBridge");
Object.defineProperty(exports, "registerDownloadManagerIPC", { enumerable: true, get: function () { return ipcBridge_1.registerDownloadManagerIPC; } });
Object.defineProperty(exports, "manager", { enumerable: true, get: function () { return ipcBridge_1.manager; } });
__exportStar(require("./types"), exports);
__exportStar(require("./useDownloadManager"), exports);
var httpClient_1 = require("./httpClient");
Object.defineProperty(exports, "checkRangeSupport", { enumerable: true, get: function () { return httpClient_1.checkRangeSupport; } });
var driveDetect_1 = require("./driveDetect");
Object.defineProperty(exports, "getDriveType", { enumerable: true, get: function () { return driveDetect_1.getDriveType; } });
Object.defineProperty(exports, "getDriveLetter", { enumerable: true, get: function () { return driveDetect_1.getDriveLetter; } });
Object.defineProperty(exports, "resolveTempDir", { enumerable: true, get: function () { return driveDetect_1.resolveTempDir; } });
