import { getDevices, getProductType, loadDevices, loadModelData } from "./dataHandle.js";
import firmwareManager from "./upgradeDevices.js";
import downloadFirmware from "./core/downloadFirmware.js";
import elements from "./elements.js";
import utils from "./core/utils.js";
import { t, changeLanguage } from './language.js';
import { data, state } from "./data.js";
const loadedCards = new Set();
const activeDownloads = new Map();
// Cache for device data to avoid redundant API calls
const deviceDataCache = new Map();
const observerOptions = {
    root: null,
    rootMargin: '100px',
    threshold: 0.01
};
let cardObserver;
// Debounce helper
const debounce = (fn, ms) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), ms);
    };
};
const UI = {
    download: {
        show: () => elements.downloads.page.classList.add('active'),
        close: () => elements.downloads.page.classList.remove('active')
    },
    setting: {
        show: () => elements.settings.page.classList.add('active'),
        close: () => elements.settings.page.classList.remove('active')
    },
    globalSearch: {
        show: () => elements.globalSearch.overlay.classList.add('active'),
        close: () => elements.globalSearch.overlay.classList.remove('active')
    }
};
const main = new class {
    constructor() {
        this.selectProduct = document.getElementById('main:selectProduct');
        this.modelDetailContainer = document.getElementById('main:modelDetailContainer');
        this.selectModel = document.getElementById('main:selectModel');
        this.detail = document.getElementById('main:detail');
        this.resizeDivider = document.getElementById('resizeDivider');
        this.resizeOverlay = document.getElementById('resizeOverlay');
        this.isResizing = false;
        this.containerWidth = 0;
        this.savedLeftWidth = 60;
        this.savedRightWidth = 40;
        this.initResizer();
    }
    initResizer() {
        if (!this.resizeDivider || !this.modelDetailContainer || !this.selectModel || !this.detail)
            return;
        const divider = this.resizeDivider;
        const container = this.modelDetailContainer;
        const leftPanel = this.selectModel;
        const rightPanel = this.detail;
        const overlay = this.resizeOverlay;
        const startResize = (e) => {
            this.isResizing = true;
            this.containerWidth = container.offsetWidth;
            leftPanel.style.transition = 'none';
            rightPanel.style.transition = 'none';
            divider.style.transition = 'none';
            if (overlay) {
                overlay.classList.remove('hidden');
            }
            else {
                leftPanel.style.opacity = '0.5';
                rightPanel.style.opacity = '0.5';
            }
            leftPanel.style.pointerEvents = 'none';
            rightPanel.style.pointerEvents = 'none';
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        };
        const resize = (e) => {
            if (!this.isResizing)
                return;
            const containerRect = container.getBoundingClientRect();
            const mouseX = e.clientX - containerRect.left;
            const leftPercentage = (mouseX / this.containerWidth) * 100;
            const clampedLeft = Math.max(20, Math.min(80, leftPercentage));
            const clampedRight = 100 - clampedLeft;
            this.savedLeftWidth = clampedLeft;
            this.savedRightWidth = clampedRight;
            leftPanel.style.width = `${clampedLeft}%`;
            rightPanel.style.width = `${clampedRight}%`;
            divider.style.left = `${clampedLeft}%`;
        };
        const stopResize = () => {
            if (!this.isResizing)
                return;
            this.isResizing = false;
            leftPanel.style.transition = '';
            rightPanel.style.transition = '';
            divider.style.transition = '';
            if (overlay) {
                overlay.classList.add('hidden');
            }
            else {
                leftPanel.style.opacity = '';
                rightPanel.style.opacity = '';
            }
            leftPanel.style.pointerEvents = '';
            rightPanel.style.pointerEvents = '';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        divider.addEventListener('mousedown', startResize);
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);
    }
    showSelectProduct() {
        this.modelDetailContainer?.classList.add('hidden');
        this.selectProduct?.classList.remove('hidden');
        topbar.showMain();
    }
    showSelectModel() {
        this.selectProduct?.classList.add('hidden');
        this.modelDetailContainer?.classList.remove('hidden');
        if (this.selectModel && this.detail && this.resizeDivider) {
            this.selectModel.style.width = '100%';
            this.detail.style.width = '0%';
            this.detail.classList.add('opacity-0', 'pointer-events-none');
            this.resizeDivider.classList.add('hidden');
        }
        topbar.showSelectModel();
    }
    showDetail(device) {
        this.selectProduct?.classList.add('hidden');
        this.modelDetailContainer?.classList.remove('hidden');
        if (this.selectModel && this.detail && this.resizeDivider) {
            this.selectModel.style.width = `${this.savedLeftWidth}%`;
            this.detail.style.width = `${this.savedRightWidth}%`;
            this.resizeDivider.style.left = `${this.savedLeftWidth}%`;
            this.detail.classList.remove('opacity-0', 'pointer-events-none');
            this.resizeDivider.classList.remove('hidden');
        }
        // Cập nhật topbar
        topbar.showDetail(device);
    }
    hideDetail() {
        if (this.selectModel && this.detail && this.resizeDivider) {
            this.selectModel.style.width = '100%';
            this.detail.style.width = '0%';
            this.detail.classList.add('opacity-0', 'pointer-events-none');
            this.resizeDivider.classList.add('hidden');
        }
    }
}();
const topbar = new class {
    constructor() {
        this.main = document.getElementById('topbar');
        this.selectModel = document.getElementById('topbar:selectModel');
        this.breadcrumb_selectModel = document.getElementById('breadcrumb_selectModel');
        this.closeBtn = document.getElementById('topbar.closeBtn');
        this.isDetailMode = false;
        this.closeBtn.addEventListener('click', () => {
            if (this.isDetailMode) {
                main.hideDetail();
                this.showSelectModelBreadcrumb();
                this.isDetailMode = false;
            }
            else {
                main.showSelectProduct();
            }
        });
    }
    showMain() {
        this.selectModel?.classList.add('hidden!');
        this.main?.classList.remove('hidden!');
        this.isDetailMode = false;
    }
    showSelectModel() {
        this.main?.classList.add('hidden!');
        this.selectModel?.classList.remove('hidden!');
        this.isDetailMode = false;
        this.showSelectModelBreadcrumb();
    }
    showSelectModelBreadcrumb() {
        // Breadcrumb cho Select Model
        this.breadcrumb_selectModel.innerHTML = '';
        const product = document.createElement('li');
        product.classList.add('breadcrumb-item');
        const productBtn = document.createElement('button');
        productBtn.onclick = () => main.showSelectProduct();
        productBtn.textContent = 'Home';
        product.appendChild(productBtn);
        const currentProduct = document.createElement('li');
        currentProduct.textContent = state.currentProduct;
        currentProduct.classList.add('breadcrumb-item', 'active');
        this.breadcrumb_selectModel.append(product, currentProduct);
    }
    showDetail(device) {
        // Không cần ẩn selectModel nữa, chỉ cần đổi breadcrumb
        this.main?.classList.add('hidden!');
        this.selectModel?.classList.remove('hidden!');
        this.isDetailMode = true;
        // Breadcrumb cho Detail
        this.breadcrumb_selectModel.innerHTML = '';
        const product = document.createElement('li');
        const productBtn = document.createElement('button');
        product.classList.add('breadcrumb-item');
        productBtn.onclick = () => main.showSelectProduct();
        productBtn.textContent = 'Home';
        product.appendChild(productBtn);
        const currentProduct = document.createElement('li');
        const currentProductBtn = document.createElement('button');
        currentProduct.classList.add('breadcrumb-item');
        currentProductBtn.onclick = () => {
            main.hideDetail();
            this.showSelectModelBreadcrumb();
        };
        currentProductBtn.textContent = state.currentProduct;
        currentProduct.appendChild(currentProductBtn);
        const currentModel = document.createElement('li');
        currentModel.classList.add('breadcrumb-item', 'active');
        currentModel.textContent = device.identifier;
        this.breadcrumb_selectModel.append(product, currentProduct, currentModel);
    }
}();
const detail = new class {
    constructor() {
        this.body = document.getElementById('detail:body');
        this.title = document.getElementById('detailTitle');
        this.maxRow = 5;
        this.latestVersion = document.getElementById('detail.latest.version');
        this.latestSize = document.getElementById('detail.latest.size');
        this.latestBuild = document.getElementById('detail.latest.build');
        this.latestRelease = document.getElementById('detail.latest.release');
        this.latestAction = document.getElementById('detail.latest.action');
    }
    async show(device, firmwares, modelFiles, status) {
        main.showDetail(device);
        await this.updateData({ device, firmwares }, modelFiles, firmwares[0], status);
        // Tối ưu xử lý related files
        if (modelFiles.length > 1) {
            if (state.autoRemoveOldFiles) {
                firmwareManager.deleteOldFilesForDevice(device.identifier);
            }
            if (state.autoRemoveDuplicateFiles) {
                firmwareManager.deleteDuplicateFilesForDevice(device.identifier);
            }
        }
    }
    async updateData(data, modelFiles, latest, status) {
        // Clear content
        this.body.innerHTML = "";
        this.latestAction.innerHTML = '';
        // Update Info
        this.updateLatestInfo(data.device, latest);
        const latestFile = modelFiles.find(m => m.name.includes(latest.buildid)) || modelFiles[0];
        // Render actions theo status
        await this.renderActions(status, data, latest, latestFile);
        // Render firmware list
        this.renderFirmwareList(data);
    }
    updateLatestInfo(device, latest) {
        this.title.textContent = device.name;
        this.latestVersion.textContent = latest.version;
        this.latestSize.textContent = utils.formatBytes(latest.filesize);
        this.latestBuild.textContent = latest.buildid;
        this.latestRelease.textContent = new Date(latest.releasedate).toLocaleDateString("vi-VN", {
            month: "short",
            day: "2-digit",
            year: "numeric"
        });
    }
    async renderActions(status, data, latest, latestFile) {
        switch (status) {
            case 'not-downloaded':
                this.renderNotDownloadedActions(data.device, latest);
                break;
            case 'uncomplete':
                await this.renderUncompleteActions(data.device, latest, latestFile);
                break;
            case 'downloaded':
                this.renderDownloadedActions(data.device, latest, latestFile);
                break;
            case 'update-available':
                this.renderUpdateAvailableActions(data.device, latest, latestFile);
                break;
            case 'unsigned':
                this.renderUnsignedActions();
                break;
        }
    }
    renderNotDownloadedActions(device, firmware) {
        const downloadBtn = this.createButton(t('button.download'), 'primary');
        downloadBtn.onclick = () => this.handleDownload(device, firmware);
        this.latestAction.appendChild(downloadBtn);
    }
    async renderUncompleteActions(device, firmware, latestFile) {
        const activeDownloads = await window.downloader.getActiveDownloads();
        const isDownloading = activeDownloads.some(a => a.url === firmware.url);
        if (isDownloading) {
            const viewBtn = this.createButton(t('state.downloading'), 'primary');
            if (!state.useIDM) {
                viewBtn.onclick = () => UI.download.show();
            }
            this.latestAction.appendChild(viewBtn);
        }
        else {
            const resumeBtn = this.createButton(t('button.resumeDownload'), 'primary');
            resumeBtn.onclick = async () => {
                utils.showSuccessMessage(t('downloader.start'));
                const { result, reason } = await downloadFirmware.download(firmware, device, { continue: true });
                if (result === 'success') {
                    UI.download.show();
                }
                else if (result === 'diskFull') {
                    utils.showErrorMessage(t('downloader.fail.diskFull').replace('$1', reason));
                }
                else {
                    utils.showErrorMessage(reason ?? 'ERROR');
                }
            };
            this.latestAction.appendChild(resumeBtn);
            // Group buttons for reload and delete
            const group = this.createButtonGroup();
            const reloadBtn = this.createButton(t('button.reDownload'), 'secondary-small');
            reloadBtn.onclick = async () => {
                if (latestFile && await utils.customConfirm(t('confirm.reDownloadFile'), {
                    variant: 'info',
                    title: t('confirm.title'),
                    confirmText: t('button.reDownload'),
                    cancelText: t("confirm.btn.cancel"),
                })) {
                    await window.api.deleteFile(latestFile.path);
                    await this.handleDownload(device, firmware);
                }
            };
            const deleteBtn = this.createButton(t('button.deleteFile'), 'secondary-small');
            deleteBtn.onclick = async () => {
                if (latestFile && await utils.customConfirm(t('confirm.deleteFile').replace('$1', latestFile.name), {
                    variant: 'warning',
                    title: t('confirm.title'),
                    confirmText: t('confirm.btn.delete'),
                    cancelText: t("confirm.btn.cancel"),
                })) {
                    await this.deleteFileAndRefresh(latestFile.path, latestFile.name);
                }
            };
            group.appendChild(reloadBtn);
            group.appendChild(deleteBtn);
            this.latestAction.appendChild(group);
        }
    }
    renderDownloadedActions(device, firmware, latestFile) {
        const deleteBtn = this.createButton(t('button.deleteFile'), 'danger');
        deleteBtn.onclick = async () => {
            if (latestFile && await utils.customConfirm(t('confirm.deleteFile').replace('$1', latestFile.name), {
                variant: 'warning',
                title: t('confirm.title'),
                confirmText: t('confirm.btn.delete'),
                cancelText: t("confirm.btn.cancel"),
            })) {
                await this.deleteFileAndRefresh(latestFile.path, latestFile.name);
            }
        };
        this.latestAction.appendChild(deleteBtn);
        const group = this.createButtonGroup();
        const reDownloadBtn = this.createButton(t('button.reDownload'), 'secondary-small');
        reDownloadBtn.onclick = async () => {
            if (latestFile) {
                utils.showSuccessMessage(t('message.deleteFile').replace('$1', latestFile.name));
                await window.api.deleteFile(latestFile.path);
                await this.handleDownload(device, firmware);
            }
        };
        const verifyBtn = this.createButton(t('button.verify'), 'secondary-small');
        verifyBtn.onclick = async () => {
            if (latestFile) {
                await this.handleVerify(verifyBtn, latestFile, firmware);
            }
        };
        group.appendChild(reDownloadBtn);
        group.appendChild(verifyBtn);
        this.latestAction.appendChild(group);
    }
    renderUpdateAvailableActions(device, firmware, latestFile) {
        const updateBtn = this.createButton(t('button.update'), 'primary');
        updateBtn.onclick = async () => {
            if (latestFile) {
                await this.deleteFileAndRefresh(latestFile.path, latestFile.name);
            }
            console.log(latestFile);
            this.handleDownload(device, firmware);
        };
        this.latestAction.appendChild(updateBtn);
        const deleteBtn = this.createButton(t('button.deleteFile'), 'danger-small');
        deleteBtn.classList.add('mt-2');
        deleteBtn.onclick = async () => {
            if (latestFile && await utils.customConfirm(t('confirm.deleteFile').replace('$1', latestFile.name), {
                variant: 'warning',
                title: t('confirm.title'),
                confirmText: t('confirm.btn.delete'),
                cancelText: t("confirm.btn.cancel"),
            })) {
                await this.deleteFileAndRefresh(latestFile.path, latestFile.name);
            }
        };
        this.latestAction.appendChild(deleteBtn);
    }
    renderUnsignedActions() {
        const unsupportedMsg = document.createElement('div');
        unsupportedMsg.classList.add('w-full', 'bg-red-500/10', 'text-red-400', 'text-sm', 'py-3!', 'px-4!', 'rounded-lg', 'border', 'border-red-500/30', 'text-center');
        unsupportedMsg.textContent = t('message.unsupported');
        this.latestAction.appendChild(unsupportedMsg);
    }
    async deleteFileAndRefresh(filePath, fileName) {
        utils.showSuccessMessage(t('message.deleteFile').replace('$1', fileName));
        await window.api.deleteFile(filePath);
        utils.showSuccessMessage(t('message.deleteFile.success').replace('$1', fileName));
        await refresh();
        if (state.currentProduct) {
            ui.loadDevices(state.currentProduct);
        }
        main.showSelectModel();
    }
    createButtonGroup() {
        const group = document.createElement('div');
        group.classList.add('flex', 'gap-2', 'w-full', 'mt-2');
        return group;
    }
    renderFirmwareList(data) {
        for (let i = 0; i < this.maxRow; i++) {
            const fw = data.firmwares[i];
            this.body.appendChild(fw ? this.createRow(fw, data.device) : document.createElement('tr'));
        }
    }
    createButton(text, type) {
        const btn = document.createElement('button');
        const classMap = {
            'primary': ['w-full', 'bg-(--accent)', 'hover:bg-(--accent-hover)', 'text-white', 'font-medium', 'text-lg', 'py-3!', 'px-8!', 'rounded-full', 'transition-colors', 'duration-200', 'shadow-lg', 'shadow-blue-900/50'],
            'secondary-small': ['flex-1', 'bg-gray-700/50', 'hover:bg-gray-700', 'text-white', 'text-xs', 'py-2!', 'px-3!', 'rounded-lg', 'transition-colors', 'border', 'border-gray-600'],
            'danger': ['w-full', 'bg-red-500/10', 'hover:bg-red-500/20', 'text-red-400', 'font-medium', 'text-lg', 'py-3!', 'px-8!', 'rounded-full', 'transition-colors', 'border', 'border-red-500/30'],
            'danger-small': ['w-full', 'bg-red-500/10', 'hover:bg-red-500/20', 'text-red-400', 'text-xs', 'py-2!', 'px-3!', 'rounded-lg', 'transition-colors', 'border', 'border-red-500/30']
        };
        btn.classList.add(...classMap[type]);
        btn.textContent = text;
        return btn;
    }
    async handleDownload(device, firmware) {
        utils.showSuccessMessage(t('downloader.start'));
        const { result, reason } = await downloadFirmware.download(firmware, device);
        if (result === 'success') {
            if (!state.useIDM) {
                UI.download.show();
            }
        }
        else if (result === 'diskFull') {
            utils.showErrorMessage(t('downloader.fail.diskFull').replace('$1', reason));
        }
        else {
            utils.showErrorMessage(reason ?? 'ERROR');
        }
    }
    async handleVerify(btn, file, firmware) {
        try {
            btn.disabled = true;
            utils.showSuccessMessage(t('state.verifying'));
            const result = await utils.checkMd5(file.path, firmware, {
                onProgress: (progress) => {
                    btn.textContent = `${progress.percent}%`;
                }
            });
            if (result) {
                utils.showSuccessMessage(t('verify.completed'));
            }
            else {
                utils.showErrorMessage(t('verify.mismatch'));
            }
        }
        finally {
            btn.disabled = false;
            btn.textContent = t('button.verify');
        }
    }
    createRow(firmware, device) {
        const row = document.createElement('tr');
        row.classList.add("hover:bg-[#1a2835]", "transition-colors");
        const cells = [
            { content: firmware.version, classes: ["font-bold", "text-white", "text-base"] },
            { content: firmware.buildid, classes: ["text-[#92adc9]", "font-mono", "text-sm"] },
            { content: new Date(firmware.releasedate).toLocaleDateString("vi-VN", { month: "short", day: "2-digit", year: "numeric" }), classes: ["text-[#92adc9]", "text-sm"] },
            { html: this.createStatusBadge(firmware.signed), classes: [] },
            { content: utils.formatBytes(firmware.filesize), classes: ["text-[#92adc9]", "text-sm"] }
        ];
        cells.forEach(({ content, html, classes }) => {
            const td = document.createElement('td');
            td.classList.add(...classes);
            if (html) {
                td.innerHTML = html;
            }
            else {
                td.textContent = content;
            }
            row.appendChild(td);
        });
        row.appendChild(this.createDownloadCell(firmware, device));
        return row;
    }
    createStatusBadge(signed) {
        return signed
            ? `<span class="inline-flex items-center px-2.5! py-0.5! rounded-full text-xs font-bold bg-green-500/10 text-green-400">
      <span class="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5!"></span>
      Signed
    </span>`
            : `<span class="inline-flex items-center px-2.5! py-0.5! rounded-full text-xs font-bold bg-red-500/10 text-red-400">
      <span class="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5!"></span>
      Unsigned
    </span>`;
    }
    createDownloadCell(firmware, device) {
        const control = document.createElement("td");
        const btn = document.createElement("button");
        btn.classList.add("inline-flex", "justify-center", "items-center", "gap-2", "!px-4", "!py-2", "bg-[var(--primary)]", "text-white", "text-xs", "font-bold", "rounded-lg", "hover:bg-[rgba(0,0,0,0.2)]", "border", "border-[var(--primary)]", "transition-all", "w-full", "h-[30px]");
        btn.textContent = t("button.download");
        btn.onclick = async () => {
            utils.showSuccessMessage(t('downloader.start'));
            const { result, reason } = await downloadFirmware.download(firmware, device);
            if (result === 'success') {
                if (!state.useIDM) {
                    UI.download.show();
                }
            }
            else if (result === 'diskFull') {
                utils.showErrorMessage(t('downloader.fail.diskFull').replace('$1', reason));
            }
            else {
                utils.showErrorMessage(reason ?? 'ERROR');
            }
        };
        control.appendChild(btn);
        return control;
    }
};
// Download Manager
const downloadManager = {
    createDownloadItem: (progress) => {
        const item = document.createElement('div');
        item.className = 'download-item';
        item.dataset.downloadId = progress.downloadId;
        const controls = progress.status === 'downloading'
            ? `<button class="control-btn pause" data-action="pause" title="Pause">⏸️</button>`
            : progress.status === 'paused'
                ? '<button class="control-btn pause" data-action="resume" title="Resume">▶️</button>'
                : '';
        const cancelBtn = (progress.status === 'downloading' || progress.status === 'paused')
            ? '<button class="control-btn cancel" data-action="cancel"">❌</button>'
            : '';
        item.innerHTML = `
            <div class="download-header">
                <div class="download-info">
                    <div class="download-name">${progress.fileName}</div>
                    <div class="download-size">
                        ${utils.formatBytes(progress.downloadedSize)} / ${utils.formatBytes(progress.totalSize)}
                    </div>
                </div>
                <div class="download-controls">${controls}${cancelBtn}</div>
            </div>
            <div class="download-progress-container">
                <div class="progress-info">
                    <span>${progress.progress.toFixed(1)}%</span>
                    <span>${utils.formatBytes(progress.speed)}/s</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${progress.progress}%"></div>
                </div>
            </div>
            <div class="download-status status-${progress.status}">
                ${progress.status.charAt(0).toUpperCase() + progress.status.slice(1)}
                ${progress.error ? `: ${progress.error}` : ''}
            </div>
        `;
        // Use event delegation instead of individual listeners
        item.addEventListener('click', (e) => {
            const target = e.target;
            const action = target.dataset.action;
            if (action === 'pause')
                downloadManager.pauseDownload(progress.downloadId);
            else if (action === 'resume')
                downloadManager.resumeDownload(progress.downloadId);
            else if (action === 'cancel')
                downloadManager.cancelDownload(progress.downloadId);
        });
        return item;
    },
    updateDownloadItem: (progress) => {
        let item = elements.downloads.list.querySelector(`[data-download-id="${progress.downloadId}"]`);
        if (!item) {
            elements.downloads.emptyDownloads.classList.add('hidden');
            item = downloadManager.createDownloadItem(progress);
            elements.downloads.list.appendChild(item);
        }
        else {
            const newItem = downloadManager.createDownloadItem(progress);
            item.replaceWith(newItem);
        }
        // Auto-remove completed/error/cancelled downloads
        if (['completed', 'error', 'cancelled'].includes(progress.status)) {
            setTimeout(() => {
                const itemToRemove = elements.downloads.list.querySelector(`[data-download-id="${progress.downloadId}"]`);
                if (itemToRemove) {
                    itemToRemove.remove();
                    activeDownloads.delete(progress.downloadId);
                    if (elements.downloads.list.children.length === 0) {
                        elements.downloads.emptyDownloads.classList.remove('hidden');
                    }
                }
                if (progress.status === 'completed' && state.currentFolder) {
                    window.api.getFiles(state.currentFolder).then((files) => {
                        data.localFiles = files;
                        ui.updateStats();
                        if (state.currentProduct)
                            ui.loadDevices(state.currentProduct);
                    });
                }
            }, 5000);
        }
    },
    pauseDownload: async (downloadId) => {
        console.log("Pause", downloadId);
        await window.downloader?.pauseDownload?.(downloadId);
    },
    resumeDownload: async (downloadId) => {
        await window.downloader?.resumeDownload?.(downloadId);
    },
    cancelDownload: async (downloadId) => {
        if (await utils.customConfirm(t('confirm.cancelDownload'), {
            variant: 'danger',
            title: t('confirm.title'),
            confirmText: t('confirm.btn.ok'),
            cancelText: t("confirm.btn.cancel"),
        })) {
            await window.downloader?.cancelDownload?.(downloadId);
        }
    }
};
// UI Functions
const ui = {
    updateStats: async () => {
        const freeSpace = await window.api.getDiskSpace(state.currentFolder);
        const downloaded = data.localFiles.length;
        elements.stats.downloadedCount.textContent = downloaded.toString();
        elements.stats.storageUsed.textContent = utils.formatBytes(data.localFiles.reduce((total, num) => total + num.size, 0));
        elements.stats.freeSpace.textContent = utils.formatBytes(freeSpace.available);
        // Thêm cảnh báo màu sắc theo % dung lượng còn trống
        const percentage = freeSpace.percentage;
        const freeSpaceElement = elements.stats.freeSpace;
        // Reset các class trước đó
        freeSpaceElement.className = freeSpaceElement.className
            .replace(/text-(red|yellow|green)-(500|600)/g, '')
            .trim();
        percentage >= 60
            ? freeSpaceElement.classList.add(percentage >= 90 ? 'text-red-600' : 'text-yellow-500', 'font-semibold')
            : freeSpaceElement.classList.add('text-green-600');
    },
    filterDevices: (devices, searchTerm) => {
        if (!searchTerm.trim())
            return devices;
        const term = searchTerm.toLowerCase();
        return devices.filter(d => d.name.toLowerCase().includes(term) ||
            d.identifier.toLowerCase().includes(term));
    },
    loadDevices: async function (product) {
        main.showSelectModel();
        elements.overlay.loadingText.style.display = 'block';
        elements.overlay.deviceGrid.innerHTML = '';
        loadedCards.clear();
        elements.overlay.title.textContent = `Loading ${product.toUpperCase()}...`;
        const devices = getDevices().filter(d => d.identifier.toLowerCase().startsWith(product)).reverse();
        elements.overlay.title.textContent = `${product.toUpperCase()} (${devices.length} devices)`;
        elements.overlay.loadingText.style.display = 'none';
        // Use DocumentFragment for better performance
        const fragment = document.createDocumentFragment();
        devices.forEach(device => {
            const card = document.createElement('div');
            card.className = 'product-card';
            card.innerHTML = `
                <div class="device-name">${device.name}</div>
                <div class="device-model">Model: ${device.identifier}</div>
                <div class="device-version">Loading...</div>
                <div class="device-status">...</div>
            `;
            card.dataset.device = JSON.stringify(device);
            fragment.appendChild(card);
        });
        elements.overlay.deviceGrid.appendChild(fragment);
        cardObserver?.disconnect();
        cardObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const card = entry.target;
                    if (!loadedCards.has(card)) {
                        card.classList.add('visible');
                        const deviceData = JSON.parse(card.dataset.device || '{}');
                        ui.addCard(deviceData, card, product);
                        loadedCards.add(card);
                    }
                }
            });
        }, observerOptions);
        elements.overlay.deviceGrid.querySelectorAll('.product-card').forEach(card => {
            cardObserver.observe(card);
        });
    },
    addCard: async (device, card, product) => {
        try {
            if (product) {
                state.currentProduct = product;
            }
            let deviceData = deviceDataCache.get(device.identifier);
            if (!deviceData) {
                deviceData = await loadModelData(device.identifier);
                deviceDataCache.set(device.identifier, deviceData);
            }
            const allFirmwares = deviceData.firmwares;
            const signedFirmwares = allFirmwares.filter(fw => fw.signed);
            const displayFirmwares = signedFirmwares.length > 0 ? signedFirmwares : allFirmwares;
            if (displayFirmwares.length === 0) {
                card.innerHTML = `
                    <div class="device-name">${device.name}</div>
                    <div class="device-model">Model: ${device.identifier}</div>
                    <div class="device-version">No firmware available</div>
                    <div class="device-status status-unavailable">Unavailable</div>
                `;
                return;
            }
            const latest = displayFirmwares[0];
            const fileName = utils.getFileNameFromUrl(latest.url);
            const modelFiles = await utils.findFile(fileName, allFirmwares);
            if (modelFiles.length > 1) {
                modelFiles.sort((a, b) => {
                    if (a.name === fileName)
                        return -1;
                    const hasBuildA = a.name.includes(latest.buildid);
                    const hasBuildB = b.name.includes(latest.buildid);
                    return hasBuildA && !hasBuildB ? -1 : !hasBuildA && hasBuildB ? 1 : 0;
                });
            }
            const hasOldVersions = !modelFiles.some(f => f.name.includes(latest.buildid));
            let status = 'not-downloaded';
            let statusText = t('state.notDownloaded');
            if (modelFiles.length > 0) {
                if (hasOldVersions) {
                    status = 'update-available';
                    statusText = t('state.updateAvailable');
                }
                else {
                    const localFile = modelFiles[0];
                    if (localFile.name.includes(latest.buildid) && localFile.size !== latest.filesize) {
                        status = 'uncomplete';
                        const activeDownloads = await window.downloader.getActiveDownloads();
                        statusText = t(activeDownloads.some(a => a.url === latest.url)
                            ? 'state.downloading'
                            : 'state.uncomplete');
                    }
                    else {
                        status = 'downloaded';
                        statusText = t('state.downloaded');
                    }
                }
            }
            if (signedFirmwares.length === 0) {
                status = 'unsigned';
                statusText = t('state.unsupported');
            }
            card.innerHTML = `
                <div class="device-name">${device.name}</div>
                <div class="device-model">Model: ${device.identifier}</div>
                <div class="device-version">Version: ${latest.version}</div>
                <div class="device-status status-${status}">${statusText}</div>
            `;
            card.onclick = () => {
                elements.globalSearch.overlay.classList.remove('active');
                detail.show(device, allFirmwares, modelFiles, status);
            };
        }
        catch (error) {
            console.error('Error processing device:', device.identifier, error);
            card.innerHTML = `
                <div class="device-name">${device.name}</div>
                <div class="device-model">Model: ${device.identifier}</div>
                <div class="device-version">Error loading data</div>
                <div class="device-status status-error">Error</div>
            `;
        }
    },
    performGlobalSearch: debounce(async (searchTerm) => {
        if (!searchTerm.trim()) {
            UI.globalSearch.close();
            return;
        }
        UI.globalSearch.show();
        elements.globalSearch.results.innerHTML = '';
        elements.globalSearch.title.textContent = `Search Results for "${searchTerm}"`;
        const filteredDevices = ui.filterDevices(getDevices(), searchTerm);
        if (filteredDevices.length === 0) {
            elements.globalSearch.results.innerHTML = '<div class="loading">No devices found</div>';
            return;
        }
        const fragment = document.createDocumentFragment();
        filteredDevices.forEach((device, idx) => {
            const card = document.createElement('div');
            card.className = 'product-card visible';
            card.style.animationDelay = `${idx * 0.05}s`;
            card.innerHTML = `
                <div class="device-name">${device.name}</div>
                <div class="device-model">Model: ${device.identifier}</div>
                <div class="device-version">Loading...</div>
                <div class="device-status">...</div>
            `;
            card.dataset.device = JSON.stringify(device);
            fragment.appendChild(card);
            const product = getProductType(device.identifier);
            ui.addCard(device, card, product);
        });
        elements.globalSearch.results.appendChild(fragment);
    }, 300)
};
const refresh = async () => {
    if (state.currentFolder) {
        data.localFiles = await window.api.getFiles(state.currentFolder);
    }
    ui.updateStats();
};
// Initialize event listeners
const initEventListeners = () => {
    window.downloader.onDownloadProgress((progress) => {
        activeDownloads.set(progress.downloadId, progress);
        downloadManager.updateDownloadItem(progress);
    });
    window.downloader.onDownloadComplete(async ({ request, filePath }) => {
        utils.showSuccessMessage(t('message.download.completed').replace('$1', request.fileName), 4000);
        if (request.continue) {
            await utils.sleep(2000);
            utils.showSuccessMessage(t('message.download.completed.verify'), 4000);
            const box = document.createElement('div');
            box.classList.add('message', 'success-message', 'w-[400px]', 'h-[120px]', 'flex', 'flex-col', 'gap-2');
            document.body.appendChild(box);
            let now = Date.now();
            const result = await utils.checkMd5(filePath, request.firmware, {
                onProgress: (progress) => {
                    const nd = Date.now();
                    if (nd - now >= 4000) {
                        now = nd;
                        box.innerHTML = `
              <div>${t('verify.progress')}</div>
              <div>
                <span>File Name:</span>
                <span>${request.fileName}</span>
              </div>
              <div>Completed: ${progress.percent}%</div>
            `;
                    }
                },
            });
            if (result) {
                utils.showSuccessMessage(t('verify.completed'));
                box.remove();
            }
            else {
                box.remove();
                utils.showErrorMessage(`Tệp ${request.fileName} không hoàn thiện. Đang tải lại...`);
                await window.api.deleteFile(filePath);
                utils.showSuccessMessage(`Đã xóa: ${request.fileName}`);
                utils.showSuccessMessage(t('downloader.start'));
                const { result, reason } = await downloadFirmware.download(request.firmware, request.device);
                if (result === 'success') {
                    if (!state.useIDM) {
                        UI.download.show();
                    }
                }
                else if (result === 'diskFull') {
                    utils.showErrorMessage(t('downloader.fail.diskFull').replace('$1', reason));
                }
                else {
                    utils.showErrorMessage(reason ?? 'ERROR');
                }
                return;
            }
        }
        refresh();
    });
    window.downloader.onDownloadError(async ({ request, error }) => {
        refresh();
        utils.showErrorMessage(`[Download Fail]\n- Model ${request.device.name}\nError: ${error}`, 8000);
    });
    window.api.onAppClose(async (data) => {
        await utils.closeAllConfirm();
        const r = await utils.customConfirm(t('confirm.closeApp').replace('$1', `${data?.taskCount}`), {
            variant: 'danger',
            title: t('confirm.title.exit'),
            confirmText: t('confirm.btn.exit'),
            cancelText: t('confirm.btn.cancel')
        });
        window.api.sendAppCloseResult(r);
    });
    elements.topbar.upgrade?.addEventListener('click', () => {
        elements.updater.page.classList.add('active');
    });
    // elements.topbar.upgradeAllFirmware.addEventListener('click', async () => null)
    // Downloads page
    elements.downloads.btn?.addEventListener('click', UI.download.show);
    elements.downloads.closeBtn?.addEventListener('click', UI.download.close);
    // Global search
    elements.globalSearch.input.addEventListener('input', (e) => {
        const searchTerm = e.target.value;
        elements.globalSearch.clear.style.display = searchTerm.trim() ? 'block' : 'none';
        if (searchTerm.trim()) {
            ui.performGlobalSearch(searchTerm);
        }
        else {
            UI.globalSearch.close();
        }
    });
    elements.globalSearch.clear.addEventListener('click', () => {
        elements.globalSearch.input.value = '';
        elements.globalSearch.clear.style.display = 'none';
        UI.globalSearch.close();
    });
    elements.globalSearch.closeBtn.addEventListener('click', () => UI.globalSearch.close());
    elements.overlay.deleteAllFirmware.addEventListener('click', async () => {
        // try {
        //   // Disable Button
        //   elements.overlay.deleteAllFirmware.disabled = true;
        // } finally {
        //   // Enable Button
        //   elements.overlay.deleteAllFirmware.disabled = false;
        // }
        if (!await utils.customConfirm(t('confirm.removeRedundantFiles'), {
            title: t('confirm.title'),
            confirmText: t('confirm.btn.delete'),
            cancelText: t("confirm.btn.cancel"),
            variant: "danger"
        }))
            return;
        try {
            if (state.isDeletingFM) {
                utils.showErrorMessage(t('deleteAllFirmware.isDeleting'));
                return;
            }
            state.isDeletingFM = true;
            utils.showSuccessMessage(t('deleteAllFirmware.start'));
            const [result_old, result_duplicate] = await Promise.all([
                firmwareManager?.deleteOldFilesForAllDevices(state.currentProduct),
                firmwareManager?.deleteDuplicateFilesForAllDevices(state.currentProduct)
            ]);
            let totalDevice = 0;
            if (result_old && result_old.length > 0) {
                for (const data of result_old) {
                    totalDevice += data.filesDeleted.length;
                }
            }
            if (result_duplicate && result_duplicate.length > 0) {
                for (const data of result_duplicate) {
                    totalDevice += data.filesDeleted.length;
                }
            }
            utils.showSuccessMessage(t('deleteAllFirmware.delete.success').replace('$1', totalDevice.toString()));
        }
        finally {
            state.isDeletingFM = false;
            refresh();
        }
    });
    // Settings
    elements.topbar.settings.addEventListener('click', UI.setting.show);
    elements.topbar.refresh.addEventListener('click', async () => {
        await refresh();
        if (state.currentProduct) {
            ui.loadDevices(state.currentProduct);
        }
    });
    elements.settings.closeBtn?.addEventListener('click', UI.setting.close);
    elements.settings.about.checkUpdate?.addEventListener('click', checkUpdate);
    elements.settings.download.selectPath?.addEventListener('click', async () => {
        const path = await window.api.selectFolder();
        if (path) {
            state.currentFolder = path;
            window.store.set('ipswFolder', path);
            elements.settings.download.currentPath.textContent = path;
            refresh();
        }
    });
    elements.settings.download.idmSelectPath?.addEventListener('click', async () => {
        const path = await window.api.selectFile([{ name: "Executable", extensions: ["exe"] }]);
        if (!path)
            return;
        window.store.set('idmPath', path);
        elements.settings.download.idmCurrentPath.textContent = path;
        state.IDMPath = path;
    });
    elements.settings.download.useIDM?.addEventListener('click', () => {
        const s = !elements.settings.download.useIDM.classList.contains('active');
        window.store.set('useIDM', s);
        state.useIDM = s;
    });
    elements.settings.file.removeOldFiles?.addEventListener('click', () => {
        const s = !elements.settings.file.removeOldFiles.classList.contains('active');
        window.store.set('autoRemoveOldFiles', s);
        state.autoRemoveOldFiles = s;
    });
    elements.settings.file.removeDuplicateFiles?.addEventListener('click', () => {
        const s = !elements.settings.file.removeDuplicateFiles.classList.contains('active');
        window.store.set('autoRemoveDuplicateFiles', s);
        state.autoRemoveDuplicateFiles = s;
    });
    // Toggle switches
    document.querySelectorAll('.toggle-switch').forEach(toggle => {
        toggle.addEventListener('click', () => toggle.classList.toggle('active'));
    });
    // Product cards
    document.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', async () => {
            const product = card.dataset.product;
            if (!product)
                throw new Error("Product not found");
            state.currentProduct = product;
            ui.loadDevices(product);
        });
    });
    // ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape')
            return;
        if (!main.detail?.classList.contains('hidden')) {
            if (state.currentProduct) {
                main.showSelectModel();
            }
            else {
                main.showSelectProduct();
            }
            return;
        }
        else if (!main.selectModel?.classList.contains('hidden')) {
            main.showSelectProduct();
            return;
        }
        const activePages = [
            [elements.downloads.page, UI.download.close],
            [elements.settings.page, UI.setting.close],
            [elements.globalSearch.overlay, UI.globalSearch.close],
        ];
        for (const [page, handler] of activePages) {
            if (page.classList.contains('active')) {
                handler();
                break;
            }
        }
    });
    elements.updater.page.addEventListener('click', () => elements.updater.page.classList.remove('active'));
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect) {
        languageSelect.addEventListener('change', async (e) => {
            const selectedLanguage = e.target.value;
            await window.store.set('language', selectedLanguage);
            changeLanguage(selectedLanguage);
        });
    }
};
// Main initialization
document.addEventListener("DOMContentLoaded", async () => {
    loadDevices();
    const [savedFolder, useIDM, IDMPath, autoRemoveOldFile, autoRemoveDuplicateFile, language, version] = await Promise.all([
        window.store.get('ipswFolder'),
        window.store.get('useIDM'),
        window.store.get('idmPath'),
        window.store.get('autoRemoveOldFiles'),
        window.store.get('autoRemoveDuplicateFiles'),
        window.store.get('language'),
        window.api.getVersion()
    ]);
    changeLanguage(language || 'vi');
    if (savedFolder) {
        state.currentFolder = savedFolder;
        elements.settings.download.currentPath.textContent = savedFolder || "-";
    }
    if (useIDM) {
        state.useIDM = useIDM;
        elements.settings.download.useIDM.classList.add('active');
    }
    if (IDMPath) {
        elements.settings.download.idmCurrentPath.textContent = IDMPath;
        state.IDMPath = IDMPath;
    }
    if (autoRemoveOldFile) {
        elements.settings.file.removeOldFiles.classList.add('active');
        state.autoRemoveOldFiles = autoRemoveOldFile;
    }
    if (autoRemoveDuplicateFile) {
        elements.settings.file.removeDuplicateFiles.classList.add('active');
        state.autoRemoveDuplicateFiles = autoRemoveDuplicateFile;
    }
    if (version) {
        elements.settings.about.version.textContent = version;
    }
    // Set the language selector to saved language
    const languageSelect = document.getElementById('languageSelect');
    if (languageSelect) {
        languageSelect.value = language || 'vi';
    }
    refresh();
    initEventListeners();
});
async function checkUpdate() {
    const checkUpdateBtn = elements.settings.about.checkUpdate;
    checkUpdateBtn.textContent = "Checking";
    checkUpdateBtn.disabled = true;
    const checkData = await window.updater.check();
    if (checkData.status === "no-update") {
        utils.showSuccessMessage(t('setting.checkUpdate.latest'), 4000);
        checkUpdateBtn.textContent = t('setting.about.checkUpdate');
        checkUpdateBtn.disabled = false;
        return;
    }
    if (checkData.status === "update-available") {
        const data = checkData.info;
        if (!data) {
            utils.showErrorMessage("Something went wrong!");
            return;
        }
        // Mở UI update
        elements.updater.page.classList.add('active');
        elements.updater.version.textContent = data.version;
        // Hiển thị changelog
        if (data.releaseNotes) {
            const notes = data.releaseNotes;
            if (typeof notes === 'string') {
                elements.updater.changelog.innerHTML = notes;
            }
            else if (Array.isArray(notes)) {
                elements.updater.changelog.innerHTML = notes
                    .map(note => `<li>${note}</li>`)
                    .join('');
            }
        }
        // Nút tải bản cập nhật
        const downloadBtn = elements.updater.download;
        downloadBtn.disabled = false;
        downloadBtn.textContent = "Download Update";
        downloadBtn.onclick = () => {
            downloadBtn.disabled = true;
            downloadBtn.textContent = "Downloading...";
            window.updater.start();
        };
        // Reset nút check update
        checkUpdateBtn.textContent = "Check Update";
        checkUpdateBtn.disabled = false;
        return;
    }
    if (checkData.status === "error") {
        utils.showErrorMessage(`Error: ${checkData?.error}`);
    }
}
// Auto Check Update
window.updater.onUpdateAvailable((data) => {
    elements.topbar.upgrade?.classList.remove('hidden!');
    elements.updater.version.textContent = data.version;
    if (data.notes) {
        if (typeof data.notes === 'string') {
            elements.updater.changelog.innerHTML = data.notes;
        }
        else if (Array.isArray(data.notes) && data.notes.length > 0) {
            elements.updater.changelog.innerHTML = data.notes
                .map(note => `<li>${note}</li>`)
                .join('');
        }
    }
    const downloadBtn = elements.updater.download;
    downloadBtn.onclick = () => {
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Downloading...';
        window.updater.start();
    };
});
window.updater.onUpdateProgress((p) => {
    elements.updater.process.fill.style.width = p.percent + '%';
    elements.updater.process.percent.textContent = p.percent + '%';
    elements.updater.process.label.textContent = 'Downloading...';
    elements.updater.status.textContent = `${p.transferred}MB / ${p.total}MB`;
});
window.updater.onUpdateReady(async () => {
    utils.showSuccessMessage(t('update.ready'));
    const btn = elements.updater.download;
    btn.textContent = t('update.btn.ready');
    elements.updater.process.fill.style.width = '100%';
    elements.updater.process.percent.textContent = '100%';
    elements.updater.process.label.textContent = 'Download complete!';
    elements.updater.status.textContent = 'Ready to install';
    window.updater.install();
});
