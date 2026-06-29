# IPSW Downloader Core v2

## Architecture & System Specification

---

# 1. Strategic Goals

IPSW Downloader Core is a specialized download system designed for large Apple firmware (`.ipsw`) files ranging from 5 GB to over 13 GB.

### Objectives

* Maximize available network bandwidth utilization.
* Operate reliably on SSDs, HDDs, and external storage devices.
* Support accurate download resumption after interruptions.
* Minimize the risk of data corruption.
* Automatically verify data integrity.
* Remain maintainable and extensible over the long term.

---

# 2. Design Philosophy

## State Is The Truth

The core never attempts to infer state from physical files on disk.

All recovery decisions are based exclusively on the persisted state.

If the persisted state and physical data become inconsistent:

* Cleanup.
* Remove the task.
* Restart the download from scratch.

The system never attempts to repair or reconstruct corrupted data.

---

## Verify, Resume, Redownload

The core only performs:

* Resume
* Verify
* Redownload

The core does **not** perform:

* File patching
* File truncation
* Offset correction
* Corrupted chunk guessing
* Chunk reconstruction from raw data

---

# 3. Overall Architecture

```text
Download Manager
│
├── Task Manager
├── Download Planner
├── Network Engine
├── Storage Engine
├── Integrity Engine
├── Safety Monitor
├── State Manager
└── Event Dispatcher
```

---

# 4. Download Planner

The planner analyzes the system environment and generates an optimal `DownloadPlan`.

## Input

```rust
pub struct PlanningInput {
    pub mode: DownloadMode,
    pub file_size: u64,

    pub save_dir: PathBuf,
    pub tmp_dir: Option<PathBuf>,

    pub available_space: u64,

    pub disk_type: DiskType,
}
```

## Output

```rust
pub struct DownloadPlan {
    pub connections: usize,

    pub chunk_size: usize,

    pub buffer_size: usize,

    pub write_strategy: WriteStrategy,

    pub use_tmp: bool,

    pub use_preallocation: bool,
}
```

---

## Download Modes

| Mode   | Connections | Buffer | Max Tasks |
| ------ | ----------- | ------ | --------- |
| Safe   | 2-4         | 16 MB  | 2         |
| Normal | 8-16        | 4 MB   | 3         |
| Turbo  | 16-32       | 1-2 MB | 3         |

---

# 5. Network Engine

## Capability Probe

Before starting a download:

```http
HEAD
```

or

```http
GET Range: bytes=0-1
```

Used to determine:

```rust
pub struct DownloadCapability {
    pub supports_range: bool,

    pub content_length: u64,

    pub etag: Option<String>,

    pub last_modified: Option<String>,
}
```

If the server does not support Range Requests:

```text
Fallback → Single Connection Download
```

---

## Adaptive Connections

The core starts with a small number of connections:

```text
1 → 4 → 8 → 16 → 32
```

Connections are gradually increased based on real-world throughput.

---

## Retry Policy

Retryable errors:

* Timeout
* Connection Reset
* HTTP 500
* HTTP 502
* HTTP 503
* HTTP 504

### Exponential Backoff

```text
1s
2s
4s
8s
16s
```

Maximum retries:

```text
10 attempts
```

---

# 6. Storage Engine

## Disk Types

```rust
pub enum DiskType {
    SSD,
    HDD,
    Unknown,
}
```

`Unknown` is treated as `SSD`.

---

## SSD Strategy

* Pre-allocation
* Direct random writes
* Asynchronous offset writes

---

## HDD Strategy

```text
Network
    ↓
RAM Buffer
    ↓
Sequential Queue
    ↓
Disk
```

Designed to minimize random write operations.

---

## Adaptive Protection

If write latency becomes excessive:

```text
32 → 16
16 → 8
8 → 4
```

The core reduces active connections automatically.

---

# 7. Temporary Files

The core uses a custom extension:

```text
.i10r
```

(`i10r` = IPSW Manager)

---

## Downloading

```text
iPhone18,5_26.5.1_23F81_Restore.ipsw.i10r
```

---

## State File

```text
iPhone18,5_26.5.1_23F81_Restore.task.i10r
```

---

## Completed

```text
iPhone18,5_26.5.1_23F81_Restore.ipsw
```

After successful verification:

```text
Rename
```

---

# 8. Integrity Engine

## Streaming MD5

The hash is calculated during the download process:

