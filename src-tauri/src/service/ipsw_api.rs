use reqwest::Client;
use serde::de::DeserializeOwned;
use crate::types::ipsw_api::{
    BaseDevice,
    DeviceWithIpsws,
    DeviceWithOtas,
    IpswFirmware,
    OtaFirmware,
    Releases,
};

// ─── FetchResult ────────────────────────────────────────────────────────────

#[derive(Debug)]
pub(crate) struct FetchResult<T> {
    pub success: bool,
    pub data: Option<T>,
    pub status: i32,
    pub error: Option<String>,
}

// ─── safe_fetch ──────────────────────────────────────────────────────────────

async fn safe_fetch<T: DeserializeOwned>(client: &Client, url: &str) -> FetchResult<T> {
    match client.get(url).send().await {
        Err(e) => FetchResult {
            success: false,
            data: None,
            status: -1,
            error: Some(e.to_string()),
        },
        Ok(response) => {
            let status = response.status().as_u16() as i32;

            if !response.status().is_success() {
                let reason = response
                    .status()
                    .canonical_reason()
                    .unwrap_or("Unknown")
                    .to_string();
                return FetchResult {
                    success: false,
                    data: None,
                    status,
                    error: Some(format!("HTTP error! Status: {} {}", status, reason)),
                };
            }

            // FIX: lấy text trước, parse sau — để log body thật khi serde fail
            match response.text().await {
                Err(e) => FetchResult {
                    success: false,
                    data: None,
                    status,
                    error: Some(format!("Failed to read response body: {e}")),
                },
                Ok(text) => match serde_json::from_str::<T>(&text) {
                    Ok(data) => FetchResult {
                        success: true,
                        data: Some(data),
                        status,
                        error: None,
                    },
                    Err(e) => {
                        // Log body (truncated) để debug schema mismatch
                        let preview = if text.len() > 300 {
                            format!("{}…", &text[..300])
                        } else {
                            text.clone()
                        };
                        eprintln!("[safe_fetch] JSON parse error for {url}");
                        eprintln!("[safe_fetch] serde error: {e}");
                        eprintln!("[safe_fetch] body preview: {preview}");
                        FetchResult {
                            success: false,
                            data: None,
                            status,
                            error: Some(format!("JSON parse error: {e} | body: {preview}")),
                        }
                    }
                },
            }
        }
    }
}

// ─── IpswAPI ─────────────────────────────────────────────────────────────────

const BASE_URL: &str = "https://api.ipsw.me/v4";

pub struct IpswAPI {
    client: Client,
}

impl IpswAPI {
    pub fn new() -> Self {
        // FIX: thêm User-Agent giống browser/electron để tránh bị block/redirect
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .build()
            .unwrap_or_default();
        Self { client }
    }

    pub fn base_url(&self) -> &str {
        BASE_URL
    }

    // ── Device ───────────────────────────────────────────────────────────────

    pub async fn get_devices(&self) -> FetchResult<Vec<BaseDevice>> {
        safe_fetch(&self.client, &format!("{BASE_URL}/devices")).await
    }

    pub async fn get_identifier_by_model(&self, model: &str) -> FetchResult<serde_json::Value> {
        safe_fetch(&self.client, &format!("{BASE_URL}/model/{model}")).await
    }

    // ── IPSW ─────────────────────────────────────────────────────────────────

    pub async fn ipsw_get_device(&self, identifier: &str) -> FetchResult<DeviceWithIpsws> {
        safe_fetch(&self.client, &format!("{BASE_URL}/ipsw/device/{identifier}")).await
    }

    pub async fn ipsw_get_firmware(&self, identifier: &str, buildid: &str) -> FetchResult<IpswFirmware> {
        safe_fetch(&self.client, &format!("{BASE_URL}/ipsw/{identifier}/{buildid}")).await
    }

    pub async fn ipsw_get_firmwares(&self, version: &str) -> FetchResult<Vec<IpswFirmware>> {
        safe_fetch(&self.client, &format!("{BASE_URL}/ipsw/{version}")).await
    }

    // ── OTA ──────────────────────────────────────────────────────────────────

    pub async fn ota_get_device(&self, identifier: &str) -> FetchResult<DeviceWithOtas> {
        safe_fetch(&self.client, &format!("{BASE_URL}/ota/device/{identifier}")).await
    }

    pub async fn ota_get_firmware(&self, identifier: &str, buildid: &str) -> FetchResult<OtaFirmware> {
        safe_fetch(&self.client, &format!("{BASE_URL}/ota/{identifier}/{buildid}")).await
    }

    pub async fn ota_get_firmwares(&self, version: &str) -> FetchResult<Vec<OtaFirmware>> {
        safe_fetch(&self.client, &format!("{BASE_URL}/ota/{version}")).await
    }

    // ── Releases ─────────────────────────────────────────────────────────────

    pub async fn get_releases(&self) -> FetchResult<Vec<Releases>> {
        safe_fetch(&self.client, &format!("{BASE_URL}/releases")).await
    }
}