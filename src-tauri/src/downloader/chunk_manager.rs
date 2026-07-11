use crate::downloader::budget::GlobalBudget;
use crate::downloader::error::{EngineError, Result};
use crate::downloader::types::ChunkState;
use futures_util::StreamExt;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

const SPEED_WINDOW: Duration = Duration::from_secs(8);
const SPEED_ALPHA: f64 = 0.15;
const RECHECK_INTERVAL: Duration = Duration::from_millis(500);

pub struct ChunkManagerOptions {
    pub retry_limit: u32,
    pub retry_delay_ms: u64,
    pub insecure_tls: bool,
}

pub struct ChunkManager {
    client: reqwest::Client,
    budget: Arc<GlobalBudget>,
    task_id: String,
    url: String,
    opts: ChunkManagerOptions,
}

fn write_at(file: &std::fs::File, offset: u64, buf: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        file.write_all_at(buf, offset)
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut written = 0usize;
        while written < buf.len() {
            let n = file.seek_write(&buf[written..], offset + written as u64)?;
            if n == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::WriteZero,
                    "seek_write wrote 0 bytes",
                ));
            }
            written += n;
        }
        Ok(())
    }
}

impl ChunkManager {
    pub fn new(
        client: reqwest::Client,
        budget: Arc<GlobalBudget>,
        task_id: String,
        url: String,
        opts: ChunkManagerOptions,
    ) -> Self {
        Self {
            client,
            budget,
            task_id,
            url,
            opts,
        }
    }

    pub async fn fetch_metadata(&self) -> Result<(u64, bool)> {
        let resp = self.client.head(&self.url).send().await?;
        let len = resp
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        let accepts_ranges = resp
            .headers()
            .get(reqwest::header::ACCEPT_RANGES)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.eq_ignore_ascii_case("bytes"))
            .unwrap_or(false);
        Ok((len, accepts_ranges))
    }

    pub async fn run(
        &self,
        file_path: &Path,
        chunks: Arc<Mutex<Vec<ChunkState>>>,
        cancel: CancellationToken,
        mut on_progress: impl FnMut(u64, f64) + Send,
        on_chunk_complete: Option<Arc<dyn Fn(usize) + Send + Sync>>,
    ) -> Result<()> {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(file_path)?;
        let total_size: u64 = {
            chunks
                .lock()
                .unwrap()
                .iter()
                .map(|c| c.end - c.start + 1)
                .sum()
        };
        if file.metadata()?.len() < total_size {
            file.set_len(total_size)?;
        }
        let file = Arc::new(file);

        self.budget.register(&self.task_id);

        let pending: std::collections::VecDeque<usize> = {
            let guard = chunks.lock().unwrap();
            guard
                .iter()
                .enumerate()
                .filter(|(_, c)| !c.completed)
                .map(|(i, _)| i)
                .collect()
        };
        let pending = Arc::new(Mutex::new(pending));

        let downloaded_total = Arc::new(AtomicU64::new({
            chunks
                .lock()
                .unwrap()
                .iter()
                .map(|c| c.downloaded)
                .sum()
        }));

        let mut samples: std::collections::VecDeque<(Instant, u64)> =
            std::collections::VecDeque::new();
        let mut smoothed_speed = 0.0_f64;

        let mut join_set: JoinSet<Result<()>> = JoinSet::new();

        let (result, should_drain) = loop {
            if cancel.is_cancelled() {
                break (Err(EngineError::Aborted), true);
            }

            let allowed = self.budget.report_speed(&self.task_id, smoothed_speed) as usize;
            while join_set.len() < allowed.max(1) {
                let next_idx = { pending.lock().unwrap().pop_front() };
                let Some(idx) = next_idx else { break };

                let client = self.client.clone();
                let url = self.url.clone();
                let file = file.clone();
                let chunks = chunks.clone();
                let downloaded_total = downloaded_total.clone();
                let cancel2 = cancel.clone();
                let retry_limit = self.opts.retry_limit;
                let retry_delay_ms = self.opts.retry_delay_ms;
                let on_chunk_complete = on_chunk_complete.clone();

                join_set.spawn(async move {
                    let r = download_one_chunk(
                        client,
                        url,
                        idx,
                        chunks,
                        file,
                        downloaded_total,
                        cancel2,
                        retry_limit,
                        retry_delay_ms,
                    )
                    .await;
                    if r.is_ok() {
                        if let Some(cb) = on_chunk_complete {
                            cb(idx);
                        }
                    }
                    r
                });
            }

            if join_set.is_empty() {
                if pending.lock().unwrap().is_empty() {
                    break (Ok(()), false);
                }
                tokio::time::sleep(RECHECK_INTERVAL).await;
                continue;
            }

            tokio::select! {
                joined = join_set.join_next() => {
                    match joined {
                        Some(Ok(Ok(()))) => {}
                        Some(Ok(Err(e))) => break (Err(e), true),
                        Some(Err(e)) => break (Err(EngineError::Other(format!("join error: {e}"))), true),
                        None => {}
                    }
                }
                _ = tokio::time::sleep(RECHECK_INTERVAL) => {}
            }

            let now = Instant::now();
            let total_now = downloaded_total.load(Ordering::Relaxed);
            samples.push_back((now, total_now));
            while let Some((t, _)) = samples.front() {
                if now.duration_since(*t) > SPEED_WINDOW {
                    samples.pop_front();
                } else {
                    break;
                }
            }
            if let Some((t0, d0)) = samples.front().copied() {
                let elapsed = now.duration_since(t0).as_secs_f64().max(0.001);
                let window_speed = (total_now.saturating_sub(d0)) as f64 / elapsed;
                smoothed_speed = if smoothed_speed == 0.0 {
                    window_speed
                } else {
                    smoothed_speed * (1.0 - SPEED_ALPHA) + window_speed * SPEED_ALPHA
                };
                on_progress(total_now, smoothed_speed);
            }
        };

        if should_drain {
            log::info!(
                "chunk_mgr: draining {} in-flight chunk tasks for task={}",
                join_set.len(),
                self.task_id
            );
            join_set.abort_all();
            while join_set.join_next().await.is_some() {}
        }

        self.budget.unregister(&self.task_id);
        result
    }
}

