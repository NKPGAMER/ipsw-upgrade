# Rust Native Addon Spec — File Transfer & Disk Operations

Ba hàm gốc cần thêm vào i10r-addon để thay thế các bottleneck JS hiện tại trong downloader.

---

## 1. `copyRanges` — Turbo Chunk Move SSD→HDD

**Thay thế**: Toàn bộ `IOWriteQueue` trong `chunk-manager.ts`

**Lý do**: File 10GB, chunk 128MB → 80 chunks. Hiện tại mỗi chunk JS pipe: 2× open/close + ~64 `data` events + ~32 event-loop callbacks. Tổng ~5,280 syscalls. Rust dùng 1 cặp fd + `copy_file_range` → ~160 syscalls.

### NAPI Signature

```typescript
export interface CopyRange {
    srcOffset: number   // byte offset in source file
    destOffset: number  // byte offset in dest file (same as srcOffset trong practice)
    byteCount: number   // số byte cần copy
}

export interface CopyRangesOptions {
    /** Tổng kích thước file đích (đã pre-allocated), dùng cho progress % */
    totalSize: number
    /** true = dest là HDD → dùng unbuffered write để tránh cache pollution */
    hddDest: boolean
    /** Gọi sau mỗi range hoàn thành để JS side persist movedChunks */
    onRangeComplete: (index: number) => void
}

export declare function copyRanges(
    src: string,
    dest: string,
    ranges: Array<CopyRange>,
    options: CopyRangesOptions
): string  // returns task id
```

### Implementation

#### Linux — `copy_file_range()` (kernel 4.5+)

```rust
// Mở 1 cặp fd dùng cho tất cả ranges
let src_file = File::open(&src)?;
let dest_file = OpenOptions::new()
    .write(true)
    .custom_flags(if hdd_dest { libc::O_DIRECT } else { 0 })
    .open(&dest)?;

for (i, range) in ranges.iter().enumerate() {
    let mut off_in = range.src_offset as i64;
    let mut off_out = range.dest_offset as i64;
    let mut remaining = range.byte_count as usize;

    while remaining > 0 {
        let n = unsafe {
            libc::copy_file_range(
                src_file.as_raw_fd(),
                &mut off_in,
                dest_file.as_raw_fd(),
                &mut off_out,
                remaining,
                0,
            )
        };
        if n < 0 { return Err(io::Error::last_os_error()); }
        if n == 0 { break; }
        remaining -= n as usize;
        total_copied += n as u64;
    }

    on_range_complete.call(i)?;
    send_progress(total_copied, total_size);
}
```

**Tại sao `copy_file_range`**: Zero-copy trong kernel, dữ liệu không bao giờ vào userspace. Kernel tự xử lý read-ahead cho SSD và write-combining cho HDD. Với `O_DIRECT` trên HDD dest, bypass page cache hoàn toàn.

#### Windows — `ReadFile` + `WriteFile` với unbuffered I/O

```rust
// FILE_FLAG_NO_BUFFERING | FILE_FLAG_WRITE_THROUGH
const NO_BUFFERING: u32 = 0x20000000;
const WRITE_THROUGH: u32 = 0x80000000;

let src_handle = CreateFileW(src, GENERIC_READ, ...);
let dest_handle = CreateFileW(
    dest, GENERIC_WRITE, ...,
    if hdd_dest { NO_BUFFERING | WRITE_THROUGH } else { FILE_ATTRIBUTE_NORMAL }
);

// Dùng aligned buffer (multiple of sector size, thường 512 hoặc 4096)
let sector_size = get_sector_size(dest)?;
let buf = aligned_buffer(sector_size, max_chunk);

for range in ranges.iter() {
    copy_range_windows(src_handle, dest_handle, range, &buf)?;
    on_range_complete.call(i)?;
}
```

**Lưu ý**: `NO_BUFFERING` yêu cầu buffer và offset phải aligned với sector size. Cần detect `dwSectorsPerPhysicalSector` từ `GetDiskFreeSpaceW`.

#### macOS — `fcopyfile` không hỗ trợ range offset

macOS phải fallback về `pread` + `pwrite` loop với buffer 16MB. Không có syscall kernel-level cho range-based copy. Vẫn nhanh hơn JS nhờ bỏ qua V8/N-API overhead nhưng không đạt tốc độ kernel-level như Linux.

