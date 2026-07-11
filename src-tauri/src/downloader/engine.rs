use crate::downloader::budget::{BudgetConfig, GlobalBudget};
use crate::downloader::chunk_manager::{adaptive_chunk_size, build_chunks, ChunkManager, ChunkManagerOptions};
use crate::downloader::disk_manager::DiskManager;
use crate::downloader::error::{EngineError, Result};
use crate::downloader::events::{Event, EventBus};
use crate::downloader::integrity;
use crate::downloader::move_engine::{MoveQueue, ProgressiveWriter};
use crate::downloader::state_manager::{now_ms, StateManager};
use crate::downloader::types::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::{broadcast, Mutex, Semaphore};
use tokio_util::sync::CancellationToken;

struct RunningTask {
    task: Task,
    cancel: CancellationToken,
    paused_intentionally: Arc<AtomicBool>,
}

pub struct DownloaderEngine {
    config: StdMutex<DownloaderConfig>,
    disk: Arc<DiskManager>,
    state: Arc<StateManager>,
    budget: Arc<GlobalBudget>,
    events: EventBus,
    client: reqwest::Client,
    move_queue: Arc<MoveQueue>,
    concurrency: Arc<Semaphore>,
    tasks: Mutex<HashMap<String, RunningTask>>,
}

impl DownloaderEngine {
    pub async fn new(config: DownloaderConfig) -> Result<Arc<Self>> {
        let state_dir = PathBuf::from(&config.save_dir).join(".ipsw-state");
        let state = Arc::new(StateManager::new(state_dir).await?);
        let disk = Arc::new(DiskManager::with_default_probe());
        let budget = Arc::new(GlobalBudget::new(BudgetConfig {
            min_per_task: config.min_connections_per_task,
            max_per_task: config.max_connections_per_task,
            boost: config.boost,
            boost_multiplier: config.boost_multiplier,
        }));
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(config.insecure_tls)
            .pool_max_idle_per_host(config.max_connections_per_task as usize * 2)
            .connect_timeout(std::time::Duration::from_secs(30))
            .timeout(std::time::Duration::from_secs(300))
            .build()?;

        let engine = Arc::new(Self {
            concurrency: Arc::new(Semaphore::new(config.max_concurrent_tasks)),
            config: StdMutex::new(config.clone()),
            disk,
            state: Arc::clone(&state),
            budget,
            events: EventBus::new(),
            client,
            move_queue: Arc::new(MoveQueue::new()),
            tasks: Mutex::new(HashMap::new()),
        });

        log::info!("DownloaderEngine created, save_dir={} state_dir={:?}", config.save_dir, state.state_dir());

        if config.auto_resume {
            engine.clone().recover_on_startup().await;
        }

        Ok(engine)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.events.subscribe()
    }

    pub fn set_boost(&self, enabled: bool) {
        self.config.lock().unwrap().boost = enabled;
        self.budget.set_boost(enabled);
    }

