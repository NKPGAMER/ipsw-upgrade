# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# Architecture
See [architecture/taste.md](architecture/taste.md)
# Communication
See [communication/taste.md](communication/taste.md)
# Workflow
- Prefers immediately deleting dead/unreferenced code when identified, rather than leaving orphaned files in the codebase. When told a file has zero imports, the expected action is to delete it without further hesitation. Confidence: 0.75
- When performing a multi-file refactor, uses todo_write to track progress across files — each file is a separate todo item, checked off as work is completed. Confidence: 0.70
- After completing a significant refactor or writing a new file, runs the project's typecheck command (e.g., `npx tsc --noEmit`) to verify type correctness before declaring the task done. Confidence: 0.65
- After a mass find-and-replace migration (e.g., replacing all `window.*` calls with a facade), grep the codebase for the old pattern to confirm zero remaining direct calls before declaring the migration complete. Confidence: 0.70

# Search & Filter UX
- Search/filter state should be cleared (reset) when the user navigates away from the search context, rather than persisting stale queries across routes. Confidence: 0.65

# UI Patterns
- Prefers debounced search inputs (~300ms delay) rather than filtering on every keystroke. Confidence: 0.85
- Designs UI components to accept custom/external data lists (via props or store) rather than being tightly coupled to internal API calls, so they can be reused in different contexts (e.g., global search). Confidence: 0.75

# TypeScript Patterns
- Prefers type-safe EventEmitter wrappers using the event-map pattern: an interface mapping event names to callback signatures, with a generic `on<E extends keyof Map>(event: E, callback: Map[E])` so TypeScript infers callback parameter types from the event name. Also prefers returning `this` (not the underlying emitter) for chainable calls. Confidence: 0.75
- When a facade method returns `data | void`, avoid explicit type annotations on the assignment (e.g., `const result: SomeType = await facade.method()`) — the `| void` makes the annotation incompatible. Let TypeScript infer, then use a null guard (`if (!result) return`) to narrow. Confidence: 0.70

# Downloader Design
- Use compact arrays `[start, end, downloaded]` (CompactChunk type) for chunk state instead of objects. Only track incomplete chunks; completed chunks are removed from the array entirely (no need for index or completed flag). Confidence: 0.70
- The `chunks` array in DownloadState should only contain incomplete chunks (not yet completed). Remove completed chunks to keep the persisted state small. Confidence: 0.80