```rust
let buf = vec![0u8; 16 * 1024 * 1024]; // 16MB stack-allocated possible too
for range in ranges.iter() {
    let mut remaining = range.byte_count;
    let mut off_in = range.src_offset;
    let mut off_out = range.dest_offset;
    while remaining > 0 {
        let n = pread(src_fd, &mut buf, off_in)?;
        pwrite(dest_fd, &buf[..n], off_out)?;
        off_in += n as u64;
        off_out += n as u64;
        remaining -= n as u64;
    }
}
```

### Progress callback

Dùng cơ chế `onTransferProgress` đã có sẵn — truyền `TransferProgress` qua NAPI channel. JS side chỉ cần `onTransferProgress(cb)` một lần khi app khởi động, không cần thay đổi gì.

### Thay đổi JS side

```typescript
// chunk-manager.ts — IOWriteQueue bị xóa hoàn toàn
// Thay bằng:
const ranges: CopyRange[] = completedChunks.map(c => ({
    srcOffset: c.start,
    destOffset: c.start,
    byteCount: c.end - c.start + 1,
}));

const taskId = native.copyRanges(tmpPath, turboPath, ranges, {
    totalSize: state.totalSize,
    hddDest: isHDD,
    onRangeComplete: (index) => {
        this.stateManager.addMovedChunk(stateId, index);
    },
});
```

---

## 2. `copyLargeFile` — Move Toàn Bộ File SSD→HDD

**Thay thế**: `MoveQueue.copyViaKernel` trong `downloader.ts`

**Lý do**: Cross-device move 10GB. JS `copyViaKernel` đọc 128MB buffer → ghi HDD → lặp. Chỉ dùng 1 thiết bị I/O mỗi thời điểm. Rust dùng syscall hỗ trợ kernel-level DMA giữa 2 device.

### NAPI Signature

```typescript
export interface LargeCopyOptions {
    /** Kích thước file nguồn (bytes) */
    fileSize: number
    /** true = dest HDD → unbuffered write */
    hddDest: boolean
    /** true = xóa file nguồn sau khi copy thành công (để làm rename semantics) */
    deleteSource: boolean
    /** Đường dẫn file nguồn chưa resolve */
    src: string
    /** Đường dẫn file đích chưa resolve */
    dest: string
}

export declare function copyLargeFile(options: LargeCopyOptions): string  // returns task id
```

### Implementation

#### Linux — `copy_file_range` cho toàn bộ file

```rust
let src_file = File::open(&src)?;
let total = src_file.metadata()?.len();

let dest_file = OpenOptions::new()
    .write(true)
    .create(true)
    .truncate(true)
    .custom_flags(if hdd_dest { libc::O_DIRECT } else { 0 })
    .open(&dest)?;

let mut off_in: i64 = 0;
let mut off_out: i64 = 0;
let mut copied: u64 = 0;

while copied < total {
    let chunk = min(total - copied, 64 * 1024) as usize; // copy_file_range hiệu quả với chunk nhỏ
    let n = unsafe {
        libc::copy_file_range(
            src_file.as_raw_fd(),
            &mut off_in,
            dest_file.as_raw_fd(),
            &mut off_out,
            chunk,
            0,
        )
    };
    if n < 0 { return Err(io::Error::last_os_error()); }
    if n == 0 { break; }
    copied += n as u64;
    send_progress(copied, total);
}

if delete_source { std::fs::remove_file(&src)?; }
```

#### Windows — `CopyFileExW`

```rust
let flags = if hdd_dest {
    COPY_FILE_NO_BUFFERING | COPY_FILE_NO_OFFLOAD
} else {
    0
};

// Progress callback cho CopyFileExW
unsafe extern "system" fn copy_progress(
    total_size: i64, total_transferred: i64,
    _stream_size: i64, _stream_transferred: i64,
    _reason: u32, _src: *const u16, _dst: *const u16,
    data: *mut c_void,
) -> i32 {
    // Send progress via NAPI channel
    // data là con trỏ đến task_id
    send_napi_progress(total_transferred as u64, total_size as u64);
    0 // PROGRESS_CONTINUE
}

CopyFileExW(src_wide, dest_wide, Some(copy_progress), &task_id, &mut cancel, flags)?;
if delete_source { DeleteFileW(src_wide)?; }
```

