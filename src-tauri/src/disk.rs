use serde::{Deserialize, Serialize};
use specta::Type;
use specta_typescript::Number;
use std::path::Path;
use sysinfo::{Disk, DiskKind, Disks};

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

/// Loại ổ đĩa
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MediaType {
    Ssd,
    Hdd,
    /// Flash / USB / External / Unknown
    None,
}

/// Môi trường hoạt động của app
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiskEnv {
    SsdOnly,
    HddOnly,
    /// HDD lưu file chính + SSD dùng làm TMP buffer
    Mixed,
}

/// Thông tin chi tiết một ổ đĩa
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DriveInfo {
    /// Mount point, vd. "C:\\" hoặc "D:\\"
    pub mount_point: String,
    /// Tổng dung lượng (bytes)
    #[specta(type = Number)]
    pub total_space: u64,
    /// Dung lượng còn trống (bytes)
    #[specta(type = Number)]
    pub available_space: u64,
    /// Dung lượng đã dùng (bytes)
    #[specta(type = Number)]
    pub used_space: u64,
    pub media_type: MediaType,
    pub is_removable: bool,
    /// Tên nhãn ổ (nếu có)
    pub name: String,
    /// Hệ thống tập tin, vd. "NTFS", "FAT32"
    pub file_system: String,
    /// Ổ này có chứa Windows không (kiểm tra qua %SystemDrive%)
    pub is_system_drive: bool,
}

/// Thông tin ổ tối giản dùng cho TMP / save drive trong EnvInfo
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DriveRef {
    pub path: String,
    pub media_type: MediaType,
}

/// Kết quả từ `get_environment_info`
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EnvInfo {
    pub env: DiskEnv,
    pub save_drive: DriveRef,
    /// Chỉ có giá trị khi env == Mixed
    pub tmp_drive: Option<DriveRef>,
}

/// Options để lấy ổ tốt nhất
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BestDriveOptions {
    /// Dung lượng file cần lưu (bytes). None = bỏ qua filter size.
    #[specta(type = Number)]
    pub file_size: Option<u64>,
    /// Thư mục lưu file đang được cấu hình.
    pub save_dir: Option<String>,
}

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

const BUFFER_BYTES: u64 = 5 * 1024 * 1024 * 1024; // 5 GB

/// Lấy Windows %SystemDrive% (thường là "C:"). Không cần admin.
fn system_drive_letter() -> Option<String> {
    std::env::var("SystemDrive").ok()
}

/// Chuyển `DiskKind` của sysinfo sang `MediaType` của ta.
fn disk_kind_to_media_type(kind: DiskKind) -> MediaType {
    match kind {
        DiskKind::SSD => MediaType::Ssd,
        DiskKind::HDD => MediaType::Hdd,
        _ => MediaType::None,
    }
}

/// Trích root drive từ path, vd. "C:/downloads/ipsw" → "C:\\"
/// Hoạt động trên Windows (absolute path) và Linux/macOS (prefix "/").
fn root_from_path(path: &str) -> Option<String> {
    let p = Path::new(path);
    // Windows: lấy prefix "C:" rồi cộng thêm separator
    #[cfg(windows)]
    {
        use std::path::Prefix;
        use std::path::Component;
        for component in p.components() {
            if let Component::Prefix(prefix_component) = component {
                match prefix_component.kind() {
                    Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                        let letter = letter as char;
                        return Some(format!("{}:\\", letter.to_uppercase()));
                    }
                    _ => {}
                }
            }
        }
        None
    }
    // Unix/macOS fallback
    #[cfg(not(windows))]
    {
        if p.is_absolute() {
            Some("/".to_string())
        } else {
            None
        }
    }
}

/// Lấy tất cả disk hiện có (dùng sysinfo).
fn load_disks() -> Disks {
    Disks::new_with_refreshed_list()
}

/// Convert một `sysinfo::Disk` sang `DriveInfo`.
fn disk_to_drive_info(disk: &Disk) -> DriveInfo {
    let sys_drive = system_drive_letter()
        .unwrap_or_else(|| "C:".to_string())
        .to_uppercase();

    let mount = disk.mount_point().to_string_lossy().to_string();
    let mount_upper = mount.to_uppercase();

    // Kiểm tra xem đây có phải ổ chứa Windows không
    // vd. sys_drive = "C:" và mount = "C:\" → is_system_drive = true
    let is_system_drive = mount_upper.starts_with(&sys_drive);

    let total = disk.total_space();
    let available = disk.available_space();
    let used = total.saturating_sub(available);

    DriveInfo {
        mount_point: mount,
        total_space: total,
        available_space: available,
        used_space: used,
        media_type: disk_kind_to_media_type(disk.kind()),
        is_removable: disk.is_removable(),
        name: disk.name().to_string_lossy().to_string(),
        file_system: disk.file_system().to_string_lossy().to_string(),
        is_system_drive,
    }
}

