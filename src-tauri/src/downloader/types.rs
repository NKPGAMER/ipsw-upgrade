use serde::{Deserialize, Serialize};
use specta_typescript::Number;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Queued,
    Downloading,
    Paused,
    Completed,
    Error,
    Verifying,
    Moving,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ActiveOperation {
    Download,
    Verify,
    Move,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Firmware {
    pub identifier: String,
    pub buildid: String,
    pub version: String,
    pub url: String,
    #[specta(type = Number)]
    pub filesize: u64,
    pub releasedate: String,
    pub uploaddate: String,
    pub signed: bool,
    #[serde(default)]
    pub sha1sum: Option<String>,
    #[serde(default)]
    pub md5sum: Option<String>,
    #[serde(default)]
    pub sha256sum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub firmware: Firmware,
    pub progress: f64,
    pub speed: f64,
    pub status: TaskStatus,
    pub eta: Option<f64>,
    pub error: Option<String>,
    pub save_path: String,
    #[specta(type = Number)]
    pub active_connections: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkState {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    pub downloaded: u64,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadState {
    pub id: String,
    pub firmware: Firmware,
    pub save_path: String,
    pub tmp_path: String,
    pub total_size: u64,
    pub chunks: Vec<ChunkState>,
    pub supports_ranges: bool,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub moved_chunks: Vec<usize>,
    pub active_operation: ActiveOperation,
    pub last_checkpoint: i64,
    pub last_write_time: i64,
    pub task_status: TaskStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(specta::Type)]
#[serde(tag = "error")]
pub enum AddError {
    DiskFull,
    AlreadyInList,
    InvalidUrl,
    InvalidSavePath,
    UnknownDiskSpace,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(specta::Type)]
pub struct AddResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AddError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(specta::Type)]
pub enum LifecycleError {
    NotFound,
    InvalidStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(specta::Type)]
pub struct LifecycleResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<LifecycleError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskInfo {
    pub path: String,
    pub available: u64,
    pub total: u64,
    pub is_ssd: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(specta::Type)]
pub enum DlMediaType {
    #[serde(rename = "SSD")]
    Ssd,
    #[serde(rename = "HDD")]
    Hdd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DriveEnvInfo {
    pub path: String,
    pub media_type: DlMediaType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(specta::Type)]
pub enum DlEnvironment {
    #[serde(rename = "ssd_save")]
    SsdSave,
    #[serde(rename = "hdd_ssd_tmp")]
    HddSsdTmp,
    #[serde(rename = "hdd_only")]
    HddOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiskEnvironmentInfo {
    pub environment: DlEnvironment,
    pub save_drive: DriveEnvInfo,
    pub tmp_drive: Option<DriveEnvInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[derive(specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IncompleteTask {
    pub id: String,
    pub firmware: Firmware,
    pub save_path: String,
    pub tmp_path: String,
    #[specta(type = Number)]
    pub total_size: u64,
    #[specta(type = Number)]
    pub downloaded_bytes: u64,
    pub progress: f64,
    pub tmp_exists: bool,
    #[specta(type = Number)]
    pub saved_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloaderConfig {
    pub save_dir: String,
    #[serde(default = "default_max_concurrent_tasks")]
    pub max_concurrent_tasks: usize,
    #[serde(default = "default_min_connections")]
    pub min_connections_per_task: u32,
    #[serde(default = "default_max_connections")]
    pub max_connections_per_task: u32,
    #[serde(default = "default_chunk_size")]
    pub chunk_size: u64,
    #[serde(default = "default_retry_limit")]
    pub retry_limit: u32,
    #[serde(default = "default_retry_delay_ms")]
    pub retry_delay_ms: u64,
    #[serde(default = "default_disk_buffer_gb")]
    pub disk_buffer_gb: u64,
    #[serde(default)]
    pub tmp_dir: Option<String>,
    #[serde(default)]
    pub boost: bool,
    #[serde(default = "default_boost_multiplier")]
    pub boost_multiplier: f64,
    #[serde(default)]
    pub skip_verify: bool,
    #[serde(default)]
    pub insecure_tls: bool,
    #[serde(default = "default_true")]
    pub auto_resume: bool,
}

fn default_max_concurrent_tasks() -> usize { 3 }
fn default_min_connections() -> u32 { 4 }
fn default_max_connections() -> u32 { 16 }
fn default_chunk_size() -> u64 { 32 * 1024 * 1024 }
fn default_retry_limit() -> u32 { 3 }
fn default_retry_delay_ms() -> u64 { 2000 }
fn default_disk_buffer_gb() -> u64 { 5 }
fn default_boost_multiplier() -> f64 { 2.0 }
fn default_true() -> bool { true }

impl Default for DownloaderConfig {
    fn default() -> Self {
        Self {
            save_dir: ".".into(),
            max_concurrent_tasks: default_max_concurrent_tasks(),
            min_connections_per_task: default_min_connections(),
            max_connections_per_task: default_max_connections(),
            chunk_size: default_chunk_size(),
            retry_limit: default_retry_limit(),
            retry_delay_ms: default_retry_delay_ms(),
            disk_buffer_gb: default_disk_buffer_gb(),
            tmp_dir: None,
            boost: false,
            boost_multiplier: default_boost_multiplier(),
            skip_verify: false,
            insecure_tls: false,
            auto_resume: true,
        }
    }
}
