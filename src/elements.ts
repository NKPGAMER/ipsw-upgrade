export default {
    main: {
        selectProduct: document.getElementById('main:selectProduct') as HTMLDivElement
    },
    topbar: {
        main: document.getElementById('topbar') as HTMLDivElement,
        slectProduct: document.getElementById('topbar:selectModel') as HTMLDivElement,
        upgrade: document.getElementById('app.update.available') as HTMLButtonElement | undefined,
        upgradeAllFirmware: document.getElementById('upgradeAllFirmware') as HTMLButtonElement,
        refresh: document.getElementById('refreshBtn') as HTMLButtonElement,
        settings: document.getElementById('settingsBtn') as HTMLButtonElement
    },
    overlay: {
        main: document.getElementById('main:selectModel') as HTMLDivElement,
        loadingText: document.getElementById('loadingText') as HTMLDivElement,
        deviceGrid: document.getElementById('deviceGrid') as HTMLDivElement,
        title: document.getElementById('overlayTitle') as HTMLDivElement,
        closeBtn: document.getElementById('closeOverlay') as HTMLButtonElement,
        deleteAllFirmware: document.getElementById('deleteAllFirmware') as HTMLButtonElement,
        updateAllFirmware: document.getElementById('ipsw-upgrade') as HTMLButtonElement
    },
    settings: {
        page: document.getElementById('settingsPage') as HTMLDivElement,
        closeBtn: document.getElementById('closeSettings') as HTMLButtonElement,
        about: {
            version: document.getElementById('version') as HTMLDivElement,
        },
        download: {
            selectPath: document.getElementById('selectPathBtn') as HTMLButtonElement,
            currentPath: document.getElementById('currentPath') as HTMLDivElement,
            useIDM: document.getElementById('useIDM') as HTMLDivElement,
            idmSelectPath: document.getElementById('idmSelectPath') as HTMLButtonElement,
            idmCurrentPath: document.getElementById('idm-currentPath') as HTMLSpanElement
        },
        file: {
            removeOldFiles: document.getElementById('autoRemoveOldFiles') as HTMLDivElement,
            removeDuplicateFiles: document.getElementById('autoRemoveDuplicateFiles') as HTMLDivElement
        }
    },
    downloads: {
        page: document.getElementById('downloadPage') as HTMLDivElement,
        closeBtn: document.getElementById('closeDownloads') as HTMLButtonElement,
        list: document.getElementById('downloadList') as HTMLDivElement,
        btn: document.getElementById('downloadsBtn') as HTMLButtonElement,
        emptyDownloads: document.getElementById('emptyDownloads') as HTMLDivElement
    },
    updater: {
        page: document.getElementById('updatePage') as HTMLDivElement,
        version: document.getElementById('update-version') as HTMLSpanElement,
        changelog: document.getElementById('changelog-list') as HTMLUListElement,
        process: {
            label: document.getElementById('progressText') as HTMLSpanElement,
            percent: document.getElementById('progressPercent') as HTMLSpanElement,
            fill: document.getElementById('progressFill') as HTMLDivElement
        },
        download: document.getElementById('update-download') as HTMLButtonElement,
        status: document.getElementById('statusText') as HTMLDivElement
    },
    stats: {
        downloadedCount: document.getElementById('downloadedCount') as HTMLSpanElement,
        storageUsed: document.getElementById('storageUsed') as HTMLSpanElement,
        freeSpace: document.getElementById('freeSpace') as HTMLSpanElement
    },
    globalSearch: {
        input: document.getElementById('globalSearchInput') as HTMLInputElement,
        clear: document.getElementById('globalSearchClear') as HTMLButtonElement,
        overlay: document.getElementById('globalSearchOverlay') as HTMLDivElement,
        results: document.getElementById('globalSearchResults') as HTMLDivElement,
        title: document.getElementById('globalSearchTitle') as HTMLDivElement,
        closeBtn: document.getElementById('closeGlobalSearch') as HTMLButtonElement
    }
};