/// Tìm disk khớp với root của một path.
fn find_disk_for_path<'a>(disks: &'a Disks, root: &str) -> Option<&'a Disk> {
    let root_upper = root.to_uppercase();
    disks.list().iter().find(|d| {
        d.mount_point()
            .to_string_lossy()
            .to_uppercase()
            .starts_with(&root_upper)
            || root_upper.starts_with(
                d.mount_point()
                    .to_string_lossy()
                    .to_uppercase()
                    .as_str(),
            )
    })
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/// Lấy dung lượng trống (bytes) của ổ chứa `path`.
///
/// # Ví dụ
/// ```
/// let free = get_free_space("C:/downloads/ipsw").unwrap_or(0);
/// ```
pub fn get_free_space(path: &str) -> Option<u64> {
    let root = root_from_path(path)?;
    let disks = load_disks();
    let disk = find_disk_for_path(&disks, &root)?;
    Some(disk.available_space())
}

/// Lấy toàn bộ thông tin của ổ chứa `path`.
pub fn get_drive_info(path: &str) -> Option<DriveInfo> {
    let root = root_from_path(path)?;
    let disks = load_disks();
    let disk = find_disk_for_path(&disks, &root)?;
    Some(disk_to_drive_info(disk))
}

/// Lấy danh sách tất cả mount point hiện có, vd. `["C:\\", "D:\\"]`.
pub fn list_drives() -> Vec<String> {
    let disks = load_disks();
    disks
        .list()
        .iter()
        .map(|d| d.mount_point().to_string_lossy().to_string())
        .collect()
}

/// Lấy danh sách thông tin đầy đủ của tất cả ổ đĩa.
pub fn list_drives_info() -> Vec<DriveInfo> {
    let disks = load_disks();
    disks.list().iter().map(disk_to_drive_info).collect()
}

/// Lấy ổ đĩa phù hợp nhất để lưu file theo `options`.
///
/// **Priority chain (từ cao → thấp):**
/// 1. `save_dir` đã là SSD → trả về luôn
/// 2. Lọc bỏ ổ không đủ dung lượng (`file_size + 5 GB` buffer)
/// 3. Lọc bỏ ổ rời (removable)
/// 4. Ưu tiên SSD tốc độ cao (≈ ổ không phải system drive để tránh OS overhead)
/// 5. Nếu tất cả cùng loại / không có SSD → ưu tiên ổ không chứa Windows
/// 6. Fallback về `save_dir` nếu không tìm được ổ tốt hơn
pub fn get_best_drive(options: BestDriveOptions) -> Option<DriveInfo> {
    let disks = load_disks();
    let all_drives: Vec<DriveInfo> = disks.list().iter().map(disk_to_drive_info).collect();

    // ── Bước 1: Kiểm tra save_dir ──
    if let Some(ref save_dir) = options.save_dir {
        if let Some(root) = root_from_path(save_dir) {
            if let Some(disk) = find_disk_for_path(&disks, &root) {
                let info = disk_to_drive_info(disk);
                if info.media_type == MediaType::Ssd {
                    return Some(info);
                }
            }
        }
    }

    // save_dir là HDD (hoặc không có) → tìm ổ tốt hơn trong danh sách
    let required_space = options
        .file_size
        .map(|s| s + BUFFER_BYTES)
        .unwrap_or(BUFFER_BYTES);

    // ── Bước 2 & 3: Lọc theo dung lượng và removable ──
    let candidates: Vec<DriveInfo> = all_drives
        .iter()
        .filter(|d| d.available_space >= required_space && !d.is_removable)
        .cloned()
        .collect();

    if candidates.is_empty() {
        // Fallback: trả về save_dir nếu có, không quan tâm size lúc này
        if let Some(ref save_dir) = options.save_dir {
            return get_drive_info(save_dir);
        }
        return None;
    }

    // ── Bước 4: Ưu tiên SSD ──
    let ssd_candidates: Vec<&DriveInfo> = candidates
        .iter()
        .filter(|d| d.media_type == MediaType::Ssd)
        .collect();

    let pool: Vec<&DriveInfo> = if !ssd_candidates.is_empty() {
        ssd_candidates
    } else {
        candidates.iter().collect()
    };

    // ── Bước 5: Ưu tiên ổ không chứa Windows ──
    let non_system: Vec<&&DriveInfo> = pool.iter().filter(|d| !d.is_system_drive).collect();

    let winner: Option<&DriveInfo> = if !non_system.is_empty() {
        // Chọn ổ có nhiều dung lượng trống nhất trong nhóm tốt nhất
        non_system
            .into_iter()
            .max_by_key(|d| d.available_space)
            .copied()
    } else {
        pool.into_iter()
            .max_by_key(|d| d.available_space)
    };

    if let Some(best) = winner {
        // ── Bước 6: So sánh với save_dir ──
        // Nếu winner là save_dir thì trả về luôn
        if let Some(ref save_dir) = options.save_dir {
            let save_root = root_from_path(save_dir).unwrap_or_default();
            let save_root_upper = save_root.to_uppercase();
            let best_root_upper = best.mount_point.to_uppercase();

            if best_root_upper == save_root_upper {
                return get_drive_info(save_dir);
            }
        }
        return Some(best.clone());
    }

    // Fallback cuối: trả về save_dir
    options.save_dir.as_deref().and_then(get_drive_info)
}

