use crate::downloader::types::{DiskEnvironmentInfo, DiskInfo, DriveEnvInfo, DlEnvironment, DlMediaType};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const GB: u64 = 1024 * 1024 * 1024;

pub trait DiskProbe: Send + Sync {
    fn disk_info(&self, dir: &Path) -> DiskInfo;
    fn all_drives(&self) -> Vec<DiskInfo>;
}

pub struct SysinfoDiskProbe;

impl DiskProbe for SysinfoDiskProbe {
    fn disk_info(&self, dir: &Path) -> DiskInfo {
        let disks = sysinfo::Disks::new_with_refreshed_list();
        let dir = dir.to_path_buf();
        let mut best: Option<&sysinfo::Disk> = None;
        let mut best_len = 0usize;
        for disk in disks.list() {
            let mount = disk.mount_point();
            if dir.starts_with(mount) {
                let len = mount.as_os_str().len();
                if len > best_len {
                    best_len = len;
                    best = Some(disk);
                }
            }
        }
        let result = match best {
            Some(d) => DiskInfo {
                path: d.mount_point().to_string_lossy().to_string(),
                available: d.available_space(),
                total: d.total_space(),
                is_ssd: matches!(d.kind(), sysinfo::DiskKind::SSD),
            },
            None => DiskInfo {
                path: dir.to_string_lossy().to_string(),
                available: 0,
                total: 0,
                is_ssd: false,
            },
        };
        log::info!(
            "SysinfoDiskProbe: queried={:?} matched={} available={} total={}",
            dir, result.path, result.available, result.total
        );
        result
    }

    fn all_drives(&self) -> Vec<DiskInfo> {
        let disks = sysinfo::Disks::new_with_refreshed_list();
        disks
            .list()
            .iter()
            .filter(|d| !d.is_removable())
            .map(|d| DiskInfo {
                path: d.mount_point().to_string_lossy().to_string(),
                available: d.available_space(),
                total: d.total_space(),
                is_ssd: matches!(d.kind(), sysinfo::DiskKind::SSD),
            })
            .collect()
    }
}

struct CacheEntry {
    result: DiskInfo,
    at: Instant,
}

pub struct DiskManager {
    probe: Arc<dyn DiskProbe>,
    usage_tracker: Mutex<HashMap<String, u64>>,
    disk_info_cache: Mutex<HashMap<String, CacheEntry>>,
    drives_cache: Mutex<Option<(Vec<DiskInfo>, Instant)>>,
}

const DISK_INFO_CACHE_TTL: Duration = Duration::from_secs(3);
const DRIVES_CACHE_TTL: Duration = Duration::from_secs(15);

impl DiskManager {
    pub fn new(probe: Box<dyn DiskProbe>) -> Self {
        Self {
            probe: Arc::from(probe),
            usage_tracker: Mutex::new(HashMap::new()),
            disk_info_cache: Mutex::new(HashMap::new()),
            drives_cache: Mutex::new(None),
        }
    }

    pub fn with_default_probe() -> Self {
        Self::new(Box::new(SysinfoDiskProbe))
    }

    async fn probe_disk_info(&self, dir: &Path) -> DiskInfo {
        let dir = dir.to_path_buf();
        let probe = self.probe.clone();
        tokio::task::spawn_blocking(move || probe.disk_info(&dir))
            .await
            .unwrap_or(DiskInfo {
                path: String::new(),
                available: 0,
                total: 0,
                is_ssd: false,
            })
    }

    async fn probe_all_drives(&self) -> Vec<DiskInfo> {
        let probe = self.probe.clone();
        tokio::task::spawn_blocking(move || probe.all_drives())
            .await
            .unwrap_or_default()
    }

