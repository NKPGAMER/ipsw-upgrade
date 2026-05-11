# Optimize HDD-only concurrent limit (3 → 2)

## Problem
When turbo mode is **OFF** and environment is `hdd_only`, the scheduler still allows 3 concurrent downloads. Two HDDs competing for disk IO will saturate quickly. HDD-only should cap at 2.

Turbo ON already correctly limits hdd_only to 1 turbo + 1 normal = 2 total. This fix mirrors that for turbo OFF.

## Changes

### 1. `electron/modules/downloader/scheduler.ts` (line ~55)
In `setTurboMode()`, when `enabled` is false, set `maxConcurrent` based on environment:

```ts
} else {
  this.maxTurbo = 0;
  this.maxNormal = 0;
  this.maxConcurrent = environment === "hdd_only" ? 2 : 3;  // ← add this
}
```

### 2. `electron/modules/downloader/downloader.ts` (line ~258)
In `ensureEnvironment()`, always call `setTurboMode()` — not just when turbo mode config is true:

```ts
// Before:
if (this.config.turboMode) {
  this.scheduler.setTurboMode(true, this.environment);
}

// After:
this.scheduler.setTurboMode(this.config.turboMode, this.environment);
```

This ensures the scheduler knows the environment even when turbo is off, so `hdd_only → maxConcurrent=2` takes effect.

## Verification
- On HDD-only system with turbo OFF, add 3 downloads → only 2 should start, 3rd stays queued
- SSD system unaffected (still 3 concurrent)
- hdd_ssd_tmp unaffected (still 3 concurrent)
- Turbo ON behavior unchanged (hdd_only already 2 total via scheduler slots)
