# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/


# Architecture
- For performance-critical native operations (disk I/O, OS syscalls, unbuffered writes), prefer implementing in Rust via the i10r-addon rather than pure Node.js workarounds. Confidence: 0.80
- For file copy/move and full-file hash operations, use Rust native functions (i10r-addon) instead of Node.js fs/crypto. Rust handles the operation; JavaScript manages orchestration, queuing, and event tracking. Confidence: 0.75
- Do not auto-detect hash algorithm from firmware metadata. Require explicit shaAlgorithm on TaskConfig; if not set, skip stream hash/verify entirely. Confidence: 0.80

# Communication
- When asked a question about how something works, explain and analyze only — do not modify code unless explicitly asked. Confidence: 0.85
