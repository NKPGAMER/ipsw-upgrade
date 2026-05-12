import { app } from "electron"

export default {
    defaultAppSettings: {
        autoRemoveOldFiles: true,
        autoRemoveDuplicateFiles: true,
        language: 'vi',
    },

    DataVersion: "2.2.0",
    
    appleVendorId: 1452,

    // Caching & queue tuning
    cacheTtlMs: 600_000,          // 10 min in-memory TTL
    maxConcurrentFetches: 2,      // parallel API requests
    requestDelayMs: 300,          // ms between starting requests
    maxRetries: 3,                // retries per fetch
    retryBaseDelayMs: 1_000,      // base delay (× 2^attempt) for backoff
}