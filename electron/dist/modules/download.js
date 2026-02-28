"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DownloadManager = void 0;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = require("path");
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const uuid_1 = require("uuid");
const userData_1 = require("./userData");
const dns_1 = __importDefault(require("dns"));
class DownloadManager {
    mainWindow;
    activeTasks = new Map();
    queuedTasks = [];
    downloadedFiles = new Set();
    maxConcurrentDownloads = 2;
    stuckCheckInterval = 15000; // Tăng lên 15s
    stuckCheckTimer;
    networkCheckTimer;
    isOnline = true;
    constructor(mainWindow, maxConcurrent = 3) {
        this.mainWindow = mainWindow;
        this.maxConcurrentDownloads = maxConcurrent;
        this.startStuckCheckMonitor();
        this.startNetworkMonitor();
    }
    // ===== NETWORK MONITORING =====
    startNetworkMonitor() {
        this.networkCheckTimer = setInterval(() => {
            this.checkNetworkStatus();
        }, 5000);
    }
    async checkNetworkStatus() {
        try {
            // Thử resolve DNS để kiểm tra kết nối
            await new Promise((resolve, reject) => {
                dns_1.default.resolve('www.google.com', (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            // Nếu trước đó offline, bây giờ online
            if (!this.isOnline) {
                console.log('[Network] Connection restored');
                this.isOnline = true;
                this.handleNetworkRestored();
            }
        }
        catch (error) {
            // Nếu trước đó online, bây giờ offline
            if (this.isOnline) {
                console.log('[Network] Connection lost');
                this.isOnline = false;
                this.handleNetworkLost();
            }
        }
    }
    handleNetworkLost() {
        console.log('[Network] Pausing all active downloads due to network loss');
        this.activeTasks.forEach((task) => {
            if (task.progress.status === 'downloading' && task.mode === 'node') {
                task.progress.status = 'paused';
                task.progress.pausedByNetwork = true;
                if (task.controller) {
                    task.controller.abort();
                }
                if (task.stream) {
                    task.stream.end();
                }
                // Gửi thông báo đến frontend
                this.mainWindow.webContents.send('download-network-lost', {
                    device: task.request.device,
                    downloadId: task.id,
                    fileName: task.request.fileName,
                });
                this.sendProgress(task.progress);
            }
        });
    }
    handleNetworkRestored() {
        console.log('[Network] Resuming downloads after network restoration');
        this.activeTasks.forEach((task) => {
            if (task.progress.status === 'paused' && task.progress.pausedByNetwork) {
                task.progress.status = 'downloading';
                task.progress.pausedByNetwork = false;
                // Gửi thông báo đến frontend
                this.mainWindow.webContents.send('download-network-restored', {
                    device: task.request.device,
                    downloadId: task.id,
                    fileName: task.request.fileName,
                });
                // Tiếp tục tải từ vị trí hiện tại
                const resumeFrom = task.progress.downloadedSize;
                this.downloadWithNode(task, resumeFrom);
            }
        });
    }
    // ===== STUCK CHECK WITH AUTO RETRY =====
    startStuckCheckMonitor() {
        this.stuckCheckTimer = setInterval(() => {
            const now = Date.now();
            this.activeTasks.forEach((task) => {
                // Không kiểm tra stuck cho IDM
                if (task.options.useIDM)
                    return;
                if (task.progress.status !== 'downloading')
                    return;
                const timeSinceLastCheck = now - task.lastSizeCheck;
                if (timeSinceLastCheck >= this.stuckCheckInterval) {
                    // Kiểm tra xem file có thay đổi không
                    if (task.lastSize === task.progress.downloadedSize) {
                        // File không thay đổi
                        // Kiểm tra xem có kết nối mạng không
                        if (this.isOnline) {
                            // Có mạng nhưng file không tải tiếp
                            // => Retry: hủy và tải lại từ byte hiện tại
                            console.log(`[Retry] Download stuck for ${task.request.fileName}, retrying from byte ${task.progress.downloadedSize}`);
                            this.retryDownload(task);
                        }
                        else {
                            // Không có mạng => đã được xử lý bởi network monitor
                            console.log(`[Stuck] Download paused due to network loss: ${task.request.fileName}`);
                        }
                    }
                    else {
                        // File đang thay đổi bình thường
                        task.lastSize = task.progress.downloadedSize;
                        task.lastSizeCheck = now;
                    }
                }
            });
        }, this.stuckCheckInterval);
    }
    retryDownload(task) {
        // Hủy kết nối hiện tại
        if (task.controller) {
            task.controller.abort();
        }
        if (task.stream) {
            task.stream.end();
        }
        // Reset retry count nếu cần
        if (!task.retryCount) {
            task.retryCount = 0;
        }
        task.retryCount++;
        // Giới hạn số lần retry
        if (task.retryCount > 5) {
            this.handleDownloadError(task, 'Download failed after multiple retries');
            return;
        }
        // Gửi thông báo retry đến frontend
        this.mainWindow.webContents.send('download-retrying', {
            device: task.request.device,
            downloadId: task.id,
            fileName: task.request.fileName,
            retryCount: task.retryCount,
            resumeFrom: task.progress.downloadedSize,
        });
        // Reset stuck check timer
        task.lastSize = task.progress.downloadedSize;
        task.lastSizeCheck = Date.now();
        // Tải lại từ byte hiện tại
        console.log(`[Retry] Attempt ${task.retryCount}: Resuming from byte ${task.progress.downloadedSize}`);
        this.downloadWithNode(task, task.progress.downloadedSize);
    }
    // ===== DOWNLOAD METHODS =====
    async download(request, options = {}) {
        const mergedOptions = {
            maxRedirects: 5,
            fileStableCheckInterval: 2000,
            fileStableCheckCount: 3,
            ...options,
        };
        const filePath = (0, path_1.join)(request.path, request.fileName);
        let resumeFrom = 0;
        if ((0, fs_1.existsSync)(filePath)) {
            const fileKey = this.getFileKey(request);
            if (request.continue) {
                try {
                    const stats = await fs_1.promises.stat(filePath);
                    resumeFrom = stats.size;
                    console.log(`[Resume] File exists with size: ${resumeFrom} bytes, continuing download...`);
                    this.downloadedFiles.delete(fileKey);
                }
                catch (err) {
                    console.error('[Resume] Error reading file size:', err);
                    return 'file-read-error';
                }
            }
            else {
                if (this.downloadedFiles.has(fileKey)) {
                    return 'already-downloaded';
                }
                return 'file-exists';
            }
        }
        if (!request.continue) {
            const isDownloading = this.isFileDownloading(request);
            if (isDownloading) {
                return 'already-downloading';
            }
        }
        if (request.priority) {
            this.removeFromQueue(request);
            if (this.activeTasks.size >= this.maxConcurrentDownloads) {
                const nonPriorityTask = this.findNonPriorityTask();
                if (nonPriorityTask) {
                    this.pauseAndQueueTask(nonPriorityTask);
                }
            }
            return this.startDownload(request, mergedOptions, resumeFrom);
        }
        if (this.activeTasks.size >= this.maxConcurrentDownloads) {
            const isInQueue = this.queuedTasks.some(task => this.isSameFile(task.request, request));
            if (isInQueue) {
                console.log(`File is already in queue: ${request.fileName}`);
                return 'already-in-queue';
            }
            this.queuedTasks.push({ request, options: mergedOptions });
            return 'queued';
        }
        return this.startDownload(request, mergedOptions, resumeFrom);
    }
    async startDownload(request, options, resumeFrom = 0) {
        const downloadId = (0, uuid_1.v4)();
        const filePath = (0, path_1.join)(request.path, request.fileName);
        await (0, userData_1.ensureDir)(filePath);
        const task = {
            id: downloadId,
            request,
            options,
            progress: {
                downloadId,
                url: request.firmware.url,
                fileName: request.fileName,
                filePath,
                totalSize: 0,
                downloadedSize: resumeFrom,
                progress: 0,
                speed: 0,
                status: 'downloading',
                isResuming: resumeFrom > 0,
                pausedByNetwork: false,
            },
            lastSize: resumeFrom,
            lastSizeCheck: Date.now(),
            redirectCount: 0,
            resumeFrom,
            retryCount: 0,
            mode: options.useIDM && options.IDMPath && !request.continue ? 'idm' : 'node'
        };
        this.activeTasks.set(downloadId, task);
        if (resumeFrom > 0) {
            console.log(`[Resume] Starting download from byte ${resumeFrom}`);
            this.mainWindow.webContents.send('download-resuming', {
                device: request.device,
                downloadId,
                fileName: request.fileName,
                resumeFrom,
            });
        }
        await (task.mode === 'node' ? this.downloadWithNode(task, resumeFrom) : this.downloadWithIDM(task));
        return downloadId;
    }
    async downloadWithNode(task, resumeFrom = 0) {
        const { request, progress, options } = task;
        if (resumeFrom === 0 && task.resumeFrom > 0) {
            resumeFrom = task.resumeFrom;
        }
        task.controller = new AbortController();
        const protocol = progress.url.startsWith('https') ? https_1.default : http_1.default;
        const fileStream = (0, fs_1.createWriteStream)(progress.filePath, resumeFrom > 0 ? { flags: 'a' } : { flags: 'w' });
        task.stream = fileStream;
        let startTime = Date.now();
        let lastDownloadedSize = resumeFrom;
        const requestOptions = {
            signal: task.controller.signal,
        };
        if (resumeFrom > 0) {
            requestOptions.headers = { Range: `bytes=${resumeFrom}-` };
            console.log(`[Resume] Requesting bytes from ${resumeFrom}`);
        }
        const req = protocol.get(progress.url, requestOptions, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307 || response.statusCode === 308) {
                const redirectUrl = response.headers.location;
                if (!redirectUrl) {
                    this.handleDownloadError(task, 'Redirect without location header');
                    return;
                }
                if (task.redirectCount >= (options.maxRedirects || 5)) {
                    this.handleDownloadError(task, 'Too many redirects');
                    return;
                }
                task.redirectCount++;
                progress.url = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, progress.url).toString();
                fileStream.close();
                this.downloadWithNode(task, resumeFrom);
                return;
            }
            const expectedStatus = resumeFrom > 0 ? 206 : 200;
            if (response.statusCode !== expectedStatus && response.statusCode !== 200) {
                if (resumeFrom > 0 && response.statusCode !== 200) {
                    this.handleDownloadError(task, `Server does not support resume (HTTP ${response.statusCode})`);
                    return;
                }
                this.handleDownloadError(task, `HTTP Error: ${response.statusCode}`);
                return;
            }
            if (resumeFrom > 0 && response.statusCode === 206) {
                const contentRange = response.headers['content-range'];
                if (contentRange) {
                    const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
                    if (match) {
                        progress.totalSize = parseInt(match[1], 10);
                        console.log(`[Resume] Total file size: ${progress.totalSize} bytes`);
                    }
                }
            }
            else {
                progress.totalSize = parseInt(response.headers['content-length'] || '0', 10);
            }
            if (resumeFrom > 0 && response.statusCode === 200) {
                console.log('[Resume] Server does not support resume, starting from beginning');
                fileStream.close();
                task.resumeFrom = 0;
                progress.isResuming = false;
                this.downloadWithNode(task, 0);
                return;
            }
            progress.downloadedSize = resumeFrom;
            response.on('data', (chunk) => {
                if (task.progress.status !== 'downloading')
                    return;
                progress.downloadedSize += chunk.length;
                progress.progress = progress.totalSize > 0
                    ? (progress.downloadedSize / progress.totalSize) * 100
                    : 0;
                const currentTime = Date.now();
                const timeDiff = (currentTime - startTime) / 1000;
                if (timeDiff > 0.5) {
                    const sizeDiff = progress.downloadedSize - lastDownloadedSize;
                    progress.speed = sizeDiff / timeDiff;
                    startTime = currentTime;
                    lastDownloadedSize = progress.downloadedSize;
                    // Cập nhật lastSize và lastSizeCheck để stuck monitor biết
                    task.lastSize = progress.downloadedSize;
                    task.lastSizeCheck = currentTime;
                    this.sendProgress(progress);
                }
            });
            response.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                if (task.progress.status === 'downloading') {
                    this.handleDownloadComplete(task);
                }
            });
            fileStream.on('error', (err) => {
                if (task.progress.status !== 'cancelled') {
                    this.handleDownloadError(task, `File write error: ${err.message}`);
                }
            });
        });
        req.on('error', (err) => {
            if (err.name !== 'AbortError' && task.progress.status !== 'cancelled') {
                // Không báo lỗi ngay, để stuck monitor xử lý retry
                console.log(`[Network] Request error: ${err.message}`);
            }
        });
    }
    async downloadWithIDM(task) {
        const { request, options, progress } = task;
        if (!options.IDMPath) {
            this.handleDownloadError(task, 'IDM path not specified');
            return;
        }
        const args = [
            '/d', progress.url,
            '/p', request.path,
            '/f', request.fileName,
            '/n',
        ];
        this.setupFolderWatcher(task);
        const idmProcess = (0, child_process_1.spawn)(options.IDMPath, args);
        task.idmProcess = idmProcess;
        idmProcess.on('exit', (code) => {
            if (code !== 0 && task.progress.status !== 'cancelled') {
                console.log(`IDM exited with code ${code}`);
            }
        });
        idmProcess.on('error', (err) => {
            this.cleanupFolderWatcher(task);
            this.handleDownloadError(task, `IDM error: ${err.message}`);
        });
    }
    setupFolderWatcher(task) {
        const { request, progress, options } = task;
        const targetFileName = request.fileName;
        const targetFolder = request.path;
        try {
            task.folderWatcher = (0, fs_1.watch)(targetFolder, (eventType, filename) => {
                if (eventType === 'rename' && filename) {
                    const filePath = (0, path_1.join)(targetFolder, filename);
                    if (filename.endsWith('.ipsw') && filename === targetFileName) {
                        setTimeout(async () => {
                            if ((0, fs_1.existsSync)(filePath)) {
                                try {
                                    const stats = await fs_1.promises.stat(filePath);
                                    if (stats.size > 0) {
                                        console.log(`Detected file: ${filename}, starting stability check...`);
                                        this.startFileStabilityCheck(task, filePath);
                                    }
                                }
                                catch (err) {
                                    console.error('Error checking file:', err);
                                }
                            }
                        }, 1000);
                    }
                }
            });
            task.folderWatcher.on('error', (err) => {
                console.error('Folder watcher error:', err);
                this.cleanupFolderWatcher(task);
                this.handleDownloadError(task, `Folder monitoring error: ${err.message}`);
            });
        }
        catch (err) {
            this.handleDownloadError(task, `Failed to setup folder watcher: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    }
    cleanupFolderWatcher(task) {
        if (task.folderWatcher) {
            try {
                task.folderWatcher.close();
                task.folderWatcher = undefined;
            }
            catch (err) {
                console.error('Error closing folder watcher:', err);
            }
        }
        if (task.fileStabilityChecker) {
            clearTimeout(task.fileStabilityChecker);
            task.fileStabilityChecker = undefined;
        }
    }
    async startFileStabilityCheck(task, filePath) {
        const { options, progress } = task;
        const checkInterval = options.fileStableCheckInterval || 2000;
        const totalSize = task.request.firmware.filesize;
        let previousSize = 0;
        const checkStability = async () => {
            if (!(0, fs_1.existsSync)(filePath)) {
                console.error('File disappeared during stability check');
                this.handleDownloadError(task, 'File disappeared during processing');
                return;
            }
            try {
                const stats = await fs_1.promises.stat(filePath);
                const currentSize = stats.size;
                if (currentSize === previousSize && currentSize > 0) {
                    if (currentSize === totalSize) {
                        progress.downloadedSize = currentSize;
                        progress.totalSize = currentSize;
                        progress.progress = 100;
                        this.cleanupFolderWatcher(task);
                        this.handleDownloadComplete(task);
                        return;
                    }
                }
                else {
                    previousSize = currentSize;
                    progress.downloadedSize = currentSize;
                    progress.totalSize = totalSize;
                    progress.progress = Math.round((currentSize / totalSize) * 100);
                    progress.status = 'downloading';
                    this.sendProgress(progress);
                }
                task.fileStabilityChecker = setTimeout(checkStability, checkInterval);
            }
            catch (err) {
                console.error('[Backend] Error during stability check:', err);
                this.handleDownloadError(task, `Stability check error: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
        };
        try {
            const stats = await fs_1.promises.stat(filePath);
            previousSize = stats.size;
            task.fileStabilityChecker = setTimeout(checkStability, checkInterval);
        }
        catch (err) {
            console.error('[Backend] Error starting stability check:', err);
            this.handleDownloadError(task, 'Failed to start stability check');
        }
    }
    // ===== HELPER METHODS =====
    findNonPriorityTask() {
        for (const task of this.activeTasks.values()) {
            if (!task.request.priority) {
                return task;
            }
        }
        return undefined;
    }
    pauseAndQueueTask(task) {
        console.log(`Pausing non-priority task: ${task.request.fileName}`);
        if (task.controller) {
            task.controller.abort();
        }
        if (task.stream) {
            task.stream.end();
        }
        if (task.idmProcess) {
            task.idmProcess.kill();
        }
        this.cleanupFolderWatcher(task);
        this.queuedTasks.unshift({
            request: task.request,
            options: task.options,
        });
        this.activeTasks.delete(task.id);
    }
    removeFromQueue(request) {
        const initialLength = this.queuedTasks.length;
        this.queuedTasks = this.queuedTasks.filter(task => !this.isSameFile(task.request, request));
        if (this.queuedTasks.length < initialLength) {
            console.log(`Removed ${request.fileName} from queue`);
        }
    }
    pauseDownload(downloadId) {
        const task = this.activeTasks.get(downloadId);
        if (!task || task.progress.status !== 'downloading')
            return;
        task.progress.status = 'paused';
        if (task.controller) {
            task.controller.abort();
        }
        if (task.stream) {
            task.stream.end();
        }
        if (task.idmProcess) {
            task.idmProcess.kill('SIGSTOP');
        }
        this.sendProgress(task.progress);
    }
    resumeDownload(downloadId) {
        const task = this.activeTasks.get(downloadId);
        if (!task || task.progress.status !== 'paused')
            return;
        task.progress.status = 'downloading';
        task.progress.pausedByNetwork = false;
        if (task.options.useIDM && task.idmProcess) {
            task.idmProcess.kill('SIGCONT');
        }
        else {
            const resumeFrom = task.progress.downloadedSize;
            this.downloadWithNode(task, resumeFrom);
        }
        this.sendProgress(task.progress);
    }
    cancelDownload(downloadId) {
        const task = this.activeTasks.get(downloadId);
        if (!task)
            return;
        task.progress.status = 'cancelled';
        if (task.controller) {
            task.controller.abort();
        }
        if (task.stream) {
            task.stream.destroy();
        }
        if (task.idmProcess) {
            task.idmProcess.kill();
        }
        this.cleanupFolderWatcher(task);
        if ((0, fs_1.existsSync)(task.progress.filePath)) {
            try {
                (0, fs_1.unlinkSync)(task.progress.filePath);
            }
            catch (err) {
                console.error('Failed to remove incomplete file:', err);
            }
        }
        this.sendProgress(task.progress);
        this.activeTasks.delete(downloadId);
        this.processQueue();
    }
    handleDownloadComplete(task) {
        task.progress.status = 'completed';
        task.progress.progress = 100;
        task.progress.isResuming = false;
        task.progress.pausedByNetwork = false;
        this.sendProgress(task.progress);
        this.cleanupFolderWatcher(task);
        const fileKey = this.getFileKey(task.request);
        this.downloadedFiles.add(fileKey);
        console.log(`[Backend] Download completed: ${task.request.fileName}`);
        this.mainWindow.webContents.send('download-complete', {
            downloadId: task.id,
            filePath: task.progress.filePath,
            fileName: task.request.fileName,
            fileSize: task.progress.totalSize,
            request: task.request
        });
        this.activeTasks.delete(task.id);
        this.processQueue();
    }
    handleDownloadError(task, error) {
        if (task.progress.status === 'cancelled')
            return;
        task.progress.status = 'error';
        task.progress.error = error;
        task.progress.isResuming = false;
        task.progress.pausedByNetwork = false;
        this.sendProgress(task.progress);
        this.cleanupFolderWatcher(task);
        console.log(`[Backend] Download error: ${error}`);
        this.mainWindow.webContents.send('download-error', {
            downloadId: task.id,
            error,
            request: task.request
        });
        if (task.stream) {
            task.stream.destroy();
        }
        if (task.idmProcess) {
            task.idmProcess.kill();
        }
        this.activeTasks.delete(task.id);
        this.processQueue();
    }
    sendProgress(progress) {
        this.mainWindow.webContents.send('download-progress', progress);
    }
    processQueue() {
        while (this.activeTasks.size < this.maxConcurrentDownloads && this.queuedTasks.length > 0) {
            const next = this.queuedTasks.shift();
            if (next) {
                this.startDownload(next.request, next.options);
            }
        }
    }
    getActiveDownloads() {
        return Array.from(this.activeTasks.values()).map(task => task.progress);
    }
    cleanup() {
        if (this.stuckCheckTimer) {
            clearInterval(this.stuckCheckTimer);
        }
        if (this.networkCheckTimer) {
            clearInterval(this.networkCheckTimer);
        }
        this.activeTasks.forEach((task) => {
            this.cancelDownload(task.id);
        });
    }
    getFileKey(request) {
        return `${request.path}/${request.fileName}`;
    }
    isFileDownloading(request) {
        const fileKey = this.getFileKey(request);
        for (const task of this.activeTasks.values()) {
            const taskKey = this.getFileKey(task.request);
            if (taskKey === fileKey) {
                return true;
            }
        }
        return false;
    }
    isSameFile(req1, req2) {
        return this.getFileKey(req1) === this.getFileKey(req2);
    }
    clearDownloadedFile(filePath, fileName) {
        const fileKey = `${filePath}/${fileName}`;
        this.downloadedFiles.delete(fileKey);
    }
    clearAllDownloadedFiles() {
        this.downloadedFiles.clear();
    }
    getDownloadedFiles() {
        return Array.from(this.downloadedFiles);
    }
    isFileDownloaded(filePath, fileName) {
        const fileKey = `${filePath}/${fileName}`;
        return this.downloadedFiles.has(fileKey);
    }
}
exports.DownloadManager = DownloadManager;
