use serde::{Deserialize, Deserializer, Serialize};
use specta_typescript::Number;

// ─── Helper: deserialize null hoặc missing string thành "" ───────────────────
//
// Dùng cho các field mà ipsw.me API có thể trả về null trong firmware cũ
// (releasedate, uploaddate, sha1sum, md5sum, sha256sum, v.v.)

fn null_to_empty<'de, D>(d: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(d)?.unwrap_or_default())
}

// ─── Board ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(specta::Type)]
pub struct Board {
    #[specta(type = Number)]
    pub bdid: i64,
    pub boardconfig: String,
    #[specta(type = Number)]
    pub cpid: i64,
    // platform có thể null trong model cũ
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub platform: String,
}

// ─── BaseFirmware ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(specta::Type)]
pub struct BaseFirmware {
    pub identifier: String,
    pub buildid: String,
    pub version: String,
    pub url: String,
    #[specta(type = Number)]
    pub filesize: i64,
    // releasedate/uploaddate có thể null trong firmware cũ
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub releasedate: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub uploaddate: String,
    pub signed: bool,
}

// ─── IpswFirmware ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(specta::Type)]
pub struct IpswFirmware {
    #[serde(flatten)]
    pub base: BaseFirmware,
    // hash fields có thể null trong firmware cũ (iPhone 2G, 3G, 3GS, 4...)
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub sha1sum: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub md5sum: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub sha256sum: String,
}

// ─── OtaFirmware ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(specta::Type)]
pub struct Ota {
    pub buildid: String,
    #[specta(type = Number)]
    pub filesize: i64,
    pub identifier: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub marketingversion: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub prerequisitebuildid: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub prerequisiteversion: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub releasedate: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub releasetype: String,
    pub signed: bool,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub uploaddate: String,
    pub url: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(specta::Type)]
pub struct OtaFirmware {
    #[serde(flatten)]
    pub base: BaseFirmware,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub prerequisitebuildid: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub prerequisiteversion: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub releasetype: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub marketingversion: String,
}

// ─── Device types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(specta::Type)]
pub struct BaseDevice {
    pub name: String,
    pub identifier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(specta::Type)]
pub struct Device {
    pub bdid: i64,
    pub boardconfig: String,
    pub boards: Vec<Board>,
    pub cpid: i64,
    #[specta(skip)]
    pub firmwares: serde_json::Value,
    pub identifier: String,
    pub name: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(specta::Type)]
pub struct DeviceWithIpsws {
    pub name: String,
    pub identifier: String,
    pub boards: Vec<Board>,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub boardconfig: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub platform: String,
    #[specta(type = Number)]
    pub cpid: i64,
    #[specta(type = Number)]
    pub bdid: i64,
    pub firmwares: Vec<IpswFirmware>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(specta::Type)]
pub struct DeviceWithOtas {
    pub name: String,
    pub identifier: String,
    pub boards: Vec<Board>,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub boardconfig: String,
    #[serde(deserialize_with = "null_to_empty")]
    #[specta(type = String)]
    pub platform: String,
    #[specta(type = Number)]
    pub cpid: i64,
    #[specta(type = Number)]
    pub bdid: i64,
    pub firmwares: Vec<OtaFirmware>,
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(specta::Type)]
pub struct IdentifiedDevice {
    pub identifier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(specta::Type)]
pub struct Release {
    #[specta(type = Number)]
    pub count: i64,
    pub date: String,
    pub name: String,
    pub r#type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[derive(specta::Type)]
pub struct Releases {
    pub date: String,
    pub releases: Vec<Release>,
}