    pub async fn add(self: &Arc<Self>, firmware: Firmware, save_path: String) -> AddResult {
        let id = uuid::Uuid::new_v4().to_string();

        {
            let tasks = self.tasks.lock().await;
            if tasks
                .values()
                .any(|t| t.task.save_path == save_path && t.task.status != TaskStatus::Error)
            {
                return AddResult {
                    success: false,
                    id: None,
                    error: Some(AddError::AlreadyInList),
                };
            }
        }

        if reqwest::Url::parse(&firmware.url).is_err() {
            return AddResult {
                success: false,
                id: None,
                error: Some(AddError::InvalidUrl),
            };
        }

        let buffer_bytes = self.config.lock().unwrap().disk_buffer_gb * 1024 * 1024 * 1024;
        let (ok, available, required) =
            self.disk
                .has_enough_space(Path::new(&save_path), firmware.filesize, buffer_bytes).await;
        log::info!(
            "dm_add check: firmware={} buffer_gb={} available={} required={} ok={} save_path={}",
            firmware.filesize,
            self.config.lock().unwrap().disk_buffer_gb,
            available,
            required,
            ok,
            save_path
        );
        if !ok {
            return AddResult {
                success: false,
                id: None,
                error: Some(AddError::DiskFull),
            };
        }

        self.disk.reserve_space(&id, firmware.filesize);

        let task = Task {
            id: id.clone(),
            firmware: firmware.clone(),
            progress: 0.0,
            speed: 0.0,
            status: TaskStatus::Queued,
            eta: None,
            error: None,
            save_path: save_path.clone(),
            active_connections: 0,
        };

        {
            let mut tasks = self.tasks.lock().await;
            tasks.insert(
                id.clone(),
                RunningTask {
                    task: task.clone(),
                    cancel: CancellationToken::new(),
                    paused_intentionally: Arc::new(AtomicBool::new(false)),
                },
            );
        }
        self.events
            .emit(Event::Added { task_id: id.clone(), task });

        self.spawn_run(id.clone(), firmware, save_path, None);
        AddResult {
            success: true,
            id: Some(id),
            error: None,
        }
    }

    pub async fn pause(&self, id: &str) -> LifecycleResult {
        log::info!("pause: id={} — sending cancel signal", id);
        let task_snapshot;
        {
            let mut tasks = self.tasks.lock().await;
            let Some(rt) = tasks.get_mut(id) else {
                log::warn!("pause: id={} not found", id);
                return LifecycleResult {
                    success: false,
                    error: Some(LifecycleError::NotFound),
                };
            };
            if matches!(
                rt.task.status,
                TaskStatus::Verifying | TaskStatus::Moving
            ) {
                log::warn!("pause: id={} invalid status {:?}", id, rt.task.status);
                return LifecycleResult {
                    success: false,
                    error: Some(LifecycleError::InvalidStatus),
                };
            }
            rt.paused_intentionally.store(true, Ordering::SeqCst);
            rt.task.status = TaskStatus::Paused;
            task_snapshot = rt.task.clone();
            rt.cancel.cancel();
            log::info!("pause: id={} cancel signal sent, status=Paused", id);
        }
        self.events
            .emit(Event::Paused { task_id: id.to_string(), task: task_snapshot });
        LifecycleResult {
            success: true,
            error: None,
        }
    }

    pub async fn resume(self: &Arc<Self>, id: &str) -> LifecycleResult {
        log::info!("resume: id={} — entering", id);
        let existing_status = {
            let tasks = self.tasks.lock().await;
            tasks.get(id).map(|t| t.task.status)
        };
        match existing_status {
            Some(TaskStatus::Paused) | Some(TaskStatus::Error) => {}
            Some(other) => {
                log::warn!("resume: id={} invalid status {:?}", id, other);
                return LifecycleResult {
                    success: false,
                    error: Some(LifecycleError::InvalidStatus),
                }
            }
            None => {
                log::warn!("resume: id={} not found", id);
                return LifecycleResult {
                    success: false,
                    error: Some(LifecycleError::NotFound),
                }
            }
        }

        let Some(state) = self.state.load(id).await else {
            log::warn!("resume: id={} state not found on disk", id);
            return LifecycleResult {
                success: false,
                error: Some(LifecycleError::NotFound),
            };
        };

        log::info!("resume: id={} state loaded, total_size={}, chunks={}", id, state.total_size, state.chunks.len());

        let task_snapshot = {
            let mut tasks = self.tasks.lock().await;
            if let Some(rt) = tasks.get_mut(id) {
                rt.cancel = CancellationToken::new();
                rt.paused_intentionally.store(false, Ordering::SeqCst);
                rt.task.status = TaskStatus::Queued;
                log::info!("resume: id={} CancellationToken refreshed, status=Queued", id);
                Some(rt.task.clone())
            } else {
                log::warn!("resume: id={} vanished from task map after state load", id);
                None
            }
        };
        self.spawn_run(
            id.to_string(),
            state.firmware.clone(),
            state.save_path.clone(),
            Some(state),
        );
        if let Some(task) = task_snapshot {
            self.events.emit(Event::Resumed {
                task_id: id.to_string(),
                task,
            });
        }
        LifecycleResult {
            success: true,
            error: None,
        }
    }