#### macOS — `fcopyfile` hoặc `clonefile`

```rust
// Thử CoW clone trước (cùng APFS volume)
if unsafe { clonefile(src, dest, 0) } == 0 {
    if delete_source { std::fs::remove_file(src)?; }
    return; // instant — no data copy
}

// Cross-volume — fcopyfile
unsafe {
    fcopyfile(src, dest, ptr::null(), COPYFILE_ALL | COPYFILE_NOFOLLOW)?;
}
if delete_source { std::fs::remove_file(src)?; }
```

### Thay đổi JS side

```typescript
// downloader.ts — MoveQueue.doMove()
// Thay toàn bộ copyViaKernel bằng:
private async doMove(src: string, dest: string, onProgress?: (...) => void): Promise<void> {
    try {
        fs.renameSync(src, dest); // same-device — atomic
        onProgress?.({ pct: 100, speed: 0, eta: 0 });
        return;
    } catch { /* cross-device */ }

    // Dùng Rust native copy
    const taskId = native.copyLargeFile({
        src, dest,
        fileSize: fs.statSync(src).size,
        hddDest: isHDD,
        deleteSource: true,
    });

    // Await completion qua onTransferResult
    await waitForTransferResult(taskId);
}
```

---

## 3. `preallocateFile` — Pre-allocate Không Zero-fill

**Thay thế**: Các site gọi `fs.ftruncate(fd, size)` trong `downloader.ts` và `chunk-manager.ts`

**Lý do**: `ftruncate` trên một số filesystem (ext4, NTFS không sparse) sẽ zero-fill toàn bộ file. Với 10GB × batch, zero-fill tốn hàng chục giây. Syscall gốc (`fallocate`, `SetFileValidData`) allocate metadata-only.

### NAPI Signature

```typescript
export interface PreallocateOptions {
    /** Đường dẫn file */
    path: string
    /** Kích thước cần pre-allocate (bytes) */
    size: number
    /** 
     * true = bỏ qua zero-fill nếu OS hỗ trợ.
     * false = fallback về zero-fill an toàn (giống ftruncate).
     */
    skipZeroFill: boolean
}

/** 
 * Trả về true nếu pre-allocate thành công (có hoặc không zero-fill).
 * Trả về false nếu skipZeroFill=true nhưng không thể thực hiện → caller tự fallback về ftruncate.
 */
export declare function preallocateFile(options: PreallocateOptions): boolean
```

### Implementation

#### Linux — `fallocate` (instant, no zero-fill)

```rust
let fd = OpenOptions::new()
    .write(true)
    .create(true)
    .open(&path)?;

let mode = if skip_zero_fill { 0 } else { libc::FALLOC_FL_KEEP_SIZE };
unsafe {
    let ret = libc::fallocate(fd.as_raw_fd(), mode, 0, size as libc::off_t);
    if ret != 0 { return Err(io::Error::last_os_error()); }
}
fd.set_len(size)?; // set file size

// fallocate với mode=0 always succeeds on ext4, xfs, btrfs, tmpfs
// Chỉ thất bại trên NFS/FUSE — caller fallback về ftruncate
```

#### Windows — `SetFileValidData` + `SetEndOfFile` (cần đặc quyền)

```rust
let handle = CreateFileW(
    path, GENERIC_WRITE, ...,
    FILE_FLAG_NO_BUFFERING, ...
);

if skip_zero_fill {
    // SetFileValidData yêu cầu SE_MANAGE_VOLUME_NAME privilege
    // Nếu không có → thất bại, caller fallback
    if !enable_privilege(SE_MANAGE_VOLUME_NAME)? {
        CloseHandle(handle);
        return Ok(false); // signal caller to fallback
    }
    SetFilePointerEx(handle, size, FILE_BEGIN)?;
    SetFileValidData(handle, size)?; // instant allocation, no zero-fill
    SetEndOfFile(handle)?;
} else {
    SetFilePointerEx(handle, size, FILE_BEGIN)?;
    SetEndOfFile(handle)?; // zero-fill on write
}
CloseHandle(handle);
Ok(true)
```

