import { BrowserWindow } from "electron";

class utils {
    private mainWindow?: BrowserWindow
    constructor() {}

    sendMessage(message: string) {
        this.mainWindow?.webContents.send('ui-message', message)
    }

    sendErrorMessage(message: string) {
        this.mainWindow?.webContents.send('ui-error-message', message)
    }
}

export default new utils();