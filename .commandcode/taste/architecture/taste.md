# Architecture
- Frontend/renderer code must not import Node.js built-in modules (e.g., `events`, `fs`, `path`). When a Node.js API pattern like EventEmitter is needed in the renderer, implement a lightweight custom replacement instead — such as a `Map`-based `EventBus` that works in browser contexts. Confidence: 0.85
- When replacing an API with one from a dependency/addon, import types directly from the dependency's type definitions rather than maintaining separate local type declarations. Use the types exported by the dependency — do not duplicate or redefine them locally. Confidence: 0.75
- For performance-critical native operations (disk I/O, OS syscalls, unbuffered writes), prefer implementing in Rust via the i10r-addon rather than pure Node.js workarounds. Confidence: 0.80
- For file copy/move and full-file hash operations, use Rust native functions (i10r-addon) instead of Node.js fs/crypto. Rust handles the operation; JavaScript manages orchestration, queuing, and event tracking. Confidence: 0.75
- Do not auto-detect hash algorithm from firmware metadata. Require explicit shaAlgorithm on TaskConfig; if not set, skip stream hash/verify entirely. Confidence: 0.80
- When the underlying preload/native API is expected to change (e.g., planned migration to Rust), wrap it behind a frontend facade class. The facade becomes the single hub for all operations, insulating downstream code from API churn — only the wrapper changes when the backend is replaced. Confidence: 0.85
- Every method in an API facade should return `data | void` — never throw. The facade catches all errors internally, so callers always receive a clean result and never need try/catch. Confidence: 0.85
- Frontend must gracefully degrade when the backend/preload layer is unavailable — the UI should still render and remain functional without crashing, even if backend calls return empty/null results. Confidence: 0.80
- Do not weaken a parameter's type contract (e.g., making it optional with `?`) just to accommodate a call site that fails to provide it. If a parameter is semantically required, keep it required and fix the call site to supply the value instead. Confidence: 0.70
- Values a clean, well-organized project structure — proactively requests restructuring to make the codebase "gọn hơn" (more compact) and "dễ bảo trì chỉnh sửa hơn" (easier to maintain and edit). Favors logical file organization (no single-file subdirectories, barrel exports, separation of concerns). Confidence: 0.75
- When renaming or replacing an IPC API, keep naming consistent across all layers — IPC channel name, preload method name, type definitions, and service method should all use the same name. Do not leave the old IPC channel name in place while renaming only the preload/service side. Confidence: 0.70

- When iterating over a list of items that each require an async IPC call, use `Promise.all` with a concurrency limit (e.g., 4) and batch state updates (once per batch) rather than a sequential `for` loop with per-iteration `setState`. This avoids blocking the event loop and reduces re-renders. Confidence: 0.75

- Cache large static CSS/style strings as a `static` class property (or module-level constant) rather than generating them anew each time a dialog/modal is rendered. This avoids unnecessary string allocation and GC pressure. Confidence: 0.70
- When a user says "replace completely" (thay hoàn toàn) an API, perform a full vertical sweep across all layers — type definitions, preload, IPC handler, service facade, UI consumer — and delete the old implementation along with its barrel re-exports. Do not leave the old module, re-export, or any remnants behind. Confidence: 0.75

- Higher-level configuration presets (e.g., "performance mode") should override granular custom settings (e.g., `maxConnections`). A preset represents an explicit user intent that supersedes individual knobs — it's correct behavior, not a bug, when a preset overwrites custom values. Confidence: 0.70

- Prefers specialized, single-responsibility schedulers over a monolithic scheduler — separate scheduler classes for different task types (e.g., download/verify scheduling vs. file transfer/move scheduling), each with its own queue and independent concurrency limits. Confidence: 0.85

- When a multi-phase task pipeline uses temporary storage (e.g., download to SSD tmp then move to HDD saveDir), completion of one phase must immediately free its slot so the next queued task can begin — phases should not block each other. The downstream phase (transfer) has its own independent scheduler and concurrency cap, enabling parallel pipelining (e.g., 3 concurrent downloads + 1 concurrent transfer). Confidence: 0.85

- When resource pools are categorized by location (e.g., per-drive-type concurrency slots), an operation's category must reflect where the resource-intensive work actually happens, not where the final output lands. E.g., a download writing to an SSD tmp dir must consume an SSD slot even when the file will ultimately be moved to an HDD saveDir. Confidence: 0.75

- During active download, write to a temporary file with a non-final extension (e.g., `.i10r`) rather than the target extension. Rename to the final extension only after the download completes successfully. This prevents file watchers, indexers, or other processes from consuming incomplete files. Confidence: 0.80

- When backend state mutations (e.g., task status transitions via `updateTaskStatus`) must be observable by the renderer, always emit an IPC event (e.g., `emitProgressNow`) immediately after the in-memory mutation. In-memory updates alone will not propagate to the UI — the renderer only sees state that arrives via IPC events. Confidence: 0.75

- When a shared rendering utility used in multiple contexts (e.g., `renderMd`) needs different sizing or styling per context, prefers adding a parameter (e.g., `size: "sm" | "md"`) over duplicating the component or creating separate variants. The default parameter value should preserve existing backward-compatible behavior. Confidence: 0.60
