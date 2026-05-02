"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class utils {
    mainWindow;
    constructor() { }
    sendMessage(message) {
        this.mainWindow?.webContents.send('ui-message', message);
    }
    sendErrorMessage(message) {
        this.mainWindow?.webContents.send('ui-error-message', message);
    }
}
exports.default = new utils();
