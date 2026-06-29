use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Weak};
use std::time::Duration;

use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, Semaphore};
use tokio::time::sleep;

use super::ipsw_api::IpswAPI;
use super::meta_data::MetaData;
use super::user_data::UserData;
use crate::config::Config;
use crate::types::ipsw_api::{BaseDevice, DeviceWithIpsws};

// ─── Constants ────────────────────────────────────────────────────────────────

const FILES_DEVICES: &str = "devices.json";

// ─── Product type ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[derive(specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum Product {
    Iphone,
    Ipad,
    Watch,
    Mac,
    RealityDevice,
    Tv,
    Homepod,
    Ipod,
}

impl Product {
    pub fn as_str(&self) -> &'static str {
        match self {
            Product::Iphone => "iphone",
            Product::Ipad => "ipad",
            Product::Watch => "watch",
            Product::Mac => "mac",
            Product::RealityDevice => "realitydevice",
            Product::Tv => "tv",
            Product::Homepod => "homepod",
            Product::Ipod => "ipod",
        }
    }
}

const PRODUCT_PREFIX_MAP: &[(&str, Product)] = &[
    ("iphone", Product::Iphone),
    ("ipad", Product::Ipad),
    ("watch", Product::Watch),
    ("mac", Product::Mac),
    ("realitydevice", Product::RealityDevice),
    ("appletv", Product::Tv),
    ("homepod", Product::Homepod),
    ("audioaccessory", Product::Homepod),
    ("ipod", Product::Ipod),
];

// ─── Stored types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevicesData {
    pub data_version: String,
    pub last_release: String,
    pub devices: Vec<BaseDevice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductData {
    pub data_version: String,
    pub last_release: String,
    pub device: DeviceWithIpsws,
}

// ─── Get result ───────────────────────────────────────────────────────────────

pub enum GetResult {
    Ready(DeviceWithIpsws),
    Wait,
}

// ─── DataHandle ───────────────────────────────────────────────────────────────

pub struct DataHandle {
    app: AppHandle,
    api: IpswAPI,
    meta: MetaData,
    user_data: UserData,
    config: Config,

    devices: Mutex<Vec<BaseDevice>>,
    model_map: Mutex<HashMap<String, ProductData>>,

    update_set: Mutex<Option<HashSet<String>>>,
    latest_release: Mutex<String>,

    // FIX: dùng oneshot sender list thay vì watch::Receiver để dedup đúng cách
    // Key: identifier, Value: list of oneshot senders chờ kết quả
    inflight: Mutex<HashMap<String, Vec<tokio::sync::oneshot::Sender<Option<DeviceWithIpsws>>>>>,
    active_ids: Mutex<HashSet<String>>,

    semaphore: Arc<Semaphore>,
    self_weak: Weak<DataHandle>,
}

impl DataHandle {
    pub fn new(
        app: AppHandle,
        api: IpswAPI,
        meta: MetaData,
        user_data: UserData,
        config: Config,
        self_weak: Weak<DataHandle>,
    ) -> Self {
        let max_concurrent = config.max_concurrent_fetches;
        Self {
            app,
            api,
            meta,
            user_data,
            config,
            devices: Mutex::new(Vec::new()),
            model_map: Mutex::new(HashMap::new()),
            update_set: Mutex::new(None),
            latest_release: Mutex::new(String::new()),
            inflight: Mutex::new(HashMap::new()),
            active_ids: Mutex::new(HashSet::new()),
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
            self_weak,
        }
    }

    // ── IPC ───────────────────────────────────────────────────────────────────