    pub async fn cancel(&self, id: &str) -> LifecycleResult {
        let mut tasks = self.tasks.lock().await;
        let Some(rt) = tasks.remove(id) else {
            return LifecycleResult {
                success: false,
                error: Some(LifecycleError::NotFound),
            };
        };
        rt.cancel.cancel();
        drop(tasks);

        self.disk.release_space(id);
        let _ = self.state.delete(id).await;
        if let Some(state) = self.state.load(id).await {
            let _ = tokio::fs::remove_file(&state.tmp_path).await;
        }
        self.events
            .emit(Event::Cancelled { task_id: id.to_string() });
        LifecycleResult {
            success: true,
            error: None,
        }
    }

    pub async fn get_all_tasks(&self) -> Vec<Task> {
        self.tasks.lock().await.values().map(|t| t.task.clone()).collect()
    }

    pub async fn get_incomplete_tasks(&self) -> Vec<IncompleteTask> {
        let active_ids: Vec<String> = self.tasks.lock().await.keys().cloned().collect();
        self.state
            .list_all()
            .await
            .into_iter()
            .filter(|s| !active_ids.contains(&s.id))
            .map(|s| {
                let downloaded: u64 = s.chunks.iter().map(|c| c.downloaded).sum();
                let progress = if s.total_size > 0 {
                    downloaded as f64 / s.total_size as f64 * 100.0
                } else {
                    0.0
                };
                IncompleteTask {
                    id: s.id.clone(),
                    firmware: s.firmware,
                    save_path: s.save_path,
                    tmp_path: s.tmp_path.clone(),
                    total_size: s.total_size,
                    downloaded_bytes: downloaded,
                    progress,
                    tmp_exists: Path::new(&s.tmp_path).exists(),
                    saved_at: s.updated_at,
                }
            })
            .collect()
    }

    pub async fn delete_incomplete(&self, id: &str) -> LifecycleResult {
        let Some(state) = self.state.load(id).await else {
            return LifecycleResult {
                success: false,
                error: Some(LifecycleError::NotFound),
            };
        };
        let _ = tokio::fs::remove_file(&state.tmp_path).await;
        let _ = self.state.delete(id).await;
        self.events
            .emit(Event::IncompleteDeleted { id: id.to_string() });
        LifecycleResult {
            success: true,
            error: None,
        }
    }

    pub async fn resume_incomplete(self: &Arc<Self>, id: &str) -> LifecycleResult {
        let Some(state) = self.state.load(id).await else {
            return LifecycleResult {
                success: false,
                error: Some(LifecycleError::NotFound),
            };
        };
        let task = Task {
            id: id.to_string(),
            firmware: state.firmware.clone(),
            progress: 0.0,
            speed: 0.0,
            status: TaskStatus::Queued,
            eta: None,
            error: None,
            save_path: state.save_path.clone(),
            active_connections: 0,
        };
        {
            let mut tasks = self.tasks.lock().await;
            tasks.insert(
                id.to_string(),
                RunningTask {
                    task,
                    cancel: CancellationToken::new(),
                    paused_intentionally: Arc::new(AtomicBool::new(false)),
                },
            );
        }
        self.spawn_run(
            id.to_string(),
            state.firmware.clone(),
            state.save_path.clone(),
            Some(state),
        );
        LifecycleResult {
            success: true,
            error: None,
        }
    }

    pub async fn environment_info(&self, save_path: &str) -> DiskEnvironmentInfo {
        self.disk.environment_info(Path::new(save_path)).await
    }

