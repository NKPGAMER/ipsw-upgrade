import { Device, DeviceResponse, getDevices, getProductType, loadDevices, loadModelData, Product } from "./dataHandle.js";
import firmwareManager from "./upgradeDevices.js";
import downloadFirmware from "./core/downloadFirmware.js";
import elements from "./elements.js";
import utils from "./core/utils.js";
import { data, state } from "./data.js";
import { createRoot } from "react-dom/client";
import i18n from './i18n.js';

import SettingsApp from "./ui/setting.js";
import DownloadPage from "./ui/download.js";

const { t, changeLanguage } = i18n;

interface detaiData {
  device: Device;
  firmwares: Firmware[];
}

type deviceStatus = 'downloaded' | 'uncomplete' | 'update-available' | 'not-downloaded' | 'unsigned';

const loadedCards = new Set<HTMLDivElement>();

// Cache for device data to avoid redundant API calls
const deviceDataCache = new Map<string, DeviceResponse>();

const observerOptions = {
  root: null,
  rootMargin: '100px',
  threshold: 0.01
};

let cardObserver: IntersectionObserver;

// Debounce helper
const debounce = <T extends (...args: any[]) => any>(fn: T, ms: number) => {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
};

const UI = {
  download: {
    show: () => elements.downloads.page.classList.remove('hidden'),
    close: () => elements.downloads.page.classList.add('hidden')
  },

  setting: {
    show: () => elements.settings.page.classList.remove('hidden'),
    close: () => elements.settings.page.classList.add("hidden")
  },

  globalSearch: {
    show: () => elements.globalSearch.overlay.classList.add('active'),
    close: () => elements.globalSearch.overlay.classList.remove('active')
  }
}

const settingsPage = createRoot(document.getElementById('settingsPage') as HTMLDivElement);
const downloadPage = createRoot(document.getElementById('downloadPage')!)
settingsPage.render(<>
  <SettingsApp onClose={() => UI.setting.close()} />
</>)
downloadPage.render(
  <>
    <DownloadPage onClose={() => UI.download.close()}></DownloadPage>
  </>
)

