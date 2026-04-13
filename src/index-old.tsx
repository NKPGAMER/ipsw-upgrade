import { DeviceResponse, getDevices, getProductType, loadDevices, loadModelData, Product } from "./core/dataHandle.js";
import elements from "./elements.js";
import utils from "./core/utils.js";
import { data, state } from "./data.js";

import {
  download,
  getFileNameFromUrl,
  getFiles,
  getRedundantFiles,
  getRedundantFilesFromProduct
} from "./core/helper.js";

import i18n from './i18n.js';

const { t } = i18n;

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
  }
};

const filesCache = new Map<Product, {
  date: number;
  oldFiles: IPSWFile[];
  duplicateFiles: IPSWFile[];
}>();

const CACHE_TTL = 120_000; // 120s (tuỳ chỉnh)

async function getCachedRedundantFiles(product: Product) {
  const cache = filesCache.get(product);

  if (cache && Date.now() - cache.date < CACHE_TTL) {
    return cache;
  }

  const result = await getRedundantFilesFromProduct(product);

  const newCache = {
    date: Date.now(),
    ...result,
  };

  filesCache.set(product, newCache);
  return newCache;
}

async function deleteAllFirmware() {
  try {
    elements.overlay.deleteAllFirmware.disabled = true;
    utils.showSuccessMessage(t('redundantFirmware.checking'));
    const { oldFiles, duplicateFiles } =
      await getCachedRedundantFiles(state.currentProduct);

    if (oldFiles.length + duplicateFiles.length === 0) {
      utils.showSuccessMessage(t('message.redundantFirmware.isLatest'));
      return;
    }

    const confirm = await utils.customConfirm(
      t('confirm.removeRedundantFiles')
        .replace('$1', oldFiles.length.toString())
        .replace('$2', duplicateFiles.length.toString()),
      {
        variant: 'danger',
        confirmText: t('confirm.btn.delete'),
        cancelText: t('confirm.btn.cancel')
      }
    );

    if (!confirm) return;

    const results = await Promise.all([...oldFiles, ...duplicateFiles].map(file => window.api.deleteFile(file.path)))
    filesCache.delete(state.currentProduct);

    utils.showSuccessMessage(
      t('message.app.deleteAllFirmware.success')
        .replace('{{count}}', `${results.filter(r => r.success).length}`)
    );

  } catch (error) {
    utils.showErrorMessage(t('message.error.UNKNOWN'));
    console.error(error);
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
};

// Main initialization
document.addEventListener("DOMContentLoaded", async () => {
  loadDevices()
  initEventListeners();
});