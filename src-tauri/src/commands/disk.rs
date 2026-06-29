use crate::disk::{BestDriveOptions, DriveInfo, EnvInfo};
use specta::Type;
use specta_typescript::Number;

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct FreeSpaceResult {
    #[specta(type = Number)]
    pub bytes: u64,
}

#[tauri::command]
#[specta::specta]
pub fn get_free_space(path: &str) -> Result<FreeSpaceResult, String> {
    let bytes = crate::disk::get_free_space(path)
        .ok_or_else(|| String::from("Không thể lấy dung lượng trống"))?;
    Ok(FreeSpaceResult { bytes })
}

#[tauri::command]
#[specta::specta]
pub fn get_drive_info(path: &str) -> Result<DriveInfo, String> {
    crate::disk::get_drive_info(path)
        .ok_or_else(|| String::from("Không tìm thấy thông tin ổ đĩa"))
}

#[tauri::command]
#[specta::specta]
pub fn list_drives() -> Vec<String> {
    crate::disk::list_drives()
}

#[tauri::command]
#[specta::specta]
pub fn list_drives_info() -> Result<Vec<DriveInfo>, String> {
    Ok(crate::disk::list_drives_info())
}

#[tauri::command]
#[specta::specta]
pub fn get_best_drive(options: BestDriveOptions) -> Result<DriveInfo, String> {
    crate::disk::get_best_drive(options)
        .ok_or_else(|| String::from("Không tìm thấy ổ đĩa phù hợp"))
}

#[tauri::command]
#[specta::specta]
pub fn get_environment_info(path: &str) -> Result<EnvInfo, String> {
    crate::disk::get_environment_info(path)
        .ok_or_else(|| String::from("Không thể xác định môi trường ổ đĩa"))
}
