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
- Respond in Vietnamese when the user switches to Vietnamese. Confidence: 0.80

# Search & Filter UX
- Search/filter state should be cleared (reset) when the user navigates away from the search context, rather than persisting stale queries across routes. Confidence: 0.65

# UI Patterns
- Prefers debounced search inputs (~300ms delay) rather than filtering on every keystroke. Confidence: 0.85
- Designs UI components to accept custom/external data lists (via props or store) rather than being tightly coupled to internal API calls, so they can be reused in different contexts (e.g., global search). Confidence: 0.75

# Downloader Design
- Use compact arrays `[start, end, downloaded]` (CompactChunk type) for chunk state instead of objects. Only track incomplete chunks; completed chunks are removed from the array entirely (no need for index or completed flag). Confidence: 0.70
- The `chunks` array in DownloadState should only contain incomplete chunks (not yet completed). Remove completed chunks to keep the persisted state small. Confidence: 0.80