    fn send_event(&self, channel: &str, payload: impl Serialize + Clone) {
        let full = format!("dh:{channel}");
        if let Err(e) = self.app.emit(&full, payload) {
            eprintln!("[DataHandle] send_event error on {full}: {e}");
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    async fn needs_update(
        &self,
        identifier: &str,
        stored_release: &str,
        stored_version: &str,
    ) -> bool {
        if stored_version != self.config.data_version {
            return true;
        }

        let latest = self.latest_release.lock().await.clone();
        if stored_release == latest.as_str() {
            return false;
        }

        let update_set = self.update_set.lock().await;
        match &*update_set {
            None => true,
            Some(set) => set.contains(identifier),
        }
    }

    fn get_product_type(&self, identifier: &str) -> Option<Product> {
        let lower = identifier.to_lowercase();
        for (prefix, product) in PRODUCT_PREFIX_MAP {
            if lower.starts_with(prefix) {
                return Some(product.clone());
            }
        }
        None
    }

    async fn validate_or_delete_devices(&self, stored: &DevicesData) -> bool {
        if stored.data_version.is_empty() || stored.data_version != self.config.data_version {
            let _ = self.user_data.delete(FILES_DEVICES).await;
            return false;
        }
        if stored.last_release.is_empty() || stored.devices.is_empty() {
            let _ = self.user_data.delete(FILES_DEVICES).await;
            return false;
        }
        true
    }

    async fn validate_or_delete_product(&self, file: &str, stored: &ProductData) -> bool {
        if stored.data_version.is_empty() || stored.data_version != self.config.data_version {
            let _ = self.user_data.delete(file).await;
            return false;
        }
        if stored.last_release.is_empty() {
            let _ = self.user_data.delete(file).await;
            return false;
        }
        true
    }

    // ── Fetch with retry ──────────────────────────────────────────────────────

    async fn fetch_with_retry<T, F, Fut>(&self, f: F) -> Option<T>
    where
        F: Fn() -> Fut,
        Fut: std::future::Future<Output = anyhow::Result<Option<T>>>,
    {
        for attempt in 0..=self.config.max_retries {
            match f().await {
                Ok(Some(data)) => return Some(data),
                Ok(None) => return None, // permanent: not found
                Err(_) => {
                    if attempt < self.config.max_retries {
                        let delay = self.config.retry_base_delay_ms * 2u64.pow(attempt as u32);
                        sleep(Duration::from_millis(delay)).await;
                    }
                }
            }
        }
        None
    }

    // ── Build update set ──────────────────────────────────────────────────────

    async fn build_update_set(&self) -> anyhow::Result<Option<HashSet<String>>> {
        println!("[DataHandle] build_update_set() start");

        let releases_result = self.api.get_releases().await;

        if !releases_result.success {
            if releases_result.error.as_deref().unwrap_or("").contains("429") {
                if let Some(stored) = self.meta.read::<String>("lastRelease").await {
                    *self.latest_release.lock().await = stored;
                    return Ok(None);
                }
            }
            anyhow::bail!("Failed to fetch releases: {:?}", releases_result.error);
        }

        let releases_data = releases_result.data.unwrap();
        let latest_date = releases_data[0].date.clone();
        let stored_release = self.meta.read::<String>("lastRelease").await;

        if stored_release.as_deref() == Some(&latest_date) {
            println!("[DataHandle] build_update_set() release unchanged: {latest_date}");
            *self.latest_release.lock().await = latest_date;
            return Ok(Some(HashSet::new()));
        }

        let mut version_set: HashSet<String> = HashSet::new();
        for release in &releases_data[0].releases {
            if release.r#type.contains("OTA") {
                continue;
            }
            let parts: Vec<&str> = release.name.split(' ').collect();
            if parts.len() >= 2 {
                version_set.insert(parts[1].to_string());
            }
        }

        println!(
            "[DataHandle] build_update_set() unique versions: {}",
            version_set.len()
        );

        let mut update_set: HashSet<String> = HashSet::new();
        let versions: Vec<String> = version_set.into_iter().collect();

        for (i, version) in versions.iter().enumerate() {
            if i > 0 {
                sleep(Duration::from_millis(self.config.request_delay_ms)).await;
            }

            let fw_result = self.api.ipsw_get_firmwares(version).await;
            if !fw_result.success {
                anyhow::bail!("get_firmwares failed: {:?}", fw_result.error);
            }

            let firmwares = fw_result.data.unwrap();
            for fw in &firmwares {
                update_set.insert(fw.base.identifier.clone());
            }
        }

        let mut patch = serde_json::Map::new();
        patch.insert(
            "lastRelease".to_string(),
            serde_json::Value::String(latest_date.clone()),
        );
        self.meta.update(patch).await;

        *self.latest_release.lock().await = latest_date;

        println!(
            "[DataHandle] build_update_set() identifiers to update: {}",
            update_set.len()
        );
        Ok(Some(update_set))
    }

    // ── Reconcile update set ──────────────────────────────────────────────────

    /// FIX: collect tasks lên Arc<Self> thay vì borrow &self trực tiếp trong closure
    async fn reconcile_update_set(&self, update_set: &mut HashSet<String>) {
        if update_set.is_empty() {
            return;
        }

        println!(
            "[DataHandle] reconcile_update_set() checking {} identifiers",
            update_set.len()
        );

        let identifiers: Vec<String> = update_set.iter().cloned().collect();
        let latest = self.latest_release.lock().await.clone();

        // FIX: dùng Arc để share self sang các async task trong join_all
        let Some(arc_self) = self.self_weak.upgrade() else {
            return;
        };

        let tasks: Vec<_> = identifiers
            .iter()
            .map(|id| {
                let id = id.clone();
                let latest = latest.clone();
                let dh = arc_self.clone();
                async move {
                    let product = dh.get_product_type(&id)?;
                    let file = format!("products/{}/{id}.json", product.as_str());

                    let stored = dh.user_data.read::<ProductData>(&file, None).await?;
                    if !dh.validate_or_delete_product(&file, &stored).await {
                        return None;
                    }
                    if stored.last_release == latest {
                        Some((id, stored))
                    } else {
                        None
                    }
                }
            })
            .collect();

        let results = join_all(tasks).await;

        // FIX: chỉ push vào to_remove một lần duy nhất
        let mut to_remove: Vec<String> = Vec::new();

        {
            let mut model_map = self.model_map.lock().await;
            for result in results {
                if let Some((id, stored)) = result {
                    if !model_map.contains_key(&id) && stored.data_version == self.config.data_version {
                        model_map.insert(id.clone(), stored);
                    }
                    to_remove.push(id);
                }
            }
        }

        for id in &to_remove {
            update_set.remove(id);
        }

        println!(
            "[DataHandle] reconcile_update_set() remaining after reconcile: {}",
            update_set.len()
        );
    }

    // ── Devices ───────────────────────────────────────────────────────────────

    pub async fn load_devices(&self) -> anyhow::Result<()> {
        println!("[DataHandle] load_devices() start");

        match self.build_update_set().await {
            Ok(set) => {
                *self.update_set.lock().await = set;

                let mut us = self.update_set.lock().await;
                if let Some(ref mut set) = *us {
                    if !set.is_empty() {
                        // drop guard trước khi gọi reconcile để tránh deadlock
                        let mut owned = std::mem::take(set);
                        drop(us);
                        self.reconcile_update_set(&mut owned).await;
                        *self.update_set.lock().await = Some(owned);
                    }
                }
            }
            Err(e) => {
                eprintln!("[DataHandle] load_devices() build_update_set failed: {e}");
                *self.update_set.lock().await = None;
                let stored = self.meta.read::<String>("lastRelease").await;
                *self.latest_release.lock().await = stored.unwrap_or_default();
            }
        }

        match self
            .user_data
            .read::<DevicesData>(FILES_DEVICES, None)
            .await
        {
            Some(stored) => {
                let is_valid = self.validate_or_delete_devices(&stored).await;
                let latest = self.latest_release.lock().await.clone();
                if is_valid && stored.last_release == latest {
                    let count = stored.devices.len();
                    *self.devices.lock().await = stored.devices;
                    println!("[DataHandle] load_devices() using cached devices: {count}");
                    return Ok(());
                }
                println!("[DataHandle] load_devices() cache stale, refreshing from API");
            }
            None => {}
        }

        self.load_devices_from_api().await
    }

    async fn load_devices_from_api(&self) -> anyhow::Result<()> {
        println!("[DataHandle] load_devices_from_api() start");

        let devices_result = self.api.get_devices().await;
        if !devices_result.success {
            let err_msg = devices_result.error.unwrap_or_default();
            if err_msg.contains("429") {
                if let Some(stored) = self
                    .user_data
                    .read::<DevicesData>(FILES_DEVICES, None)
                    .await
                {
                    let count = stored.devices.len();
                    *self.devices.lock().await = stored.devices;
                    println!("[DataHandle] load_devices_from_api() 429 fallback: {count}");
                    return Ok(());
                }
            }
            anyhow::bail!("Failed to fetch devices: {err_msg}");
        }

        let devices = devices_result.data.unwrap();
        let count = devices.len();
        *self.devices.lock().await = devices.clone();
        println!("[DataHandle] load_devices_from_api() devices loaded: {count}");

        let latest = self.latest_release.lock().await.clone();
        let payload = DevicesData {
            data_version: self.config.data_version.to_string(),
            last_release: latest,
            devices,
        };
        self.user_data.write(FILES_DEVICES, &payload).await?;
        Ok(())
    }

    pub async fn get_devices(&self, product: Option<&Product>) -> Vec<BaseDevice> {
        let devices = self.devices.lock().await;
        match product {
            None => devices.clone(),
            Some(p) => devices
                .iter()
                .filter(|d| d.identifier.to_lowercase().starts_with(p.as_str()))
                .cloned()
                .collect(),
        }
    }

    // ── Model data: get() ─────────────────────────────────────────────────────

    pub async fn get(&self, identifier: &str) -> GetResult {
        let Some(product) = self.get_product_type(identifier) else {
            return GetResult::Wait;
        };

        {
            let map = self.model_map.lock().await;
            if let Some(entry) = map.get(identifier) {
                if !self
                    .needs_update(identifier, &entry.last_release, &entry.data_version)
                    .await
                {
                    return GetResult::Ready(entry.device.clone());
                }
            }
        }

        let file = format!("products/{}/{identifier}.json", product.as_str());

        if let Some(stored) = self.user_data.read::<ProductData>(&file, None).await {
            if self.validate_or_delete_product(&file, &stored).await
                && !self
                    .needs_update(identifier, &stored.last_release, &stored.data_version)
                    .await
            {
                self.model_map
                    .lock()
                    .await
                    .insert(identifier.to_string(), stored.clone());
                return GetResult::Ready(stored.device);
            }
        }

        self.schedule_fetch(identifier, &file).await;
        GetResult::Wait
    }

    // ── Model data (main process) ─────────────────────────────────────────────

    pub async fn get_model_data(
        &self,
        identifier: &str,
        skip_check: bool,
    ) -> Option<DeviceWithIpsws> {
        let Some(product) = self.get_product_type(identifier) else {
            return None;
        };

        {
            let map = self.model_map.lock().await;
            if let Some(entry) = map.get(identifier) {
                if !self
                    .needs_update(identifier, &entry.last_release, &entry.data_version)
                    .await
                {
                    return Some(entry.device.clone());
                }
            }
        }

        let file = format!("products/{}/{identifier}.json", product.as_str());

        if skip_check {
            if let Some(stored) = self.user_data.read::<ProductData>(&file, None).await {
                self.model_map
                    .lock()
                    .await
                    .insert(identifier.to_string(), stored.clone());
                return Some(stored.device);
            }
            return None;
        }

        if let Some(stored) = self.user_data.read::<ProductData>(&file, None).await {
            if self.validate_or_delete_product(&file, &stored).await
                && !self
                    .needs_update(identifier, &stored.last_release, &stored.data_version)
                    .await
            {
                self.model_map
                    .lock()
                    .await
                    .insert(identifier.to_string(), stored.clone());
                return Some(stored.device);
            }
        }

        self.get_model_data_from_api(identifier, &file).await
    }

    async fn get_model_data_from_api(
        &self,
        identifier: &str,
        file: &str,
    ) -> Option<DeviceWithIpsws> {
        // Dedup: nếu đang có request bay, chờ nó thay vì gửi thêm
        let rx = {
            let mut inflight = self.inflight.lock().await;
            if inflight.contains_key(identifier) {
                // FIX: tạo oneshot mới và đăng ký vào danh sách chờ
                let (tx, rx) = tokio::sync::oneshot::channel();
                inflight.get_mut(identifier).unwrap().push(tx);
                drop(inflight);
                return rx.await.ok().flatten();
            }
            // Chưa có — khởi tạo slot
            inflight.insert(identifier.to_string(), Vec::new());
            drop(inflight);
            None::<tokio::sync::oneshot::Receiver<Option<DeviceWithIpsws>>>
        };
        let _ = rx; // not used in this branch

        println!("[ipswData::get_model_data] - Load {identifier}");

        let id = identifier.to_string();
        let device_data = self
            .fetch_with_retry(|| async {
                let result = self.api.ipsw_get_device(&id).await;
                if result.success {
                    Ok(result.data)
                } else if result.status == 200 {
                    // HTTP 200 nhưng parse/schema fail → model không có data (quá cũ,
                    // API trả về [] hoặc format khác) → permanent, không retry
                    Ok(None)
                } else if result.status == 404
                    || (result.status >= 400 && result.status < 500 && result.status != 429)
                {
                    // 4xx client error → permanent
                    Ok(None)
                } else {
                    // 5xx / 429 / network error → transient, retry
                    Err(anyhow::anyhow!(
                        "API error: status={}, error={:?}",
                        result.status,
                        result.error
                    ))
                }
            })
            .await;

        // Notify tất cả waiter
        {
            let mut inflight = self.inflight.lock().await;
            if let Some(waiters) = inflight.remove(identifier) {
                for tx in waiters {
                    let _ = tx.send(device_data.clone());
                }
            }
        }

        if let Some(ref data) = device_data {
            let latest = self.latest_release.lock().await.clone();
            let model_data = ProductData {
                data_version: self.config.data_version.to_string(),
                last_release: latest,
                device: data.clone(),
            };
            self.model_map
                .lock()
                .await
                .insert(identifier.to_string(), model_data.clone());
            if let Err(e) = self.user_data.write(file, &model_data).await {
                eprintln!("[DataHandle] Failed to write model data: {e}");
            }
        }

        device_data
    }

    // ── Model data for renderer ───────────────────────────────────────────────

    pub async fn get_model_data_for_react(&self, identifier: &str) {
        println!("[DataHandle] get_model_data_for_react() queued: {identifier}");
        self.send_event("modelData", (identifier, Option::<DeviceWithIpsws>::None));

        let Some(product) = self.get_product_type(identifier) else {
            return;
        };

        {
            let map = self.model_map.lock().await;
            if let Some(entry) = map.get(identifier) {
                if !self
                    .needs_update(identifier, &entry.last_release, &entry.data_version)
                    .await
                {
                    self.send_event("modelData", (identifier, Some(entry.device.clone())));
                    return;
                }
            }
        }

        let file = format!("products/{}/{identifier}.json", product.as_str());
        self.schedule_fetch(identifier, &file).await;
    }

    // ── Cache invalidation ────────────────────────────────────────────────────

    pub async fn invalidate_release_cache(&self) -> anyhow::Result<()> {
        *self.update_set.lock().await = None;
        *self.latest_release.lock().await = String::new();
        self.meta.delete("lastRelease").await;
        Ok(())
    }

    // ── Local data check ──────────────────────────────────────────────────────

    pub async fn has_local_data(&self, r#type: &str, identifier: Option<&str>) -> bool {
        match r#type {
            "devices" => self
                .user_data
                .read::<serde_json::Value>(FILES_DEVICES, None)
                .await
                .is_some(),
            "modelData" => {
                let Some(id) = identifier else { return false };
                let Some(product) = self.get_product_type(id) else { return false };
                let file = format!("products/{}/{id}.json", product.as_str());
                self.user_data
                    .read::<serde_json::Value>(&file, None)
                    .await
                    .is_some()
            }
            _ => false,
        }
    }