#[allow(clippy::too_many_arguments)]
async fn download_one_chunk(
    client: reqwest::Client,
    url: String,
    idx: usize,
    chunks: Arc<Mutex<Vec<ChunkState>>>,
    file: Arc<std::fs::File>,
    downloaded_total: Arc<AtomicU64>,
    cancel: CancellationToken,
    retry_limit: u32,
    retry_delay_ms: u64,
) -> Result<()> {
    let (mut start, end) = {
        let guard = chunks.lock().unwrap();
        let c = &guard[idx];
        (c.start + c.downloaded, c.end)
    };
    if start > end {
        mark_complete(&chunks, idx);
        return Ok(());
    }

    let mut attempt = 0u32;
    loop {
        if cancel.is_cancelled() {
            return Err(EngineError::Aborted);
        }
        match try_download_range(
            &client, &url, start, end, &file, idx, &chunks, &downloaded_total, &cancel,
        )
        .await
        {
            Ok(()) => {
                mark_complete(&chunks, idx);
                return Ok(());
            }
            Err(e) => {
                attempt += 1;
                if attempt >= retry_limit {
                    return Err(e);
                }
                start = chunks.lock().unwrap()[idx].start + chunks.lock().unwrap()[idx].downloaded;
                tokio::time::sleep(Duration::from_millis(retry_delay_ms * attempt as u64)).await;
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn try_download_range(
    client: &reqwest::Client,
    url: &str,
    start: u64,
    end: u64,
    file: &Arc<std::fs::File>,
    idx: usize,
    chunks: &Arc<Mutex<Vec<ChunkState>>>,
    downloaded_total: &Arc<AtomicU64>,
    cancel: &CancellationToken,
) -> Result<()> {
    let range_header = format!("bytes={start}-{end}");
    if cancel.is_cancelled() {
        return Err(EngineError::Aborted);
    }
    let resp = client
        .get(url)
        .header(reqwest::header::RANGE, range_header)
        .send()
        .await?;

    let status = resp.status();
    if status != reqwest::StatusCode::PARTIAL_CONTENT && status != reqwest::StatusCode::OK {
        return Err(EngineError::Other(format!(
            "unexpected status {status} for range {start}-{end}"
        )));
    }

    let mut offset = start;
    let mut stream = resp.bytes_stream();
    while let Some(item) = stream.next().await {
        if cancel.is_cancelled() {
            return Err(EngineError::Aborted);
        }
        let bytes = item?;
        if bytes.is_empty() {
            continue;
        }
        let file = file.clone();
        let buf = bytes.to_vec();
        let write_offset = offset;
        tokio::task::spawn_blocking(move || write_at(&file, write_offset, &buf))
            .await
            .map_err(|e| EngineError::Other(format!("blocking write task panicked: {e}")))? ?;

        let n = bytes.len() as u64;
        offset += n;
        downloaded_total.fetch_add(n, Ordering::Relaxed);
        {
            let mut guard = chunks.lock().unwrap();
            let c = &mut guard[idx];
            c.downloaded = offset - c.start;
        }
    }

    Ok(())
}

fn mark_complete(chunks: &Arc<Mutex<Vec<ChunkState>>>, idx: usize) {
    let mut guard = chunks.lock().unwrap();
    guard[idx].completed = true;
    guard[idx].downloaded = guard[idx].end - guard[idx].start + 1;
}

pub fn adaptive_chunk_size(file_size: u64) -> u64 {
    const GB: u64 = 1024 * 1024 * 1024;
    if file_size < GB {
        16 * 1024 * 1024
    } else if file_size < 4 * GB {
        32 * 1024 * 1024
    } else if file_size < 10 * GB {
        64 * 1024 * 1024
    } else if file_size < 20 * GB {
        128 * 1024 * 1024
    } else {
        256 * 1024 * 1024
    }
}

pub fn build_chunks(total_size: u64, chunk_size: u64) -> Vec<ChunkState> {
    if total_size == 0 {
        return vec![ChunkState {
            index: 0,
            start: 0,
            end: 0,
            downloaded: 0,
            completed: false,
        }];
    }
    let mut chunks = Vec::new();
    let mut start = 0u64;
    let mut idx = 0usize;
    while start < total_size {
        let end = (start + chunk_size - 1).min(total_size - 1);
        chunks.push(ChunkState {
            index: idx,
            start,
            end,
            downloaded: 0,
            completed: false,
        });
        start = end + 1;
        idx += 1;
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adaptive_size_thresholds_match_spec() {
        const GB: u64 = 1024 * 1024 * 1024;
        assert_eq!(adaptive_chunk_size(500 * 1024 * 1024), 16 * 1024 * 1024);
        assert_eq!(adaptive_chunk_size(2 * GB), 32 * 1024 * 1024);
        assert_eq!(adaptive_chunk_size(8 * GB), 64 * 1024 * 1024);
        assert_eq!(adaptive_chunk_size(15 * GB), 128 * 1024 * 1024);
        assert_eq!(adaptive_chunk_size(25 * GB), 256 * 1024 * 1024);
    }

    #[test]
    fn build_chunks_covers_whole_file_with_no_gaps_or_overlap() {
        let chunks = build_chunks(100, 30);
        assert_eq!(chunks.len(), 4);
        assert_eq!(chunks[0].start, 0);
        assert_eq!(chunks.last().unwrap().end, 99);
        for w in chunks.windows(2) {
            assert_eq!(w[0].end + 1, w[1].start);
        }
    }
}
