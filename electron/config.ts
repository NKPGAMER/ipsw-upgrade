import { app } from "electron"

export default {
    defaultAppSettings: {
        autoRemoveOldFiles: true,
        autoRemoveDuplicateFiles: true,
        language: 'vi',
        ipswFolder: app.getPath('downloads')
    },
    
    appleVendorId: 1452
}