```rust
md5.update(chunk);
```

No full-file reread is required after download completion.

---

## Verification Priority

### MD5

If the firmware metadata does not provide an MD5 checksum:

* Skip verification

or

* Report a metadata error, depending on configuration.

---

## Verification Stage

```text
Downloading
    ↓
Verifying
    ↓
Finalizing
    ↓
Completed
```

---

## Recovery Verification

If a task has been resumed or recovered:

```text
Verification is always mandatory.
```

Any Skip Verify configuration is ignored.

---

# 9. State Manager

## Atomic Checkpoint

Never write directly to:

```text
state.i10r
```

Always use:

```text
state.i10r.tmp
↓
flush
↓
rename
↓
state.i10r
```

---

## Checkpoint Timing

State is persisted when:

* Pause
* Exit
* Critical Error
* Every 30 seconds
* Every 5 completed chunks

---

## Download State

```rust
pub struct DownloadState {
    pub task_id: u32,

    pub firmware_id: String,

    pub build_id: String,

    pub downloaded_bytes: u64,

    pub completed_chunks: BitVec,

    pub etag: Option<String>,

    pub last_modified: Option<String>,

    pub updated_at: u64,
}
```

---

# 10. Resume Recovery

## Startup Recovery

```text
Load State
    ↓
Validate Files
    ↓
Resume or Cleanup
```

---

## Task Using TMP

```text
TMP exists?

YES:
    Resume

NO:
    Cleanup
```

---

## Task Without TMP

```text
Target file exists?

YES:
    Resume

NO:
    Cleanup
```

---

## ETag Validation

Before resuming:

```http
HEAD
```

Compare:

```text
ETag
```

If the ETag has changed:

```text
Clear Task
Restart Download
```

---

# 11. Safety Monitor

## Disk Full Protection

```rust
pub struct SafeStorage {
    pub min_free_space_mb: u64,
}
```

Default:

```text
1024 MB
```

---

## Disk Disconnection

If the storage device is disconnected:

```text
Pause
Close Handles
Wait For Recovery
```

---

## Network Loss

```text
Pause
```

When connectivity returns:

```text
Auto Resume
```

---

# 12. Task Lifecycle

```text
Queued
    │
    ▼
Planning
    │
    ▼
Downloading
    │
    ├────► Paused
    │          │
    │          ▼
    │      Resuming
    │
    ▼
Verifying
    │
    ▼
Finalizing
    │
    ▼
Completed
```

---

# 13. Task State

```rust
pub enum TaskState {
    Queued,

    Planning,

    Downloading,

    Paused,

    Resuming,

    Recovering,

    Verifying,

    Finalizing,

    Completed,

    Failed,

    Cancelled,
}
```

---

# 14. Event System

## Snapshot-Based Events

Instead of emitting numerous small events, the core sends aggregated snapshots.

```rust
pub struct TaskSnapshot {
    pub id: u32,

    pub state: TaskState,

    pub downloaded_bytes: u64,

    pub total_bytes: u64,

    pub speed_bps: u64,

    pub eta_seconds: Option<u64>,

    pub active_connections: usize,
}
```

---

## Event Throttling

Maximum:

```text
1 event / 250 ms
```

per task.

---

# 15. Public API

```rust
pub fn add(firmware: Firmware) -> u32;

pub fn pause(task_id: u32);

pub fn resume(task_id: u32);

pub fn cancel(task_id: u32);

pub fn get_active_tasks() -> Vec<ActiveTask>;

pub fn get_historical_tasks(
    page: u32,
    limit: u32,
) -> TaskPage;
```

---

# 16. Firmware Entity

```rust
pub struct Firmware {
    pub identifier: String,

    pub version: String,

    pub buildid: String,

    pub md5sum: String,

    pub filesize: u64,

    pub url: String,

    pub releasedate: String,

    pub uploaddate: String,

    pub signed: bool,
}
```

---

# 17. Core Principles

1. State is the single source of truth.
2. Never infer state from raw file data.
3. Never repair downloaded data.
4. Verification must complete before a task can be marked as completed.
5. Recovery should remain simple and predictable.
6. Every state transition must use atomic checkpointing.
7. Resume only when the ETag remains valid.
8. All incomplete files must use the `.i10r` extension.
9. Files are renamed to `.ipsw` only after successful completion.
10. Stability takes priority over maximum performance.

---