    // ── Concurrent queue ──────────────────────────────────────────────────────

    /// FIX: atomic check-and-insert bằng cách giữ lock trong suốt quá trình check
    async fn schedule_fetch(&self, identifier: &str, file: &str) {
        {
            // FIX: giữ cả hai lock cùng lúc để tránh race condition giữa
            // "check active_ids" và "insert active_ids"
            let mut active = self.active_ids.lock().await;
            if active.contains(identifier) {
                return;
            }
            // Kiểm tra inflight trong cùng critical section
            let inflight = self.inflight.lock().await;
            if inflight.contains_key(identifier) {
                return;
            }
            // Insert ngay, chưa drop lock
            active.insert(identifier.to_string());
        } // ← drop cả hai lock sau khi đã insert xong

        eprintln!("[schedule_fetch] {identifier}: added to active_ids, spawning drain_queue");

        let identifier = identifier.to_string();
        let file = file.to_string();

        let Some(dh_arc) = self.self_weak.upgrade() else {
            eprintln!("[schedule_fetch] DataHandle dropped, cannot schedule {identifier}");
            self.active_ids.lock().await.remove(&identifier);
            return;
        };

        tokio::spawn(async move {
            dh_arc.drain_queue(&identifier, &file).await;
        });
    }

    async fn drain_queue(&self, identifier: &str, file: &str) {
        // Acquire semaphore — giữ permit cho đến hết hàm (RAII)
        let _permit = self.semaphore.acquire().await.expect("semaphore closed");

        sleep(Duration::from_millis(self.config.request_delay_ms)).await;

        // Re-check disk cache dưới semaphore
        if let Some(stored) = self.user_data.read::<ProductData>(file, None).await {
            if self.validate_or_delete_product(file, &stored).await
                && !self
                    .needs_update(identifier, &stored.last_release, &stored.data_version)
                    .await
            {
                self.model_map
                    .lock()
                    .await
                    .insert(identifier.to_string(), stored.clone());
                self.active_ids.lock().await.remove(identifier);
                // _permit drop ở đây — semaphore được release
                self.send_event(
                    "deviceDataUpdated",
                    serde_json::json!({ "identifier": identifier, "data": stored.device }),
                );
                self.send_event("modelData", (identifier, Some(stored.device)));
                return;
            }
        }

        // FIX: dedup bằng oneshot channel — đúng cách, không borrow prematurely
        let maybe_rx: Option<tokio::sync::oneshot::Receiver<Option<DeviceWithIpsws>>> = {
            let mut inflight = self.inflight.lock().await;
            if inflight.contains_key(identifier) {
                // Đang có request khác bay → đăng ký chờ
                let (tx, rx) = tokio::sync::oneshot::channel();
                inflight.get_mut(identifier).unwrap().push(tx);
                Some(rx)
            } else {
                // Tôi là người fetch đầu tiên — khởi tạo slot
                inflight.insert(identifier.to_string(), Vec::new());
                None
            }
        };

        let device_data: Option<DeviceWithIpsws> = if let Some(rx) = maybe_rx {
            // Chờ request đang bay
            eprintln!("[drain_queue] {identifier}: joining existing inflight request");
            rx.await.ok().flatten()
        } else {
            // Tôi fetch
            eprintln!("[drain_queue] {identifier}: starting fetch");
            let id = identifier.to_string();
            let data = self
                .fetch_with_retry(|| async {
                    let result = self.api.ipsw_get_device(&id).await;
                    eprintln!(
                        "[drain_queue] {id}: API result success={} status={}",
                        result.success, result.status
                    );
                    if result.success {
                        Ok(result.data)
                    } else if result.status == 200 {
                        // HTTP 200 nhưng parse/schema fail → permanent, không retry
                        eprintln!("[drain_queue] {id}: status=200 parse fail => permanent, no retry");
                        Ok(None)
                    } else if result.status == 404
                        || (result.status >= 400 && result.status < 500 && result.status != 429)
                    {
                        eprintln!("[drain_queue] {id}: permanent error status={} => no retry", result.status);
                        Ok(None)
                    } else {
                        eprintln!("[drain_queue] {id}: transient error status={} => retry", result.status);
                        Err(anyhow::anyhow!(
                            "API error: status={}, error={:?}",
                            result.status,
                            result.error
                        ))
                    }
                })
                .await;

            // Notify tất cả waiter (bao gồm cả những task đang chờ trong drain_queue khác)
            {
                let mut inflight = self.inflight.lock().await;
                if let Some(waiters) = inflight.remove(identifier) {
                    for tx in waiters {
                        let _ = tx.send(data.clone());
                    }
                }
            }

            data
        };

        // FIX: active_ids.remove() chỉ gọi sau khi có kết quả, TRƯỚC khi drop permit
        // Permit drop ở cuối hàm tự động
        self.active_ids.lock().await.remove(identifier);

        let Some(device_data) = device_data else {
            eprintln!("[drain_queue] {identifier}: fetch returned None — sending empty firmwares");
            self.send_event(
                "deviceDataUpdated",
                serde_json::json!({
                    "identifier": identifier,
                    "data": { "identifier": identifier, "firmwares": [] }
                }),
            );
            return;
            // _permit drop ở đây
        };

        let latest = self.latest_release.lock().await.clone();
        let model_data = ProductData {
            data_version: self.config.data_version.to_string(),
            last_release: latest,
            device: device_data.clone(),
        };
        self.model_map
            .lock()
            .await
            .insert(identifier.to_string(), model_data.clone());

        if let Err(e) = self.user_data.write(file, &model_data).await {
            eprintln!("[DataHandle] Failed to write model data: {e}");
        }

        self.send_event(
            "deviceDataUpdated",
            serde_json::json!({ "identifier": identifier, "data": device_data }),
        );
        self.send_event("modelData", (identifier, Some(device_data)));
        eprintln!("[drain_queue] {identifier}: done");
        // _permit drop ở đây — semaphore slot được giải phóng
    }
}