"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectFolder = selectFolder;
exports.selectFile = selectFile;
exports.setWin = setWin;
exports.sendMessage = sendMessage;
const electron_1 = require("electron");
async function selectFolder() {
    const { canceled, filePaths } = await electron_1.dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory']
    });
    return canceled ? null : filePaths[0] ?? null;
}
async function selectFile(options) {
    const dialogOptions = {
        properties: ['openFile'],
        ...options,
    };
    if (!dialogOptions.properties?.includes('openFile')) {
        dialogOptions.properties = ['openFile', ...(dialogOptions.properties ?? [])];
    }
    const { canceled, filePaths } = await electron_1.dialog.showOpenDialog(dialogOptions);
    return canceled ? null : filePaths[0] ?? null;
}
let win = null;
function setWin(window) {
    win = window;
}
function sendMessage(message, options = { type: 'success' }) {
    if (!win)
        return;
    win.webContents.send('message', message, options);
}
