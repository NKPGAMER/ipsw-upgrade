use crate::downloader::engine::DownloaderEngine;
use crate::downloader::types::*;
use std::sync::Arc;

pub async fn add(
    engine: &Arc<DownloaderEngine>,
    firmware: Firmware,
    save_path: String,
) -> AddResult {
    engine.add(firmware, save_path).await
}

pub async fn pause(engine: &Arc<DownloaderEngine>, id: String) -> LifecycleResult {
    engine.pause(&id).await
}

pub async fn resume(engine: &Arc<DownloaderEngine>, id: String) -> LifecycleResult {
    engine.resume(&id).await
}

pub async fn cancel(engine: &Arc<DownloaderEngine>, id: String) -> LifecycleResult {
    engine.cancel(&id).await
}

pub async fn get_all_tasks(engine: &Arc<DownloaderEngine>) -> Vec<Task> {
    engine.get_all_tasks().await
}

pub async fn get_incomplete_tasks(engine: &Arc<DownloaderEngine>) -> Vec<IncompleteTask> {
    engine.get_incomplete_tasks().await
}

pub async fn resume_incomplete(
    engine: &Arc<DownloaderEngine>,
    id: String,
) -> LifecycleResult {
    engine.resume_incomplete(&id).await
}

pub async fn delete_incomplete(
    engine: &Arc<DownloaderEngine>,
    id: String,
) -> LifecycleResult {
    engine.delete_incomplete(&id).await
}

pub async fn get_environment_info(
    engine: &Arc<DownloaderEngine>,
    save_path: String,
) -> DiskEnvironmentInfo {
    engine.environment_info(&save_path).await
}

pub fn set_boost(engine: &Arc<DownloaderEngine>, enabled: bool) {
    engine.set_boost(enabled);
}
