# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/


# Architecture
- For performance-critical native operations (disk I/O, OS syscalls, unbuffered writes), prefer implementing in Rust via the i10r-addon rather than pure Node.js workarounds. Confidence: 0.80
- For file copy/move and full-file hash operations, use Rust native functions (i10r-addon) instead of Node.js fs/crypto. Rust handles the operation; JavaScript manages orchestration, queuing, and event tracking. Confidence: 0.75
- Do not auto-detect hash algorithm from firmware metadata. Require explicit shaAlgorithm on TaskConfig; if not set, skip stream hash/verify entirely. Confidence: 0.80

# Communication
- When asked a question about how something works, explain and analyze only — do not modify code unless explicitly asked. Confidence: 0.85
- When a runtime error surfaces after a refactor, do not dismiss it as pre-existing without thorough investigation — especially if the app was working before the changes. Fix it when asked. Confidence: 0.75
- Fix bugs at the root cause rather than adding defensive null/empty guards downstream. If a value is unexpectedly empty/null, trace back to why it wasn't initialized properly and fix that instead of scattering guards everywhere. Confidence: 0.85
- When debugging, do not deflect blame to external dependencies (e.g. native addons, third-party libraries) without concrete evidence. Investigate the integration layer and your own code first — especially when the dependency has been independently tested with clear logs. Confidence: 0.80