/// Lấy thông tin môi trường chạy của app dựa trên `path`.
///
/// | Điều kiện                                      | Kết quả  |
/// |------------------------------------------------|----------|
/// | Path nằm trên SSD                              | SSD Only |
/// | Path nằm trên HDD, có SSD khác available      | Mixed    |
/// | Path nằm trên HDD, không tìm được SSD nào     | HDD Only |
pub fn get_environment_info(path: &str) -> Option<EnvInfo> {
    let save_info = get_drive_info(path)?;

    let save_ref = DriveRef {
        path: save_info.mount_point.clone(),
        media_type: save_info.media_type.clone(),
    };

    match save_info.media_type {
        // ── SSD Only ──
        MediaType::Ssd => Some(EnvInfo {
            env: DiskEnv::SsdOnly,
            save_drive: save_ref,
            tmp_drive: None,
        }),

        // ── HDD: tìm SSD khác làm TMP ──
        MediaType::Hdd => {
            let best = get_best_drive(BestDriveOptions {
                file_size: None,
                save_dir: Some(path.to_string()),
            });

            // Tìm SSD candidate không phải ổ hiện tại
            let save_root = root_from_path(path)
                .unwrap_or_default()
                .to_uppercase();

            let tmp_ssd = best.and_then(|b| {
                let b_root = b.mount_point.to_uppercase();
                if b.media_type == MediaType::Ssd && b_root != save_root {
                    Some(DriveRef {
                        path: b.mount_point,
                        media_type: b.media_type,
                    })
                } else {
                    // get_best_drive không tìm được SSD ngoài → scan thủ công
                    None
                }
            });

            // Nếu get_best_drive chưa đủ, scan lại toàn bộ để tìm SSD khác
            let tmp_drive = if tmp_ssd.is_some() {
                tmp_ssd
            } else {
                let all = list_drives_info();
                all.into_iter()
                    .find(|d| {
                        d.media_type == MediaType::Ssd
                            && !d.is_removable
                            && d.mount_point.to_uppercase() != save_root
                    })
                    .map(|d| DriveRef {
                        path: d.mount_point,
                        media_type: d.media_type,
                    })
            };

            if let Some(tmp) = tmp_drive {
                Some(EnvInfo {
                    env: DiskEnv::Mixed,
                    save_drive: save_ref,
                    tmp_drive: Some(tmp),
                })
            } else {
                Some(EnvInfo {
                    env: DiskEnv::HddOnly,
                    save_drive: save_ref,
                    tmp_drive: None,
                })
            }
        }

        // ── Unknown / Removable ──
        MediaType::None => Some(EnvInfo {
            env: DiskEnv::HddOnly,
            save_drive: save_ref,
            tmp_drive: None,
        }),
    }
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_root_from_path_windows() {
        #[cfg(windows)]
        {
            assert_eq!(root_from_path("C:/downloads/ipsw"), Some("C:\\".to_string()));
            assert_eq!(root_from_path("D:\\Games\\Steam"), Some("D:\\".to_string()));
        }
    }

    #[test]
    fn test_list_drives_not_empty() {
        let drives = list_drives();
        assert!(!drives.is_empty(), "Phải có ít nhất một ổ đĩa");
    }

    #[test]
    fn test_list_drives_info() {
        let info = list_drives_info();
        assert!(!info.is_empty());
        for d in &info {
            assert!(d.total_space > 0);
        }
    }

    #[test]
    fn test_get_free_space_system_drive() {
        // Test với ổ C:/ (Windows) hoặc / (Unix)
        #[cfg(windows)]
        let path = "C:/Windows/System32";
        #[cfg(not(windows))]
        let path = "/usr/bin";

        let free = get_free_space(path);
        assert!(free.is_some(), "Phải lấy được dung lượng trống");
    }

    #[test]
    fn test_get_drive_info() {
        #[cfg(windows)]
        let path = "C:/";
        #[cfg(not(windows))]
        let path = "/";

        let info = get_drive_info(path);
        assert!(info.is_some());
        let info = info.unwrap();
        assert!(info.total_space > 0);
    }

    #[test]
    fn test_get_environment_info() {
        #[cfg(windows)]
        let path = "C:/";
        #[cfg(not(windows))]
        let path = "/";

        let env_info = get_environment_info(path);
        assert!(env_info.is_some());
        let env_info = env_info.unwrap();
        // Môi trường phải là một trong 3 loại hợp lệ
        assert!(matches!(
            env_info.env,
            DiskEnv::SsdOnly | DiskEnv::HddOnly | DiskEnv::Mixed
        ));
    }
}