    fn resolve_dir(&self, target: &Path) -> PathBuf {
        if target.is_dir() {
            target.to_path_buf()
        } else {
            target
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| target.to_path_buf())
        }
    }

    pub async fn disk_info(&self, target_path: &Path) -> DiskInfo {
        let dir = self.resolve_dir(target_path);
        let key = dir.to_string_lossy().to_string();

        {
            let cache = self.disk_info_cache.lock().unwrap();
            if let Some(entry) = cache.get(&key) {
                if entry.at.elapsed() < DISK_INFO_CACHE_TTL {
                    return entry.result.clone();
                }
            }
        }
        let result = self.probe_disk_info(&dir).await;
        self.disk_info_cache.lock().unwrap().insert(
            key,
            CacheEntry {
                result: result.clone(),
                at: Instant::now(),
            },
        );
        result
    }

    pub async fn detect_ssd(&self, target_path: &Path) -> bool {
        self.disk_info(target_path).await.is_ssd
    }

    async fn all_drives(&self) -> Vec<DiskInfo> {
        {
            let cache = self.drives_cache.lock().unwrap();
            if let Some((drives, at)) = cache.as_ref() {
                if at.elapsed() < DRIVES_CACHE_TTL {
                    return drives.clone();
                }
            }
        }
        let drives = self.probe_all_drives().await;
        *self.drives_cache.lock().unwrap() = Some((drives.clone(), Instant::now()));
        drives
    }

    pub async fn choose_tmp_dir(
        &self,
        save_path: &Path,
        required_bytes: u64,
        file_size: u64,
        preferred_tmp_dir: Option<&Path>,
    ) -> Option<PathBuf> {
        let buffer = GB;
        let min_space = required_bytes.max(file_size) + buffer;

        if let Some(preferred) = preferred_tmp_dir {
            if tokio::fs::create_dir_all(preferred).await.is_ok() {
                let info = self.disk_info(preferred).await;
                if info.is_ssd && info.available >= min_space {
                    return Some(preferred.to_path_buf());
                }
            }
        }

        let drives = self.all_drives().await;
        let candidates: Vec<&DiskInfo> = drives
            .iter()
            .filter(|d| d.is_ssd && d.available >= min_space)
            .collect();
        if candidates.is_empty() {
            return None;
        }

        let save_key = drive_key(save_path);
        let mut scored: Vec<(i64, &DiskInfo)> = candidates
            .iter()
            .map(|d| (self.score_drive(d, required_bytes, &save_key), *d))
            .collect();
        scored.sort_by(|a, b| b.0.cmp(&a.0));
        scored.first().map(|(_, d)| {
            let mut p = PathBuf::from(&d.path);
            p.push(".ipsw-tmp");
            p
        })
    }

    pub async fn has_enough_space(
        &self,
        save_path: &Path,
        firmware_size: u64,
        buffer_bytes: u64,
    ) -> (bool, u64, u64) {
        let current_usage: u64 = self.usage_tracker.lock().unwrap().values().sum();
        let required = firmware_size + current_usage + buffer_bytes;
        let info = self.disk_info(&self.resolve_dir(save_path)).await;
        log::info!(
            "has_enough_space: path={:?} resolved={:?} available={} total={} required={} firmware={} usage={} buffer={}",
            save_path, self.resolve_dir(save_path), info.available, info.total, required, firmware_size, current_usage, buffer_bytes
        );
        (info.available >= required, info.available, required)
    }

    pub fn reserve_space(&self, task_id: &str, bytes: u64) {
        self.usage_tracker
            .lock()
            .unwrap()
            .insert(task_id.to_string(), bytes);
    }

    pub fn release_space(&self, task_id: &str) {
        self.usage_tracker.lock().unwrap().remove(task_id);
    }

    pub async fn environment_info(&self, save_path: &Path) -> DiskEnvironmentInfo {
        let save_dir = self.resolve_dir(save_path);
        let is_ssd = self.detect_ssd(&save_dir).await;
        let save_mount = drive_key(&save_dir);
        let save_drive = DriveEnvInfo {
            path: save_mount,
            media_type: if is_ssd { DlMediaType::Ssd } else { DlMediaType::Hdd },
        };

        if is_ssd {
            return DiskEnvironmentInfo {
                environment: DlEnvironment::SsdSave,
                save_drive,
                tmp_drive: None,
            };
        }

        match self.choose_tmp_dir(save_path, GB, GB, None).await {
            Some(tmp_dir) => DiskEnvironmentInfo {
                environment: DlEnvironment::HddSsdTmp,
                save_drive,
                tmp_drive: Some(DriveEnvInfo {
                    path: drive_key(&tmp_dir),
                    media_type: DlMediaType::Ssd,
                }),
            },
            None => DiskEnvironmentInfo {
                environment: DlEnvironment::HddOnly,
                save_drive,
                tmp_drive: None,
            },
        }
    }

    fn score_drive(&self, drive: &DiskInfo, required_bytes: u64, save_drive_key: &str) -> i64 {
        let mut score: i64 = 0;
        let headroom_gb =
            (drive.available as i64 - required_bytes as i64) as f64 / GB as f64;
        score += (headroom_gb.max(0.0) * 2.0).floor().min(50.0) as i64;

        if !drive.path.to_uppercase().starts_with("C:") {
            score += 30;
        }
        if drive_key(Path::new(&drive.path)) == save_drive_key {
            score += 20;
        }
        let total_gb = drive.total as f64 / GB as f64;
        score += (total_gb / 50.0).floor().min(20.0) as i64;
        score
    }
}

pub fn drive_key(path: &Path) -> String {
    #[cfg(windows)]
    {
        use std::path::Component;
        for c in path.components() {
            if let Component::Prefix(p) = c {
                return p.as_os_str().to_string_lossy().to_uppercase();
            }
        }
        String::new()
    }
    #[cfg(not(windows))]
    {
        let mut parts = path.components();
        let _root = parts.next();
        match parts.next() {
            Some(first) => format!("/{}", first.as_os_str().to_string_lossy()),
            None => "/".to_string(),
        }
    }
}
