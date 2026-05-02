"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
exports.default = {
    defaultAppSettings: {
        autoRemoveOldFiles: true,
        autoRemoveDuplicateFiles: true,
        language: 'vi',
        ipswFolder: electron_1.app.whenReady().then(() => electron_1.app.getPath('downloads')),
        skipVerify: false,
        hardLink: false
    },
    DataVersion: "2.2.0",
    appleVendorId: 1452
};
