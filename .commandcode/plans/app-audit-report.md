# IPSW Manager v3.3.2 — Kiểm Tra Toàn Ứng Dụng

## Tổng Quan

Phân tích toàn bộ 3 tầng: **Main Process (Electron)**, **Renderer Process (React)**, và **Build/Distribution Pipeline**.

---

## 🔴 CRITICAL — Có Thể Crash Ứng Dụng

### 1. Worker thread crash → UI treo vĩnh viễn
**File:** `electron/downloader-main.ts:43-71`

Khi worker thread crash, `this.pending` Map chứa các promise đang chờ không bị reject. Renderer gọi `dm:add` sẽ **await mãi mãi** — UI đơ cứng, không hồi phục.

### 2. Rò rỉ file descriptor trong ChunkManager
**File:** `electron/modules/downloader/chunk-manager.ts:284-319`

`fs.openSync()` ở dòng 284 mở fd, nhưng nếu code giữa dòng 284 và `try` (dòng 310) throw (fallocate fail, statfs fail, mkdir fail), fd **không bao giờ đóng**. Với app chạy lâu, hết file descriptor → crash.

### 3. Race condition trong StateManager — mất dữ liệu chunk
**File:** `electron/modules/downloader/state-manager.ts`

`updateChunk()` và `addMovedChunk()` cùng dùng pattern `load → mutate → save` không atomic. Khi `IOWriteQueue.moveChunk()` gọi đồng thời với `batchUpdateChunks()`, một lần save ghi đè lần kia → **mất tiến trình download**.

### 4. autoUpdater không có error handler → crash process
**File:** `electron/main.ts:179-205`

```ts
function initAutoUpdater() {
  autoUpdater.on("update-available", ...);
  autoUpdater.on("update-downloaded", ...);
  // THIẾU: autoUpdater.on("error", ...)
  setTimeout(() => autoUpdater.checkForUpdates(), 6000);
}
```

EventEmitter không có `error` listener → Node throw unhandled error → **crash toàn bộ app** khi có lỗi mạng/signature.

### 5. Không có `process.on("unhandledRejection")`
**File:** `electron/main.ts` (thiếu hoàn toàn)

Bất kỳ promise rejection nào không được catch trong main process → **crash app trong Node 15+ / Electron hiện đại**.

### 6. splash.html không có trong bản build production
**File:** `package.json` → `build.files`

```json
"files": ["dist/**/*", "electron/dist/**/*", ...]
// splash.html nằm ở thư mục gốc — KHÔNG được include
```

Trong production, `win.loadFile("splash.html")` sẽ fail → splash window trắng/lỗi.

### 7. Không có Error Boundary trong React
**Toàn bộ `src/`**

Một lỗi không catch trong bất kỳ component nào → **màn hình trắng toàn bộ app**. Không có fallback UI.

---

## 🟠 HIGH — Ảnh Hưởng Nghiêm Trọng Đến Trải Nghiệm

### 8. IPC listener leak trong IPSWUpdateManager
**File:** `src/ui/IPSWUpdateManager.tsx:~652`

```ts
subsRef.current = subs; // Ghi đè mà KHÔNG unsubscribe cái cũ
```

Gọi `handleStart` lần 2 → listener cũ vẫn chạy, nhân đôi xử lý, rò rỉ bộ nhớ.

### 9. IPSWClient listener leak trong SelectDevice
**File:** `src/ui/SelectDevice.tsx`

```ts
useEffect(() => {
  ipswClient.onReload(() => setAllFiles(ipswClient.getFiles()));
  // unsubscribe không được lưu, không được gọi khi unmount
}, []);
```

Mỗi lần component remount → thêm 1 listener vào Set, không bao giờ xóa.

### 10. scanFolder() dùng sync I/O → freeze UI
**File:** `electron/modules/ipsw/localFile.ts:5-14`

`readdirSync` + `statSync` (gọi N lần cho N file) chặn event loop. Với 50+ file IPSW trên ổ chậm → UI đơ.

### 11. cleanFileInvalid() không bao giờ được gọi
**File:** `electron/modules/ipsw/cleanup.ts:127-142`

Method có sẵn để xóa file zero-byte/invalid nhưng **không được gọi ở đâu**. Config `removeInvalidFile` vô tác dụng.

### 12. Promise.all rejection không được xử lý trong IPSWWatcher
**File:** `electron/modules/ipsw/ipswWatcher.ts:170,186`

```ts
// Gọi với void → bỏ qua promise rejection
this.watcher.on("add", (filePath) => void this.onAdded(filePath));
```

Nếu callback throw → unhandled rejection.

### 13. Serial device enumeration block hàng phút
**File:** `electron/modules/ipsw/ipswHardLinkManager.ts:286-309`

Duyệt tất cả device (hàng trăm) tuần tự với `await` → lần đầu build cache rất chậm.

### 14. usb package không dùng nhưng vẫn trong dependencies
`usb@^2.17.0` có trong `dependencies` nhưng **không file nào import**. Là native C++ addon (~5-10MB), nếu load từ ASAR sẽ crash.

---

## 🟡 MEDIUM — Vấn Đề Tiềm Ẩn

### 15. getIncompleteTasks() throw khi state file bị hỏng
**File:** `electron/modules/downloader/downloader.ts:445-463`

