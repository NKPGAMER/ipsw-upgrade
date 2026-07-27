# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# Architecture
See [architecture/taste.md](architecture/taste.md)
# Communication
See [communication/taste.md](communication/taste.md)
# Workflow
See [workflow/taste.md](workflow/taste.md)
# Search & Filter UX
- Search/filter state should be cleared (reset) when the user navigates away from the search context, rather than persisting stale queries across routes. Confidence: 0.65

# UI Patterns
See [ui-patterns/taste.md](ui-patterns/taste.md)
# CSS / Styling Discipline
- Never modify CSS classes, style objects, theme variables, or any visual/styling code when performing logic, performance, or bug-fix refactors — unless explicitly asked to change the UI. The user expects visual appearance to remain identical after functional changes. Confidence: 0.70
- The project uses **TailwindCSS** via className attributes rather than traditional CSS files for most styling. Be aware of this when analyzing or modifying UI code. Confidence: 0.90
- When extracting shared constants/logic from a module that imports a CSS file containing global styles (e.g., `html, body, #root` rules), check whether that CSS file's global rules are duplicated in a central entry-point CSS file. If the extracted module was previously imported eagerly (via a static import chain), the CSS was loading app-wide; after extraction, the original module may become lazy-loaded and its global styles lost — breaking the app's visual appearance. Always safeguard global styles in a centrally-imported CSS file before refactoring import chains. Confidence: 0.80

# TypeScript Patterns
- Prefers type-safe EventEmitter wrappers using the event-map pattern: an interface mapping event names to callback signatures, with a generic `on<E extends keyof Map>(event: E, callback: Map[E])` so TypeScript infers callback parameter types from the event name. Also prefers returning `this` (not the underlying emitter) for chainable calls. Confidence: 0.75
- When a facade method returns `data | void`, avoid explicit type annotations on the assignment (e.g., `const result: SomeType = await facade.method()`) — the `| void` makes the annotation incompatible. Let TypeScript infer, then use a null guard (`if (!result) return`) to narrow. Confidence: 0.70

# Downloader Design
- Use compact arrays `[start, end, downloaded]` (CompactChunk type) for chunk state instead of objects. Only track incomplete chunks; completed chunks are removed from the array entirely (no need for index or completed flag). Confidence: 0.70
- The `chunks` array in DownloadState should only contain incomplete chunks (not yet completed). Remove completed chunks to keep the persisted state small. Confidence: 0.80