const main = new class {
  public selectProduct = document.getElementById('main:selectProduct');
  public modelDetailContainer = document.getElementById('main:modelDetailContainer');
  public selectModel = document.getElementById('main:selectModel');
  public detail = document.getElementById('main:detail');
  public resizeDivider = document.getElementById('resizeDivider');
  public resizeOverlay = document.getElementById('resizeOverlay');

  private isResizing = false;
  private containerWidth = 0;
  private savedLeftWidth = 60;
  private savedRightWidth = 40;

  constructor() {
    this.initResizer();
  }

  private initResizer() {
    if (!this.resizeDivider || !this.modelDetailContainer || !this.selectModel || !this.detail) return;

    const divider = this.resizeDivider;
    const container = this.modelDetailContainer;
    const leftPanel = this.selectModel;
    const rightPanel = this.detail;
    const overlay = this.resizeOverlay;

    const startResize = (e: MouseEvent) => {
      this.isResizing = true;
      this.containerWidth = container.offsetWidth;

      leftPanel.style.transition = 'none';
      rightPanel.style.transition = 'none';
      divider.style.transition = 'none';

      if (overlay) {
        overlay.classList.remove('hidden');
      } else {
        leftPanel.style.opacity = '0.5';
        rightPanel.style.opacity = '0.5';
      }

      leftPanel.style.pointerEvents = 'none';
      rightPanel.style.pointerEvents = 'none';

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      e.preventDefault();
    };

    const resize = (e: MouseEvent) => {
      if (!this.isResizing) return;

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
      if (!this.isResizing) return;

      this.isResizing = false;

      leftPanel.style.transition = '';
      rightPanel.style.transition = '';
      divider.style.transition = '';

      if (overlay) {
        overlay.classList.add('hidden');
      } else {
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

  public showSelectProduct() {
    this.modelDetailContainer?.classList.add('hidden');
    this.selectProduct?.classList.remove('hidden');
    topbar.showMain();
  }

  public showSelectModel() {
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

  public showDetail(device: Device) {
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

  public hideDetail() {
    if (this.selectModel && this.detail && this.resizeDivider) {
      this.selectModel.style.width = '100%';
      this.detail.style.width = '0%';
      this.detail.classList.add('opacity-0', 'pointer-events-none');
      this.resizeDivider.classList.add('hidden');
    }
  }
}();

const topbar = new class {
  private main = document.getElementById('topbar');
  private selectModel = document.getElementById('topbar:selectModel');
  private breadcrumb_selectModel = document.getElementById('breadcrumb_selectModel') as HTMLOListElement;

  public closeBtn = document.getElementById('topbar.closeBtn') as HTMLButtonElement;

  private isDetailMode = false;

  constructor() {
    this.closeBtn.addEventListener('click', () => {
      if (this.isDetailMode) {
        main.hideDetail();
        this.showSelectModelBreadcrumb();
        this.isDetailMode = false;
      } else {
        main.showSelectProduct();
        state.currentProduct = "" as Product;
      }
    });
  }

  public showMain() {
    this.selectModel?.classList.add('hidden!');
    this.main?.classList.remove('hidden!');
    this.isDetailMode = false;
  }

  public showSelectModel() {
    this.main?.classList.add('hidden!');
    this.selectModel?.classList.remove('hidden!');
    this.isDetailMode = false;

    this.showSelectModelBreadcrumb();
  }

  private showSelectModelBreadcrumb() {
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

  public showDetail(device: Device) {
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
  private body = document.getElementById('detail:body') as HTMLTableRowElement;
  private title = document.getElementById('detailTitle') as HTMLDivElement;
  private maxRow: number = 5;

  private latestVersion = document.getElementById('detail.latest.version') as HTMLDivElement;
  private latestSize = document.getElementById('detail.latest.size') as HTMLDivElement;
  private latestBuild = document.getElementById('detail.latest.build') as HTMLDivElement;
  private latestRelease = document.getElementById('detail.latest.release') as HTMLDivElement;
  private latestAction = document.getElementById('detail.latest.action') as HTMLDivElement;

  constructor() { }

  public async show(device: Device, firmwares: Firmware[], modelFiles: IPSWFile[], status: deviceStatus) {
    main.showDetail(device);

    await this.updateData({ device, firmwares }, modelFiles, firmwares[0], status);

    // Tối ưu xử lý related files
    if (modelFiles.length > 1) {
      if (state.autoRemoveOldFiles) {
        firmwareManager.deleteOldFilesForDevice(device.identifier)
      }

      if (state.autoRemoveDuplicateFiles) {
        firmwareManager.deleteDuplicateFilesForDevice(device.identifier)
      }
    }
  }

  private async updateData(data: detaiData, modelFiles: IPSWFile[], latest: Firmware, status: deviceStatus) {
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

  private updateLatestInfo(device: Device, latest: Firmware) {
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

  private async renderActions(status: deviceStatus, data: detaiData, latest: Firmware, latestFile?: IPSWFile) {
    switch (status) {
      case 'not-downloaded':
        this.renderNotDownloadedActions(data.device, latest);
        break;
      case 'uncomplete':
        // await this.renderUncompleteActions(data.device, latest, latestFile);
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

  private renderNotDownloadedActions(device: Device, firmware: Firmware) {
    const downloadBtn = this.createButton(t('button.download'), 'primary');
    downloadBtn.onclick = () => downloadFirmware.download(firmware, device);
    this.latestAction.appendChild(downloadBtn);
  }

  // private async renderUncompleteActions(device: Device, firmware: Firmware, latestFile?: IPSWFile) {
  //   const activeDownloads = await window.downloader.getActiveDownloads();
  //   const isDownloading = activeDownloads.some(a => a.url === firmware.url);

  //   if (isDownloading) {
  //     const viewBtn = this.createButton(t('state.downloading'), 'primary');
  //     if (!state.useIDM) {
  //       viewBtn.onclick = () => UI.download.show();
  //     }
  //     this.latestAction.appendChild(viewBtn);
  //   } else {
  //     const resumeBtn = this.createButton(t('button.resumeDownload'), 'primary');
  //     resumeBtn.onclick = async () => {
  //       utils.showSuccessMessage(t('downloader.start'));
  //       const { result, reason } = await downloadFirmware.download(firmware, device, { continue: true });
  //       if (result === 'success') {
  //         UI.download.show();
  //       } else if (result === 'diskFull') {
  //         utils.showErrorMessage(t('downloader.fail.diskFull').replace('$1', reason as string))
  //       } else {
  //         utils.showErrorMessage(reason ?? 'ERROR');
  //       }
  //     };
  //     this.latestAction.appendChild(resumeBtn);

  //     // Group buttons for reload and delete
  //     const group = this.createButtonGroup();

  //     const reloadBtn = this.createButton(t('button.reDownload'), 'secondary-small');
  //     reloadBtn.onclick = async () => {
  //       if (latestFile && await utils.customConfirm(t('confirm.reDownloadFile'), {
  //         variant: 'info',
  //         title: t('confirm.title'),
  //         confirmText: t('button.reDownload'),
  //         cancelText: t("confirm.btn.cancel"),
  //       })) {
  //         await window.api.deleteFile(latestFile.path);
  //         await this.handleDownload(device, firmware);
  //       }
  //     };

  //     const deleteBtn = this.createButton(t('button.deleteFile'), 'secondary-small');
  //     deleteBtn.onclick = async () => {
  //       if (latestFile && await utils.customConfirm(t('confirm.deleteFile').replace('$1', latestFile.name), {
  //         variant: 'warning',
  //         title: t('confirm.title'),
  //         confirmText: t('confirm.btn.delete'),
  //         cancelText: t("confirm.btn.cancel"),
  //       })) {
  //         await this.deleteFileAndRefresh(latestFile.path, latestFile.name);
  //       }
  //     };

  //     group.appendChild(reloadBtn);
  //     group.appendChild(deleteBtn);
  //     this.latestAction.appendChild(group);
  //   }
  // }

  private renderDownloadedActions(device: Device, firmware: Firmware, latestFile?: IPSWFile) {
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

  private renderUpdateAvailableActions(device: Device, firmware: Firmware, latestFile?: IPSWFile) {
    const updateBtn = this.createButton(t('button.update'), 'primary');
    updateBtn.onclick = async () => {
      if (latestFile) {
        await this.deleteFileAndRefresh(latestFile.path, latestFile.name);
      }
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

  private renderUnsignedActions() {
    const unsupportedMsg = document.createElement('div');
    unsupportedMsg.classList.add('w-full', 'bg-red-500/10', 'text-red-400', 'text-sm', 'py-3!', 'px-4!', 'rounded-lg', 'border', 'border-red-500/30', 'text-center');
    unsupportedMsg.textContent = t('message.unsupported');
    this.latestAction.appendChild(unsupportedMsg);
  }

  private async deleteFileAndRefresh(filePath: string, fileName: string) {
    utils.showSuccessMessage(t('message.deleteFile').replace('$1', fileName));
    await window.api.deleteFile(filePath);
    utils.showSuccessMessage(t('message.deleteFile.success').replace('$1', fileName));
    await refresh();
    if (state.currentProduct) {
      ui.loadDevices(state.currentProduct);
    }
    main.showSelectModel();
  }

  private createButtonGroup(): HTMLDivElement {
    const group = document.createElement('div');
    group.classList.add('flex', 'gap-2', 'w-full', 'mt-2');
    return group;
  }

  private renderFirmwareList(data: detaiData) {
    for (let i = 0; i < this.maxRow; i++) {
      const fw = data.firmwares[i];
      this.body.appendChild(fw ? this.createRow(fw, data.device) : document.createElement('tr'));
    }
  }

  private createButton(text: string, type: 'primary' | 'secondary-small' | 'danger' | 'danger-small'): HTMLButtonElement {
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

  private async handleDownload(device: Device, firmware: Firmware) {
    utils.showSuccessMessage(t('downloader.start'));
    downloadFirmware.download(firmware, device)
  }

  private async handleVerify(btn: HTMLButtonElement, file: IPSWFile, firmware: Firmware) {
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
      } else {
        utils.showErrorMessage(t('verify.mismatch'));
      }
    } finally {
      btn.disabled = false;
      btn.textContent = t('button.verify');
    }
  }

  private createRow(firmware: Firmware, device: Device): HTMLTableRowElement {
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
      } else {
        td.textContent = content as string;
      }
      row.appendChild(td);
    });

    row.appendChild(this.createDownloadCell(firmware, device));
    return row;
  }

  private createStatusBadge(signed: boolean): string {
    return signed
      ? `<span class="inline-flex items-center px-2.5! py-0.5! rounded-full text-xs font-bold bg-green-500/10 text-green-400">
      <span class="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5!"></span>
      Signed
    </span>`
      : `<span class="inline-flex items-center px-2.5! py-0.5! rounded-full text-xs font-bold bg-red-500/10 text-red-400">
      <span class="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5!"></span>
      Unsigned
    </span>`
  }

  private createDownloadCell(firmware: Firmware, device: Device): HTMLTableCellElement {
    const control = document.createElement("td");
    const btn = document.createElement("button");
    btn.classList.add("inline-flex", "justify-center", "items-center", "gap-2", "!px-4", "!py-2", "bg-[var(--primary)]", "text-white", "text-xs", "font-bold", "rounded-lg", "hover:bg-[rgba(0,0,0,0.2)]", "border", "border-[var(--primary)]", "transition-all", "w-full", "h-[30px]");
    btn.textContent = t("button.download");
    btn.onclick = async () => {
      utils.showSuccessMessage(t('downloader.start'));
      downloadFirmware.download(firmware, device);
    };

    control.appendChild(btn);
    return control;
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
      : freeSpaceElement.classList.add('text-green-600')
  },

  filterDevices: (devices: Device[], searchTerm: string): Device[] => {
    if (!searchTerm.trim()) return devices;
    const term = searchTerm.toLowerCase();
    return devices.filter(d =>
      d.name.toLowerCase().includes(term) ||
      d.identifier.toLowerCase().includes(term)
    );
  },

  loadDevices: async function (product: Product) {
    main.showSelectModel();
    elements.overlay.loadingText.style.display = 'block';
    elements.overlay.deviceGrid.innerHTML = '';
    loadedCards.clear();

    elements.overlay.title.textContent = `Loading ${product.toUpperCase()}...`;

    const devices = getDevices().filter(d =>
      d.identifier.toLowerCase().startsWith(product)
    ).reverse();

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
          const card = entry.target as HTMLDivElement;
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

  addCard: async (device: Device, card: HTMLDivElement, product?: Product) => {
    try {
      if (product) {
        state.currentProduct = product;
      }
      let deviceData = deviceDataCache.get(device.identifier);
      if (!deviceData) {
        deviceData = await loadModelData(device.identifier);
        deviceDataCache.set(device.identifier, deviceData);
      }

      const allFirmwares: Firmware[] = deviceData.firmwares;
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
          if (a.name === fileName) return -1;
          const hasBuildA = a.name.includes(latest.buildid);
          const hasBuildB = b.name.includes(latest.buildid);
          return hasBuildA && !hasBuildB ? -1 : !hasBuildA && hasBuildB ? 1 : 0;
        });
      }

      const hasOldVersions = !modelFiles.some(f => f.name.includes(latest.buildid));

      let status: deviceStatus = 'not-downloaded';
      let statusText = t('state.notDownloaded');

      if (modelFiles.length > 0) {
        if (hasOldVersions) {
          status = 'update-available';
          statusText = t('state.updateAvailable');
        } else {
          const localFile = modelFiles[0];
          if (localFile.name.includes(latest.buildid) && localFile.size !== latest.filesize) {
            status = 'uncomplete';
            const activeDownloads = await window.downloader.getAllTask();
            statusText = t(activeDownloads.some(task => task.firmware.url === latest.url)
              ? 'state.downloading'
              : 'state.uncomplete');
          } else {
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
      }

    } catch (error) {
      console.error('Error processing device:', device.identifier, error);
      card.innerHTML = `
                <div class="device-name">${device.name}</div>
                <div class="device-model">Model: ${device.identifier}</div>
                <div class="device-version">Error loading data</div>
                <div class="device-status status-error">Error</div>
            `;
    }
  },

  performGlobalSearch: debounce(async (searchTerm: string) => {
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

export const refresh = async () => {
  if (state.currentFolder) {
    data.localFiles = await window.api.getFiles(state.currentFolder);
  }
   await ui.updateStats();
};

async function deleteAllFirmware() {
  try {
    elements.overlay.deleteAllFirmware.disabled = true;
    utils.showSuccessMessage(t('redundantFirmware.checking'));
    const [oldFiles, dupFiles] = await Promise.all([
      firmwareManager.getOldFilesForAllDevices(state.currentProduct),
      firmwareManager.getDuplicateFilesForAllDevices(state.currentProduct)
    ]);

    if (oldFiles.length + dupFiles.length === 0) {
      utils.showSuccessMessage(t('message.redundantFirmware.isLatest'));
      return;
    }

    const confirm = await utils.customConfirm(
      t('confirm.removeRedundantFiles')
        .replace('$1', oldFiles.length.toString())
        .replace('$2', dupFiles.length.toString()),
      {
        variant: 'danger',
        confirmText: t('confirm.btn.delete'),
        cancelText: t('confirm.btn.cancel')
      }
    );

    if (!confirm) return;

    const [result_old, result_dup] = await Promise.all([
      firmwareManager.deleteOldFilesForAllDevices(state.currentProduct),
      firmwareManager.deleteDuplicateFilesForAllDevices(state.currentProduct)
    ]);

    let totalDevice: number = 0;

    if (result_old && result_old.length > 0) {
      for (const data of result_old) {
        totalDevice += data.filesDeleted.length
      }
    }

    if (result_dup && result_dup.length > 0) {
      for (const data of result_dup) {
        totalDevice += data.filesDeleted.length
      }
    }

    utils.showSuccessMessage(t('deleteAllFirmware.delete.success').replace('$1', totalDevice.toString()))
  } finally {
    elements.overlay.deleteAllFirmware.disabled = false;
  }
}

// Initialize event listeners
const initEventListeners = () => {
  window.api.onAppClose(async (data) => {
    await utils.closeAllConfirm();
    const r = await utils.customConfirm(t('confirm.closeApp').replace('$1', `${data?.taskCount}`), {
      variant: 'danger',
      title: t('confirm.title.exit'),
      confirmText: t('confirm.btn.exit'),
      cancelText: t('confirm.btn.cancel')
    });

    window.api.sendAppCloseResult(r)
  })

  window.downloader.onAdded(() => {
    document.getElementById('downloadsBtn')?.classList.add("highlight-glow")
  });

  const downloadPageBtn = document.getElementById('downloadsBtn');

  const disableHighlight = async () => {
    const task = (await window.downloader.getAllTask()).filter(t => t.status === "downloading" || t.status === "verifying" || t.status === "moving" || t.status === "queued");

    downloadPageBtn?.classList.toggle("highlight-glow", task.length > 0)
  }

  window.downloader.onCancelled(disableHighlight);
  window.downloader.onError(disableHighlight)

  window.downloader.onCompleted(async () => {
    await refresh();

    if(!main.modelDetailContainer?.classList.contains("hidden")) {
      ui.loadDevices(state.currentProduct)
    }

    disableHighlight()
  });

  elements.topbar.upgrade?.addEventListener('click', () => {
    elements.updater.page.classList.add('active');
  });

  elements.topbar.refresh.addEventListener('click', async () => {
    try {
      elements.topbar.refresh.disabled = true;
      await refresh();
      if (!main.modelDetailContainer?.classList.contains("hidden")) {
        ui.loadDevices(state.currentProduct)
      }
    } finally {
      elements.topbar.refresh.disabled = false;
    }
  })

  // Downloads page
  elements.downloads.btn?.addEventListener('click', UI.download.show);
  elements.downloads.closeBtn?.addEventListener('click', UI.download.close);

  // Global search
  elements.globalSearch.input.addEventListener('input', (e) => {
    const searchTerm = (e.target as HTMLInputElement).value;
    elements.globalSearch.clear.style.display = searchTerm.trim() ? 'block' : 'none';
    if (searchTerm.trim()) {
      ui.performGlobalSearch(searchTerm);
    } else {
      UI.globalSearch.close();
    }
  });

  elements.globalSearch.clear.addEventListener('click', () => {
    elements.globalSearch.input.value = '';
    elements.globalSearch.clear.style.display = 'none';
    UI.globalSearch.close();
  });

  elements.globalSearch.closeBtn.addEventListener('click', () => UI.globalSearch.close());

  elements.overlay.deleteAllFirmware.addEventListener('click', deleteAllFirmware);
  // Settings
  elements.topbar.settings.addEventListener('click', UI.setting.show);
  // Toggle switches
  document.querySelectorAll('.toggle-switch').forEach(toggle => {
    toggle.addEventListener('click', () => toggle.classList.toggle('active'));
  });

  // Product cards
  document.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', async () => {
      const product = (card as HTMLElement).dataset.product as Product;
      if (!product) throw new Error("Product not found");
      state.currentProduct = product;
      ui.loadDevices(product);
    });
  });

  // ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    if (!main.detail?.classList.contains('hidden')) {
      if (state.currentProduct) {
        main.showSelectModel();
      } else {
        main.showSelectProduct();
      }
      return;
    } else if (!main.selectModel?.classList.contains('hidden')) {
      main.showSelectProduct();
      return;
    }

    const activePages = [
      [elements.downloads.page, UI.download.close],
      [elements.globalSearch.overlay, UI.globalSearch.close],
    ];

    for (const [page, handler] of activePages) {
      if ((page as HTMLElement).classList.contains('active')) {
        (handler as Function)();
        break;
      }
    }
  });
};

// Main initialization
document.addEventListener("DOMContentLoaded", async () => {
  loadDevices()
  refresh();
  initEventListeners();
});