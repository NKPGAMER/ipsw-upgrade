use super::user_data::UserData;
use serde_json::{Map, Value};
use tauri::AppHandle;

pub struct MetaData {
    ud: UserData,
    file: &'static str,
}

impl MetaData {
    pub fn new(app: &AppHandle) -> Self {
        Self {
            ud: UserData::new(app, ""),
            file: "metadata.json",
        }
    }

    /// Đọc toàn bộ file → trả về Map (tương đương Record<string, unknown>)
    pub async fn read_all(&self) -> Map<String, Value> {
        self.ud
            .read::<Map<String, Value>>(self.file, None)
            .await
            .unwrap_or_default() // file không tồn tại → {}
    }

    /// Đọc theo key → trả về Option<T> (tương đương T | null)
    pub async fn read<T>(&self, key: &str) -> Option<T>
    where
        T: serde::de::DeserializeOwned,
    {
        let data = self.read_all().await;
        let value = data.get(key)?; // key không tồn tại → None
        serde_json::from_value(value.clone()).ok() // deserialize thất bại → None
    }

    /// Ghi đè toàn bộ file
    pub async fn write(&self, data: &Map<String, Value>) -> bool {
        match self.ud.write(self.file, data).await {
            Ok(_) => true,
            Err(e) => {
                eprintln!("[metadata] Failed to write: {}", e);
                false
            }
        }
    }

    /// Merge patch vào data hiện tại (tương đương spread { ...current, ...patch })
    pub async fn update(&self, patch: Map<String, Value>) -> bool {
        let mut current = self.read_all().await;
        current.extend(patch); // key trùng → patch thắng, giống JS spread
        self.write(&current).await
    }

    /// Xoá một key khỏi metadata
    pub async fn delete(&self, key: &str) -> bool {
        let mut current = self.read_all().await;
        current.remove(key);
        self.write(&current).await
    }
}