#### macOS — `fcntl(F_PREALLOCATE)`

```rust
// macOS không phân biệt zero-fill vs metadata-only allocation
// F_PREALLOCATE luôn là metadata-only
let fd = OpenOptions::new()
    .write(true)
    .create(true)
    .open(&path)?;

let mut store = fstore_t {
    fst_flags: F_ALLOCATECONTIG,  // thử contiguous trước
    fst_posmode: F_PEOFPOSMODE,
    fst_offset: 0,
    fst_length: size as off_t,
};

unsafe {
    if fcntl(fd.as_raw_fd(), F_PREALLOCATE, &store) == -1 {
        // fallback về non-contiguous
        store.fst_flags = F_ALLOCATEALL;
        fcntl(fd.as_raw_fd(), F_PREALLOCATE, &store);
    }
}
ftruncate(fd.as_raw_fd(), size as off_t)?; // set file size

// Luôn true — macOS F_PREALLOCATE không bao giờ zero-fill
Ok(true)
```

### Thay đổi JS side

```typescript
// Thay fs.ftruncate(fd, size) bằng:
if (!native.preallocateFile({ path: tmpFile, size: totalSize, skipZeroFill: true })) {
    // Fallback — chỉ xảy ra trên Windows khi thiếu SE_MANAGE_VOLUME_NAME
    fs.ftruncateSync(fd, totalSize);
}
```

---

## Cơ chế Chung

### Gửi progress/result về JS

Dùng đúng cơ chế `onTransferProgress` / `onTransferResult` đã có trong i10r-addon. Cả ba hàm trả về `taskId: string` ngay lập tức, chạy nền trên Rust thread, gửi progress qua NAPI channel.

```rust
// Pattern chung trong Rust
fn send_napi_progress(task_id: &str, bytes_done: u64, total: u64) {
    // Gửi TransferProgress qua NAPI ThreadSafeFunction
    let elapsed = start_time.elapsed().as_secs_f64();
    let speed = if elapsed > 0.0 { (bytes_done as f64 / elapsed) as u64 } else { 0 };
    let eta = if speed > 0 { (total - bytes_done) / speed } else { 0 };

    napi_channel.send(TransferProgress {
        id: task_id.to_string(),
        current_file: String::new(),    // không dùng cho single-file
        files_done: 0,
        total_files: 1,
        bytes_done,
        total_bytes: total,
        percent: ((bytes_done as f64 / total as f64) * 100.0) as u32,
        speed_bps: speed,
        eta_seconds: eta as i64,
    });
}
```

### Xử lý cancel

Dùng `Arc<AtomicBool>` + signal. JS side gọi một hàm cancel riêng (hoặc reuse `cancelTransfer` nếu có).

```typescript
export declare function cancelTransfer(taskId: string): void
```

Trong Rust, mỗi hàm kiểm tra `cancel_flag.load(Ordering::Relaxed)` trong vòng lặp copy và return sớm nếu bị cancel.

---

## Tổng kết

| # | Hàm | Thay thế JS | Syscall chính | Priority |
|---|---|---|---|---|
| 1 | `copyRanges` | `IOWriteQueue` toàn bộ | `copy_file_range` / `ReadFile+WriteFile` | **Cao nhất** |
| 2 | `copyLargeFile` | `MoveQueue.copyViaKernel` | `copy_file_range` / `CopyFileExW` / `fcopyfile` | Cao |
| 3 | `preallocateFile` | `fs.ftruncate` các site | `fallocate` / `SetFileValidData` / `F_PREALLOCATE` | Trung bình |

**Tác động batch 10GB × N files**:

| Chỉ số | Hiện tại JS | Sau Rust |
|---|---|---|
| Turbo chunk move 10GB | ~5,280 syscalls, cache pollution 10GB | ~160 syscalls, 0 cache pollution |
| Final move 10GB | ~80s (128MB buffer loop) | ~30s (kernel DMA) |
| Pre-allocate 10GB | ~5s (zero-fill) | <0.1s (`fallocate`) |
| RAM peak khi batch move | ~128MB × N concurrent | ~0MB (kernel internal) |