`fs.existsSync(s.tmpPath)` — nếu `tmpPath` undefined (file state hỏng) → throw sync.

### 16. IPC store handler không có default case
**File:** `electron/main.ts:205-210`

Method không xác định → `undefined` âm thầm, không log.

### 17. sendToRenderer bỏ lỡ event "log"
**File:** `electron/downloader-main.ts:131-148`

Switch không có `default` → event `"log"` (được emit từ downloader.ts) **bị drop âm thầm**.

### 18. sendMessage() im lặng drop khi window null
**File:** `electron/utils/system.ts:29-33`

Không cảnh báo, không queue — message mất vĩnh viễn.

### 19. Settings page race condition với state.__init
**File:** `src/ui/setting.tsx`

`useEffect([], ...)` check `state.__init` — nếu init chưa xong, settings hiển thị giá trị mặc định và không cập nhật lại.

### 20. Mutable global state object — không reactive
**File:** `src/data.ts`

`state` là plain object, component đọc/ghi tự do không đồng bộ → stale read.

### 21. Hardcoded tiếng Việt khắp nơi
Hầu hết component dùng text tiếng Việt cứng, bỏ qua i18n. `en.json` thiếu nhiều key → người dùng tiếng Anh thấy text tiếng Việt.

### 22. Root tsconfig.json là dead config
Không được dùng bởi bất kỳ script build nào. Renderer do Vite (esbuild) xử lý.

### 23. vite-plugin-electron không dùng
Trong `devDependencies` nhưng không import trong `vite.config.ts`.

---

## 🟢 LOW — Tối Ưu / Cleanup

### 24. Dynamic require("electron") — anti-pattern
**File:** `electron/downloader-main.ts:157-162`

Module luôn chạy trong Electron main process → require fallback là dead code.

### 25. waitForStableFile 15s polling chặn chokidar
**File:** `electron/modules/ipsw/ipswWatcher.ts:236-262`

Thêm 20 file cùng lúc → file cuối xử lý sau 5 phút.

### 26. ToastContainer listener leak khi remount
**File:** `src/ui/Toast.tsx`

Module-level Set giữ listener cũ khi component remount.

### 27. Welcome wizard setTimeout relaunch không cleanup
**File:** `src/ui/welcome.tsx`

Navigate away trước khi timeout chạy → relaunch vẫn xảy ra.

### 28. applyLang() DOM-based là dead code
**File:** `src/core/i18n.ts`

Không component nào dùng `data-t` attribute.

---

## 📊 Tổng Kết Theo Khu Vực

| Khu vực | 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low |
|---------|------------|---------|-----------|--------|
| Main Process | 5 | 4 | 4 | 2 |
| Renderer Process | 1 | 3 | 4 | 3 |
| Build/Distribution | 1 | 1 | 2 | 0 |
| **Tổng** | **7** | **8** | **10** | **5** |

---

## 🎯 Kịch Bản Gặp Vấn Đề

| Trường hợp | Vấn đề xảy ra |
|------------|---------------|
| **Mất mạng khi đang download** | Worker crash → UI treo (#1), autoUpdater crash app (#4) |
| **Download file lớn, ổ gần đầy** | fd leak (#2) + fallocate fail không đóng fd |
| **Download nhiều file cùng lúc** | StateManager race → mất tiến trình (#3) |
| **Restart app khi đang download** | State file hỏng → getIncompleteTasks throw (#15) |
| **Cài app từ installer** | splash.html không có (#6), SmartScreen cảnh báo |
| **Bấm "Start" nhiều lần trong IPSWUpdateManager** | IPC listener leak (#8) |
| **Chuyển qua lại giữa các tab** | IPSWClient listener leak (#9) |
| **Dùng ổ cứng HDD chậm** | scanFolder() freeze UI (#10) |
| **Dùng app với ngôn ngữ tiếng Anh** | Thấy text tiếng Việt (#21) |
| **Mở Settings trước khi app init xong** | Hiển thị sai giá trị (#19) |
| **Copy 20+ file IPSW vào thư mục một lúc** | Xử lý chậm 5 phút (#25) |
| **Thoát app khi đang ở màn hình Welcome** | Relaunch vẫn chạy (#27) |
| **Promise rejection ở bất kỳ đâu trong main** | Crash app (#5) |
| **Lỗi React ở bất kỳ component nào** | Màn hình trắng (#7) |

---

## 🔧 Đề Xuất Sửa (Theo Thứ Tự Ưu Tiên)

1. **Thêm `process.on("unhandledRejection")`** vào main.ts
2. **Thêm `autoUpdater.on("error")`** handler
3. **Thêm Error Boundary** bọc toàn bộ Routes trong React
4. **Reject tất cả pending promises** khi worker exit
5. **Sửa fd leak** trong ChunkManager.start()
6. **Thêm splash.html** vào build files
7. **Xóa package `usb`** khỏi dependencies
8. **Sửa IPC listener leak** trong IPSWUpdateManager
9. **Sửa IPSWClient listener leak** trong SelectDevice
10. **Thêm mutex/lock** vào StateManager
11. **Chuyển scanFolder() sang async**
12. **Gọi cleanFileInvalid()** trong cleanup start
13. **Thêm null check** trong getIncompleteTasks
14. **Sửa i18n**: thêm key tiếng Anh, thay text cứng bằng `t()`
