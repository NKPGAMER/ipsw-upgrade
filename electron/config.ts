import { app } from "electron"

export default {
    defaultAppSettings: {
        autoRemoveOldFiles: true,
        autoRemoveDuplicateFiles: true,
        language: 'vi',
        ipswFolder: app.getPath('downloads')
    },

    DataVersion: "2.2.0",
    
    appleVendorId: 1452
}