    async fn recover_on_startup(self: Arc<Self>) {
        for state in self.state.list_all().await {
            let tmp_exists = Path::new(&state.tmp_path).exists();
            if !tmp_exists && state.active_operation == ActiveOperation::Download {
                let mut reset = state.clone();
                for c in &mut reset.chunks {
                    c.downloaded = 0;
                    c.completed = false;
                }
                let _ = self.state.save(&reset).await;
            } else if !tmp_exists {
                let _ = self.state.delete(&state.id).await;
                continue;
            }

            let task = Task {
                id: state.id.clone(),
                firmware: state.firmware.clone(),
                progress: 0.0,
                speed: 0.0,
                status: if state.task_status == TaskStatus::Paused {
                    TaskStatus::Paused
                } else {
                    TaskStatus::Queued
                },
                eta: None,
                error: None,
                save_path: state.save_path.clone(),
                active_connections: 0,
            };
            let mut tasks = self.tasks.lock().await;
            tasks.insert(
                state.id.clone(),
                RunningTask {
                    task,
                    cancel: CancellationToken::new(),
                    paused_intentionally: Arc::new(AtomicBool::new(false)),
                },
            );
            drop(tasks);

            if state.task_status != TaskStatus::Paused {
                self.clone().spawn_run(
                    state.id.clone(),
                    state.firmware.clone(),
                    state.save_path.clone(),
                    Some(state),
                );
            }
        }
    }

