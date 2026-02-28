export default {
    main: {
        selectProduct: document.getElementById('main:selectProduct')
    },
    topbar: {
        main: document.getElementById('topbar'),
        slectProduct: document.getElementById('topbar:selectModel'),
        upgrade: document.getElementById('app.update.available'),
        upgradeAllFirmware: document.getElementById('upgradeAllFirmware'),
        refresh: document.getElementById('refreshBtn'),
        settings: document.getElementById('settingsBtn')
    },
    overlay: {
        main: document.getElementById('main:selectModel'),
        loadingText: document.getElementById('loadingText'),
        deviceGrid: document.getElementById('deviceGrid'),
        title: document.getElementById('overlayTitle'),
        closeBtn: document.getElementById('closeOverlay'),
        deleteAllFirmware: document.getElementById('deleteAllFirmware'),
        updateAllFirmware: document.getElementById('ipsw-upgrade')
    },
    settings: {
        page: document.getElementById('settingsPage'),
        closeBtn: document.getElementById('closeSettings'),
        about: {
            version: document.getElementById('version'),
            checkUpdate: document.getElementById('checkUpdate')
        },
        download: {
            selectPath: document.getElementById('selectPathBtn'),
            currentPath: document.getElementById('currentPath'),
            useIDM: document.getElementById('useIDM'),
            idmSelectPath: document.getElementById('idmSelectPath'),
            idmCurrentPath: document.getElementById('idm-currentPath')
        },
        file: {
            removeOldFiles: document.getElementById('autoRemoveOldFiles'),
            removeDuplicateFiles: document.getElementById('autoRemoveDuplicateFiles')
        }
    },
    downloads: {
        page: document.getElementById('downloadPage'),
        closeBtn: document.getElementById('closeDownloads'),
        list: document.getElementById('downloadList'),
        btn: document.getElementById('downloadsBtn'),
        emptyDownloads: document.getElementById('emptyDownloads')
    },
    updater: {
        page: document.getElementById('updatePage'),
        version: document.getElementById('update-version'),
        changelog: document.getElementById('changelog-list'),
        process: {
            label: document.getElementById('progressText'),
            percent: document.getElementById('progressPercent'),
            fill: document.getElementById('progressFill')
        },
        download: document.getElementById('update-download'),
        status: document.getElementById('statusText')
    },
    stats: {
        downloadedCount: document.getElementById('downloadedCount'),
        storageUsed: document.getElementById('storageUsed'),
        freeSpace: document.getElementById('freeSpace')
    },
    globalSearch: {
        input: document.getElementById('globalSearchInput'),
        clear: document.getElementById('globalSearchClear'),
        overlay: document.getElementById('globalSearchOverlay'),
        results: document.getElementById('globalSearchResults'),
        title: document.getElementById('globalSearchTitle'),
        closeBtn: document.getElementById('closeGlobalSearch')
    }
};
