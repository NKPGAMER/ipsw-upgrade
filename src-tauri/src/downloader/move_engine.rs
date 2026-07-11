use crate::downloader::disk_manager::drive_key;
use crate::downloader::state_manager::StateManager;
use crate::downloader::types::ChunkState;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};

pub struct MoveProgress {
    pub pct: u32,
    pub speed_bps: f64,
}

pub struct MoveQueue {
    ssd_limit: usize,
    hdd_limit: usize,
    semaphores: Mutex<HashMap<String, Arc<Semaphore>>>,
}

impl MoveQueue {
    pub fn new() -> Self {
        Self {
            ssd_limit: 3,
            hdd_limit: 2,
            semaphores: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_hdd_limit(&mut self, n: usize) {
        self.hdd_limit = n;
    }

    async fn semaphore_for(&self, key: &str, limit: usize) -> Arc<Semaphore> {
        let mut map = self.semaphores.lock().await;
        map.entry(key.to_string())
            .or_insert_with(|| Arc::new(Semaphore::new(limit)))
            .clone()
    }

    pub async fn enqueue(
        &self,
        src: &Path,
        dest: &Path,
        is_hdd: bool,
        mut on_progress: impl FnMut(MoveProgress) + Send,
    ) -> std::io::Result<()> {
        let key = drive_key(dest);
        let limit = if is_hdd { self.hdd_limit } else { self.ssd_limit };
        let sem = self.semaphore_for(&key, limit).await;
        let _permit = sem.acquire().await.expect("semaphore closed");

        if let Some(dir) = dest.parent() {
            tokio::fs::create_dir_all(dir).await?;
        }

        if tokio::fs::rename(src, dest).await.is_ok() {
            on_progress(MoveProgress {
                pct: 100,
                speed_bps: 0.0,
            });
            return Ok(());
        }

        streamed_copy_with_progress(src, dest, &mut on_progress).await?;
        tokio::fs::remove_file(src).await?;
        Ok(())
    }
}

impl Default for MoveQueue {
    fn default() -> Self {
        Self::new()
    }
}

const MOVE_ALPHA: f64 = 0.15;
const COPY_BUF: usize = 8 * 1024 * 1024;

async fn streamed_copy_with_progress(
    src: &Path,
    dest: &Path,
    on_progress: &mut impl FnMut(MoveProgress),
) -> std::io::Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let total = tokio::fs::metadata(src).await?.len().max(1);
    let mut reader = tokio::fs::File::open(src).await?;
    let mut writer = tokio::fs::File::create(dest).await?;
    let mut buf = vec![0u8; COPY_BUF];
    let mut copied = 0u64;
    let start = std::time::Instant::now();
    let mut smoothed_speed = 0.0_f64;

    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).await?;
        copied += n as u64;

        let elapsed = start.elapsed().as_secs_f64().max(0.001);
        let raw_speed = copied as f64 / elapsed;
        smoothed_speed = if smoothed_speed == 0.0 {
            raw_speed
        } else {
            smoothed_speed * (1.0 - MOVE_ALPHA) + raw_speed * MOVE_ALPHA
        };
        let pct = ((copied as f64 / total as f64) * 100.0)
            .floor()
            .min(99.0) as u32;
        on_progress(MoveProgress {
            pct,
            speed_bps: smoothed_speed,
        });
    }
    writer.flush().await?;
    on_progress(MoveProgress {
        pct: 100,
        speed_bps: smoothed_speed,
    });
    Ok(())
}

pub struct ProgressiveWriter {
    tmp_path: PathBuf,
    final_path: PathBuf,
    state: Arc<StateManager>,
    task_id: String,
    sem: Arc<Semaphore>,
}

impl ProgressiveWriter {
    pub async fn new(
        tmp_path: PathBuf,
        final_path: PathBuf,
        total_size: u64,
        state: Arc<StateManager>,
        task_id: String,
        max_concurrency: usize,
    ) -> std::io::Result<Self> {
        if let Some(dir) = final_path.parent() {
            tokio::fs::create_dir_all(dir).await?;
        }
        if !tokio::fs::try_exists(&final_path).await.unwrap_or(false) {
            let f = tokio::fs::File::create(&final_path).await?;
            if total_size > 0 {
                f.set_len(total_size).await?;
            }
        }
        Ok(Self {
            tmp_path,
            final_path,
            state,
            task_id,
            sem: Arc::new(Semaphore::new(max_concurrency)),
        })
    }

    pub async fn move_chunk(&self, chunk: &ChunkState) -> std::io::Result<()> {
        let _permit = self.sem.acquire().await.expect("semaphore closed");
        let tmp_path = self.tmp_path.clone();
        let final_path = self.final_path.clone();
        let start = chunk.start;
        let len = (chunk.end - chunk.start + 1) as usize;

        tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            use std::io::{Read, Seek, SeekFrom, Write};
            let mut src = std::fs::File::open(&tmp_path)?;
            src.seek(SeekFrom::Start(start))?;
            let mut buf = vec![0u8; len];
            src.read_exact(&mut buf)?;

            let mut dst = std::fs::OpenOptions::new()
                .write(true)
                .open(&final_path)?;
            dst.seek(SeekFrom::Start(start))?;
            dst.write_all(&buf)?;
            Ok(())
        })
        .await
        .map_err(|e| std::io::Error::other(format!("blocking copy task panicked: {e}")))? ?;

        let _ = self.state.add_moved_chunk(&self.task_id, chunk.index).await;
        Ok(())
    }
}
