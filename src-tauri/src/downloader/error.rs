use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("task not found: {0}")]
    NotFound(String),
    #[error("invalid status for operation: {0}")]
    InvalidStatus(String),
    #[error("aborted")]
    Aborted,
    #[error("server does not support range requests and whole-file fallback failed")]
    NoRangeSupport,
    #[error("hash mismatch: expected {expected}, got {actual}")]
    HashMismatch { expected: String, actual: String },
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, EngineError>;