    fn spawn_run(
        self: &Arc<Self>,
        id: String,
        firmware: Firmware,
        save_path: String,
        resume_state: Option<DownloadState>,
    ) {
        let engine = self.clone();
        tokio::spawn(async move {
            let cancel = {
                let tasks = engine.tasks.lock().await;
                tasks.get(&id).map(|t| t.cancel.clone())
            };
            let Some(cancel) = cancel else {
                log::warn!("spawn_run: id={} task not in map, aborting", id);
                return;
            };

            log::info!("spawn_run: id={} waiting for concurrency permit...", id);
            let permit = tokio::select! {
                p = engine.concurrency.acquire() => p,
                _ = cancel.cancelled() => {
                    log::info!("spawn_run: id={} cancelled while waiting for permit", id);
                    return;
                },
            };
            let Ok(_permit) = permit else {
                log::error!("spawn_run: id={} semaphore closed", id);
                return;
            };
            log::info!("spawn_run: id={} permit acquired, entering pipeline", id);

            let result = engine
                .run_pipeline(&id, firmware, save_path, resume_state, cancel.clone())
                .await;

            match result {
                Ok(()) => {}
                Err(EngineError::Aborted) => {
                    log::info!("spawn_run: id={} pipeline aborted (paused)", id);
                    let mut tasks = engine.tasks.lock().await;
                    if let Some(rt) = tasks.get_mut(&id) {
                        if rt.paused_intentionally.load(Ordering::SeqCst) {
                            if rt.task.status != TaskStatus::Paused {
                                rt.task.status = TaskStatus::Paused;
                                let t = rt.task.clone();
                                drop(tasks);
                                engine
                                    .events
                                    .emit(Event::Paused { task_id: id.clone(), task: t });
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("spawn_run: id={} pipeline error: {}", id, e);
                    let mut tasks = engine.tasks.lock().await;
                    if let Some(rt) = tasks.get_mut(&id) {
                        rt.task.status = TaskStatus::Error;
                        rt.task.error = Some(e.to_string());
                        let t = rt.task.clone();
                        drop(tasks);
                        engine.events.emit(Event::Error {
                            task_id: id.clone(),
                            error: e.to_string(),
                            task: t,
                        });
                    }
                    engine.disk.release_space(&id);
                }
            }
        });
    }

    async fn set_status(&self, id: &str, status: TaskStatus) {
        let mut tasks = self.tasks.lock().await;
        if let Some(rt) = tasks.get_mut(id) {
            rt.task.status = status;
        }
    }

    async fn emit_progress(&self, id: &str, progress: f64, speed: f64, connections: u32) {
        let mut tasks = self.tasks.lock().await;
        if let Some(rt) = tasks.get_mut(id) {
            if rt.paused_intentionally.load(Ordering::Relaxed) {
                return;
            }
            rt.task.progress = progress;
            rt.task.speed = speed;
            rt.task.active_connections = connections;
            rt.task.status = TaskStatus::Downloading;
            let t = rt.task.clone();
            drop(tasks);
            self.events
                .emit(Event::Progress { task_id: id.to_string(), task: t });
        }
    }

    async fn run_pipeline(
        self: &Arc<Self>,
        id: &str,
        firmware: Firmware,
        save_path: String,
        resume_state: Option<DownloadState>,
        cancel: CancellationToken,
    ) -> Result<()> {
        let cfg = self.config.lock().unwrap().clone();

        log::info!("run_pipeline: id={} save_path={}", id, save_path);

        let env_info = self.disk.environment_info(Path::new(&save_path)).await;
        log::info!("env_info: {:?}", env_info.environment);

        let mut state = if let Some(s) = resume_state {
            s
        } else {
            let opts = ChunkManagerOptions {
                retry_limit: cfg.retry_limit,
                retry_delay_ms: cfg.retry_delay_ms,
                insecure_tls: cfg.insecure_tls,
            };
            let probe = ChunkManager::new(
                self.client.clone(),
                self.budget.clone(),
                id.to_string(),
                firmware.url.clone(),
                opts,
            );
            let (content_len, supports_ranges) = probe.fetch_metadata().await?;
            let total_size = if content_len > 0 {
                content_len
            } else {
                firmware.filesize
            };

            let tmp_dir = match env_info.environment {
                DlEnvironment::SsdSave => Path::new(&save_path)
                    .parent()
                    .map(|p| p.to_path_buf()),
                _ => self
                    .disk
                    .choose_tmp_dir(
                        Path::new(&save_path),
                        total_size,
                        total_size,
                        cfg.tmp_dir.as_deref().map(Path::new),
                    )
                    .await
                    .or_else(|| Path::new(&save_path).parent().map(|p| p.to_path_buf())),
            }
            .ok_or_else(|| EngineError::Other("no writable directory available".into()))?;
            log::info!("tmp_dir={:?}", tmp_dir);
            tokio::fs::create_dir_all(&tmp_dir).await.map_err(|e| {
                log::error!("create_dir_all failed for {:?}: {}", tmp_dir, e);
                EngineError::Io(e)
            })?;

            let file_stem = Path::new(&save_path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| id.to_string());
            let tmp_path = tmp_dir.join(format!("{file_stem}.tmp"));

            let chunk_size = adaptive_chunk_size(total_size);
            let chunks = if supports_ranges {
                build_chunks(total_size, chunk_size)
            } else {
                vec![ChunkState {
                    index: 0,
                    start: 0,
                    end: total_size.saturating_sub(1),
                    downloaded: 0,
                    completed: false,
                }]
            };

            DownloadState {
                id: id.to_string(),
                firmware: firmware.clone(),
                save_path: save_path.clone(),
                tmp_path: tmp_path.to_string_lossy().to_string(),
                total_size,
                chunks,
                supports_ranges,
                created_at: now_ms(),
                updated_at: now_ms(),
                moved_chunks: vec![],
                active_operation: ActiveOperation::Download,
                last_checkpoint: now_ms(),
                last_write_time: 0,
                task_status: TaskStatus::Downloading,
            }
        };
        state.active_operation = ActiveOperation::Download;
        self.state.save(&state).await?;
        self.set_status(id, TaskStatus::Downloading).await;

        let opts = ChunkManagerOptions {
            retry_limit: cfg.retry_limit,
            retry_delay_ms: cfg.retry_delay_ms,
            insecure_tls: cfg.insecure_tls,
        };
        let chunk_mgr = ChunkManager::new(
            self.client.clone(),
            self.budget.clone(),
            id.to_string(),
            state.firmware.url.clone(),
            opts,
        );
        let chunks = Arc::new(StdMutex::new(state.chunks.clone()));

        let progressive = if env_info.environment == DlEnvironment::HddSsdTmp {
            ProgressiveWriter::new(
                PathBuf::from(&state.tmp_path),
                PathBuf::from(&state.save_path),
                state.total_size,
                self.state.clone(),
                id.to_string(),
                2,
            )
            .await
            .ok()
            .map(Arc::new)
        } else {
            None
        };
        let on_chunk_complete: Option<Arc<dyn Fn(usize) + Send + Sync>> =
            progressive.clone().map(|pw| {
                let chunks = chunks.clone();
                Arc::new(move |idx: usize| {
                    let pw = pw.clone();
                    let chunk = chunks.lock().unwrap()[idx].clone();
                    tokio::spawn(async move {
                        let _ = pw.move_chunk(&chunk).await;
                    });
                }) as Arc<dyn Fn(usize) + Send + Sync>
            });

        let engine = self.clone();
        let id_owned = id.to_string();
        let checkpoint_chunks = chunks.clone();
        let state_for_checkpoint = state.clone();
        let cancel_for_progress = cancel.clone();

        let download_result = chunk_mgr
            .run(
                Path::new(&state.tmp_path),
                chunks.clone(),
                cancel.clone(),
                move |downloaded, speed| {
                    let progress = if state_for_checkpoint.total_size > 0 {
                        downloaded as f64 / state_for_checkpoint.total_size as f64 * 100.0
                    } else {
                        0.0
                    };
                    let connections = engine.budget.current_allocation(&id_owned);
                    let engine2 = engine.clone();
                    let id2 = id_owned.clone();
                    tokio::spawn(async move {
                        engine2
                            .emit_progress(&id2, progress, speed, connections)
                            .await;
                    });
                    let _ = &cancel_for_progress;
                    let _ = &checkpoint_chunks;
                },
                on_chunk_complete,
            )
            .await;

        state.chunks = chunks.lock().unwrap().clone();
        self.state.save(&state).await?;

        download_result?;

        if !cfg.skip_verify {
            state.active_operation = ActiveOperation::Verify;
            self.state.save(&state).await?;
            self.set_status(id, TaskStatus::Verifying).await;
            let outcome = integrity::verify(
                Path::new(&state.tmp_path),
                &state.firmware,
                &cancel,
                |_p| {},
            )
            .await?;
            if !outcome.ok {
                return Err(EngineError::HashMismatch {
                    expected: outcome.expected,
                    actual: outcome.actual,
                });
            }
        }

        state.active_operation = ActiveOperation::Move;
        self.state.save(&state).await?;
        self.set_status(id, TaskStatus::Moving).await;

        let is_hdd = env_info.save_drive.media_type == DlMediaType::Hdd;
        let already_final = state.tmp_path == state.save_path;
        if !already_final {
            let moved_set: std::collections::HashSet<usize> =
                state.moved_chunks.iter().copied().collect();
            let all_moved = !state.chunks.is_empty()
                && state.chunks.iter().all(|c| moved_set.contains(&c.index));
            if all_moved {
                let _ = tokio::fs::remove_file(&state.tmp_path).await;
            } else {
                self.move_queue
                    .enqueue(
                        Path::new(&state.tmp_path),
                        Path::new(&state.save_path),
                        is_hdd,
                        |_p| {},
                    )
                    .await
                    .map_err(EngineError::Io)?;
            }
        }

        self.state.delete(id).await?;
        self.disk.release_space(id);
        let mut tasks = self.tasks.lock().await;
        if let Some(rt) = tasks.get_mut(id) {
            rt.task.status = TaskStatus::Completed;
            rt.task.progress = 100.0;
            let t = rt.task.clone();
            drop(tasks);
            self.events
                .emit(Event::Completed { task_id: id.to_string(), task: t });
        }
        Ok(())
    }
}
