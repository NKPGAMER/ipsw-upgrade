---
name: stable-download-speed
description: Provide stable and realistic download speed and ETA values for consumers of a download engine. Use this skill when implementing or refactoring backend download speed calculation, ETA estimation, or any network transfer progress tracking. Focuses exclusively on backend-side calculations, never UI.
---

# Stable Download Speed & ETA Estimation

## Problem

Raw download speed is highly volatile because network transfers occur in bursts. Using instantaneous speed directly causes large speed fluctuations, unstable ETA values, and poor prediction quality.

## Principle

Never expose instantaneous speed directly.

```
Raw Samples
    ↓
Speed Smoothing
    ↓
ETA Calculation
    ↓
ETA Smoothing
    ↓
Output
```

---

## Speed Smoothing

### Method 1: Sliding Window

Store transfer history for the most recent N seconds.

```ts
[
  { timestamp: 1000, downloaded: 500000 },
  { timestamp: 2000, downloaded: 1100000 },
  { timestamp: 3000, downloaded: 1650000 }
]
```

Calculate speed using the oldest sample inside the window:

```ts
speed =
  (latest.downloaded - oldest.downloaded) /
  ((latest.timestamp - oldest.timestamp) / 1000);
```

Recommended window size: **5–10 seconds**

Benefits: Reduces spikes, produces stable speed estimates, similar to IDM-style reporting.

### Method 2: Exponential Moving Average (EMA)

Apply smoothing to the calculated speed.

```ts
smoothedSpeed =
  previousSpeed * (1 - alpha) +
  currentSpeed * alpha;
```

Recommended alpha: **0.10 – 0.20**

```ts
const ALPHA = 0.15;

smoothedSpeed =
  previousSpeed * 0.85 +
  currentSpeed * 0.15;
```

Benefits: Smooth transitions, fast implementation, low memory usage.

### Recommended Speed Pipeline

```
Raw Speed
    ↓
Sliding Window
    ↓
EMA
    ↓
Stable Speed
```

---

## ETA Calculation

Remaining bytes:

```ts
remainingBytes = totalBytes - downloadedBytes;
```

ETA:

```ts
eta = remainingBytes / smoothedSpeed;
```

**Never** use raw speed for ETA calculation.

---

## ETA Smoothing

ETA naturally fluctuates even when speed is smoothed. Apply a second EMA:

```ts
smoothedEta =
  previousEta * (1 - alpha) +
  currentEta * alpha;
```

Recommended alpha: **0.10 – 0.20**

---

## Complete Example

```ts
const SPEED_ALPHA = 0.15;
const ETA_ALPHA = 0.15;

let smoothedSpeed = 0;
let smoothedEta = 0;

function updateSpeed(instantSpeed: number) {
  smoothedSpeed =
    smoothedSpeed === 0
      ? instantSpeed
      : smoothedSpeed * (1 - SPEED_ALPHA) +
        instantSpeed * SPEED_ALPHA;

  return smoothedSpeed;
}

function updateEta(totalBytes: number, downloadedBytes: number) {
  if (smoothedSpeed <= 0) {
    return Infinity;
  }

  const rawEta =
    (totalBytes - downloadedBytes) /
    smoothedSpeed;

  smoothedEta =
    smoothedEta === 0
      ? rawEta
      : smoothedEta * (1 - ETA_ALPHA) +
        rawEta * ETA_ALPHA;

  return smoothedEta;
}
```

---

## Recommended Configuration

### Chrome-like

```
Sliding Window: 3–5s
Speed EMA: 0.20
ETA EMA: 0.20
```

### IDM-like

```
Sliding Window: 10–15s
Speed EMA: 0.10
ETA EMA: 0.10
```

### Balanced

```
Sliding Window: 5–10s
Speed EMA: 0.15
ETA EMA: 0.15
```

---

## Key Rules

- Never expose instantaneous speed.
- Always calculate ETA from smoothed speed.
- Prefer Sliding Window + EMA together.
- Smooth ETA separately from speed.
- Keep speed and ETA calculations independent from UI concerns.
