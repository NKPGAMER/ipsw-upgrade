"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
exports.default = {
    defaultAppSettings: {
        autoRemoveOldFiles: true,
        autoRemoveDuplicateFiles: true,
        language: 'vi',
        ipswFolder: electron_1.app.getPath('downloads')
    },
    isDev: !electron_1.app.isPackaged,
    appleVendorId: 1452
};
