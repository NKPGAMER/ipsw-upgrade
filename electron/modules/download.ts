import { spawn } from 'child_process';
import { promises as fs, createWriteStream, existsSync, unlinkSync, watch } from 'fs';
import { join, dirname, basename } from 'path';
import https from 'https';
import http from 'http';
import { BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { ensureDir } from './userData';
import dns from 'dns';

class DownloadManager {
  private mainWindow: BrowserWindow;
  private activeTasks: Map<string, DownloadTask> = new Map();
  private queuedTasks: Array<{ request: DownloadRequest; options: DownloadOptions }> = [];
  private downloadedFiles: Set<string> = new Set();
  private maxConcurrentDownloads: number = 2;
  private stuckCheckInterval: number = 15000; // Tăng lên 15s
  private stuckCheckTimer?: NodeJS.Timeout;
  private networkCheckTimer?: NodeJS.Timeout;
  private isOnline: boolean = true;

  constructor(mainWindow: BrowserWindow, maxConcurrent: number = 3) {
    this.mainWindow = mainWindow;
    this.maxConcurrentDownloads = maxConcurrent;
    this.startStuckCheckMonitor();
    this.startNetworkMonitor();
  }

  // ===== NETWORK MONITORING =====
  private startNetworkMonitor(): void {
    this.networkCheckTimer = setInterval(() => {
      this.checkNetworkStatus();
    }, 5000);
  }

  private async checkNetworkStatus(): Promise<void> {
    try {
      // Thử resolve DNS để kiểm tra kết nối
      await new Promise<void>((resolve, reject) => {
        dns.resolve('www.google.com', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Nếu trước đó offline, bây giờ online
      if (!this.isOnline) {
        console.log('[Network] Connection restored');
        this.isOnline = true;
        this.handleNetworkRestored();
      }
    } catch (error) {
      // Nếu trước đó online, bây giờ offline
      if (this.isOnline) {
        console.log('[Network] Connection lost');
        this.isOnline = false;
        this.handleNetworkLost();
      }
    }
  }

  private handleNetworkLost(): void {
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

  private handleNetworkRestored(): void {
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
  private startStuckCheckMonitor(): void {
    this.stuckCheckTimer = setInterval(() => {
      const now = Date.now();

      this.activeTasks.forEach((task) => {
        // Không kiểm tra stuck cho IDM
        if (task.options.useIDM) return;

        if (task.progress.status !== 'downloading') return;

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
            } else {
              // Không có mạng => đã được xử lý bởi network monitor
              console.log(`[Stuck] Download paused due to network loss: ${task.request.fileName}`);
            }
          } else {
            // File đang thay đổi bình thường
            task.lastSize = task.progress.downloadedSize;
            task.lastSizeCheck = now;
          }
        }
      });
    }, this.stuckCheckInterval);
  }

  private retryDownload(task: DownloadTask): void {
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
  async download(request: DownloadRequest, options: DownloadOptions = {}): Promise<string> {
    const mergedOptions: DownloadOptions = {
      maxRedirects: 5,
      fileStableCheckInterval: 2000,
      fileStableCheckCount: 3,
      ...options,
    };

    const filePath = join(request.path, request.fileName);
    let resumeFrom = 0;

    if (existsSync(filePath)) {
      const fileKey = this.getFileKey(request);

      if (request.continue) {
        try {
          const stats = await fs.stat(filePath);
          resumeFrom = stats.size;

          console.log(`[Resume] File exists with size: ${resumeFrom} bytes, continuing download...`);
          this.downloadedFiles.delete(fileKey);
        } catch (err) {
          console.error('[Resume] Error reading file size:', err);
          return 'file-read-error';
        }
      } else {
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
      const isInQueue = this.queuedTasks.some(task =>
        this.isSameFile(task.request, request)
      );

      if (isInQueue) {
        console.log(`File is already in queue: ${request.fileName}`);
        return 'already-in-queue';
      }

      this.queuedTasks.push({ request, options: mergedOptions });
      return 'queued';
    }

    return this.startDownload(request, mergedOptions, resumeFrom);
  }

  private async startDownload(request: DownloadRequest, options: DownloadOptions, resumeFrom: number = 0): Promise<string> {
    const downloadId = uuidv4();
    const filePath = join(request.path, request.fileName);

    await ensureDir(filePath);

    const task: DownloadTask = {
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

  private async downloadWithNode(task: DownloadTask, resumeFrom: number = 0): Promise<void> {
    const { request, progress, options } = task;

    if (resumeFrom === 0 && task.resumeFrom > 0) {
      resumeFrom = task.resumeFrom;
    }

    task.controller = new AbortController();
    const protocol = progress.url.startsWith('https') ? https : http;

    const fileStream = createWriteStream(progress.filePath,
      resumeFrom > 0 ? { flags: 'a' } : { flags: 'w' }
    );
    task.stream = fileStream;

    let startTime = Date.now();
    let lastDownloadedSize = resumeFrom;

    const requestOptions: any = {
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
      } else {
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
        if (task.progress.status !== 'downloading') return;

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

  private async downloadWithIDM(task: DownloadTask): Promise<void> {
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

    const idmProcess = spawn(options.IDMPath, args);
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

  private setupFolderWatcher(task: DownloadTask): void {
    const { request, progress, options } = task;
    const targetFileName = request.fileName;
    const targetFolder = request.path;

    try {
      task.folderWatcher = watch(targetFolder, (eventType, filename) => {
        if (eventType === 'rename' && filename) {
          const filePath = join(targetFolder, filename);

          if (filename.endsWith('.ipsw') && filename === targetFileName) {
            setTimeout(async () => {
              if (existsSync(filePath)) {
                try {
                  const stats = await fs.stat(filePath);

                  if (stats.size > 0) {
                    console.log(`Detected file: ${filename}, starting stability check...`);
                    this.startFileStabilityCheck(task, filePath);
                  }
                } catch (err) {
                  console.error('Error checking file:', err);
                }
              }
            }, 1000);
          }
        }
      });

      task.folderWatcher.on('error', (err: any) => {
        console.error('Folder watcher error:', err);
        this.cleanupFolderWatcher(task);
        this.handleDownloadError(task, `Folder monitoring error: ${err.message}`);
      });

    } catch (err) {
      this.handleDownloadError(task, `Failed to setup folder watcher: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  private cleanupFolderWatcher(task: DownloadTask): void {
    if (task.folderWatcher) {
      try {
        task.folderWatcher.close();
        task.folderWatcher = undefined;
      } catch (err) {
        console.error('Error closing folder watcher:', err);
      }
    }

    if (task.fileStabilityChecker) {
      clearTimeout(task.fileStabilityChecker);
      task.fileStabilityChecker = undefined;
    }
  }

  private async startFileStabilityCheck(task: DownloadTask, filePath: string): Promise<void> {
    const { options, progress } = task;
    const checkInterval = options.fileStableCheckInterval || 2000;
    const totalSize = task.request.firmware.filesize;

    let previousSize = 0;

    const checkStability = async () => {
      if (!existsSync(filePath)) {
        console.error('File disappeared during stability check');
        this.handleDownloadError(task, 'File disappeared during processing');
        return;
      }

      try {
        const stats = await fs.stat(filePath);
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
        } else {
          previousSize = currentSize;
          progress.downloadedSize = currentSize;
          progress.totalSize = totalSize;
          progress.progress = Math.round((currentSize / totalSize) * 100)
          progress.status = 'downloading';
          this.sendProgress(progress);
        }

        task.fileStabilityChecker = setTimeout(checkStability, checkInterval);
      } catch (err) {
        console.error('[Backend] Error during stability check:', err);
        this.handleDownloadError(task, `Stability check error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    };

    try {
      const stats = await fs.stat(filePath);
      previousSize = stats.size;
      task.fileStabilityChecker = setTimeout(checkStability, checkInterval);
    } catch (err) {
      console.error('[Backend] Error starting stability check:', err);
      this.handleDownloadError(task, 'Failed to start stability check');
    }
  }

  // ===== HELPER METHODS =====
  private findNonPriorityTask(): DownloadTask | undefined {
    for (const task of this.activeTasks.values()) {
      if (!task.request.priority) {
        return task;
      }
    }
    return undefined;
  }

  private pauseAndQueueTask(task: DownloadTask): void {
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

  private removeFromQueue(request: DownloadRequest): void {
    const initialLength = this.queuedTasks.length;
    this.queuedTasks = this.queuedTasks.filter(
      task => !this.isSameFile(task.request, request)
    );

    if (this.queuedTasks.length < initialLength) {
      console.log(`Removed ${request.fileName} from queue`);
    }
  }

  pauseDownload(downloadId: string): void {
    const task = this.activeTasks.get(downloadId);
    if (!task || task.progress.status !== 'downloading' || task.idmProcess) return;

    task.progress.status = 'paused';

    if (task.controller) {
      task.controller.abort();
    }

    if (task.stream) {
      task.stream.end();
    }

    this.sendProgress(task.progress);
  }

  resumeDownload(downloadId: string): void {
    const task = this.activeTasks.get(downloadId);
    if (!task || task.progress.status !== 'paused' || task.idmProcess) return;

    task.progress.status = 'downloading';
    task.progress.pausedByNetwork = false;
    const resumeFrom = task.progress.downloadedSize;
    this.downloadWithNode(task, resumeFrom);

    this.sendProgress(task.progress);
  }

  cancelDownload(downloadId: string): void {
    const task = this.activeTasks.get(downloadId);
    if (!task) return;

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

    if (existsSync(task.progress.filePath)) {
      try {
        unlinkSync(task.progress.filePath);
      } catch (err) {
        console.error('Failed to remove incomplete file:', err);
      }
    }

    this.sendProgress(task.progress);
    this.activeTasks.delete(downloadId);
    this.processQueue();
  }

  private handleDownloadComplete(task: DownloadTask): void {
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

  private handleDownloadError(task: DownloadTask, error: string): void {
    if (task.progress.status === 'cancelled') return;

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

  private sendProgress(progress: DownloadProgress): void {
    this.mainWindow.webContents.send('download-progress', progress);
  }

  private processQueue(): void {
    while (this.activeTasks.size < this.maxConcurrentDownloads && this.queuedTasks.length > 0) {
      const next = this.queuedTasks.shift();
      if (next) {
        this.startDownload(next.request, next.options);
      }
    }
  }

  getActiveDownloads(): DownloadProgress[] {
    return Array.from(this.activeTasks.values()).map(task => task.progress);
  }

  cleanup(): void {
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

  private getFileKey(request: DownloadRequest): string {
    return `${request.path}/${request.fileName}`;
  }

  private isFileDownloading(request: DownloadRequest): boolean {
    const fileKey = this.getFileKey(request);

    for (const task of this.activeTasks.values()) {
      const taskKey = this.getFileKey(task.request);
      if (taskKey === fileKey) {
        return true;
      }
    }

    return false;
  }

  private isSameFile(req1: DownloadRequest, req2: DownloadRequest): boolean {
    return this.getFileKey(req1) === this.getFileKey(req2);
  }

  clearDownloadedFile(filePath: string, fileName: string): void {
    const fileKey = `${filePath}/${fileName}`;
    this.downloadedFiles.delete(fileKey);
  }

  clearAllDownloadedFiles(): void {
    this.downloadedFiles.clear();
  }

  getDownloadedFiles(): string[] {
    return Array.from(this.downloadedFiles);
  }

  isFileDownloaded(filePath: string, fileName: string): boolean {
    const fileKey = `${filePath}/${fileName}`;
    return this.downloadedFiles.has(fileKey);
  }
}

export { DownloadManager, DownloadRequest, DownloadOptions, DownloadProgress };