use crate::downloader::error::{EngineError, Result};
use crate::downloader::stream_hash::{HashAlgo, StreamHasher};
use crate::downloader::types::Firmware;
use std::path::Path;
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

const MAX_RETRIES: u32 = 3;
const RETRY_DELAY_MS: u64 = 1000;
const VERIFY_ALPHA: f64 = 0.15;
const READ_CHUNK: usize = 64 * 1024 * 1024;

pub struct VerifyProgress {
    pub pct: u32,
    pub speed_bps: f64,
    pub eta_secs: f64,
}

pub struct VerifyOutcome {
    pub ok: bool,
    pub algo: Option<HashAlgo>,
    pub expected: String,
    pub actual: String,
}

fn pick_check(firmware: &Firmware) -> Option<(HashAlgo, String)> {
    if let Some(v) = &firmware.md5sum {
        if !v.is_empty() {
            return Some((HashAlgo::Md5, v.to_lowercase()));
        }
    }
    if let Some(v) = &firmware.sha1sum {
        if !v.is_empty() {
            return Some((HashAlgo::Sha1, v.to_lowercase()));
        }
    }
    if let Some(v) = &firmware.sha256sum {
        if !v.is_empty() {
            return Some((HashAlgo::Sha256, v.to_lowercase()));
        }
    }
    None
}

pub async fn verify(
    file_path: &Path,
    firmware: &Firmware,
    cancel: &CancellationToken,
    mut on_progress: impl FnMut(VerifyProgress),
) -> Result<VerifyOutcome> {
    let Some((algo, expected)) = pick_check(firmware) else {
        return Ok(VerifyOutcome {
            ok: true,
            algo: None,
            expected: String::new(),
            actual: String::new(),
        });
    };

    let total_size = tokio::fs::metadata(file_path).await?.len().max(1);
    let mut last_err: Option<EngineError> = None;

    for attempt in 0..MAX_RETRIES {
        if cancel.is_cancelled() {
            return Err(EngineError::Aborted);
        }

        match hash_whole_file(file_path, algo, total_size, cancel, &mut on_progress).await {
            Ok(actual) => {
                return Ok(VerifyOutcome {
                    ok: actual == expected,
                    algo: Some(algo),
                    expected,
                    actual,
                });
            }
            Err(e) => {
                last_err = Some(e);
                if attempt + 1 < MAX_RETRIES {
                    tokio::time::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS)).await;
                }
            }
        }
    }

    Err(last_err.unwrap_or_else(|| {
        EngineError::Other("hash verification failed after retries".into())
    }))
}

async fn hash_whole_file(
    file_path: &Path,
    algo: HashAlgo,
    total_size: u64,
    cancel: &CancellationToken,
    on_progress: &mut impl FnMut(VerifyProgress),
) -> Result<String> {
    let mut file = tokio::fs::File::open(file_path).await?;
    let mut hasher = StreamHasher::new(algo);
    let mut buf = vec![0u8; READ_CHUNK];
    let mut read_total: u64 = 0;

    let start = std::time::Instant::now();
    let mut smoothed_speed = 0.0_f64;
    let mut smoothed_eta = 0.0_f64;

    loop {
        if cancel.is_cancelled() {
            return Err(EngineError::Aborted);
        }
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        read_total += n as u64;

        let elapsed = start.elapsed().as_secs_f64().max(0.001);
        let raw_speed = read_total as f64 / elapsed;
        let remaining = total_size.saturating_sub(read_total) as f64;
        let raw_eta = if raw_speed > 0.0 {
            remaining / raw_speed
        } else {
            0.0
        };

        smoothed_speed = if smoothed_speed == 0.0 {
            raw_speed
        } else {
            smoothed_speed * (1.0 - VERIFY_ALPHA) + raw_speed * VERIFY_ALPHA
        };
        smoothed_eta = if smoothed_eta == 0.0 {
            raw_eta
        } else {
            smoothed_eta * (1.0 - VERIFY_ALPHA) + raw_eta * VERIFY_ALPHA
        };

        let pct = ((read_total as f64 / total_size as f64) * 100.0).floor() as u32;
        on_progress(VerifyProgress {
            pct,
            speed_bps: smoothed_speed,
            eta_secs: smoothed_eta.max(0.0),
        });
    }

    Ok(hasher.finalize())
}
