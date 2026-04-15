# PROTOCOL.md

The full implementation protocol derived from Paper V. Where SPEC.md gives
the "what" and CLAUDE.md gives the "why," this file gives the "exactly
what numbers the research ran with and why we chose the same."

Every constant in `src/constants.ts` is indexed here.

---

## 1. FHR acquisition

### Clinical context (Paper V)
CTU-UHB provides CTG recordings sampled at 4 Hz. Some recordings have gaps
(probe displacement, re-positioning).

### Implementation mapping

| Constant | Value | Source |
|---|---|---|
| `FHR_MIN` | 80 bpm | Below this is maternal signal or artifact in all CTU-UHB preprocessing |
| `FHR_MAX` | 200 bpm | Upper physiological bound for fetal tachycardia |
| `FHR_GAP_THRESHOLD` | 10 s | Longest gap Paper V allows before flagging a recording segment as discontinuous |
| `FHR_CV_THRESHOLD` | 0.30 | 5-second coefficient of variation above this = likely maternal-tracking |
| `FHR_BUFFER_SECONDS` | 120 s | Covers the 30 s pre-contraction + 60 s post-contraction windows with margin |

## 2. Contraction detection

### Clinical context
Paper V used the CTU-UHB TOCO waveform (clinical tocodynamometer) for peak
detection. The app must produce plausible contraction timing from the much
noisier alternatives: phone accelerometer or manual button press.

### Accelerometer pipeline (SPEC §2.1)
Exactly reproduced in `src/detection/accelerometer.ts`:

1. Downsample raw z-axis to 4 Hz (mean over 250 ms windows).
2. Low-pass filter: 10 s causal moving average on the 4 Hz stream.
3. Rolling std: 30 s sliding window on the filtered signal.
4. Adaptive threshold: `15% × (p95 − p5)` of the rolling-std over the last
   10 minutes; floor at 0.01 g.
5. Peak detection: local max of rolling-std with prominence ≥ threshold and
   inter-peak distance ≥ 60 s.
6. Confidence: `clip(prominence / (2·threshold), 0.3, 0.9)` + timing-bonus
   + FHR-confirmation-bonus.

### Manual (SPEC §2.2)
User taps a button. Confidence = 1.0. Button pulses during a 60-second
cooldown to prevent double-taps.

### Fusion (SPEC §2.4)
- Manual + accelerometer detections within ±30 s → single detection at
  the manual timestamp with confidence = 1.0.
- Accelerometer-only → kept with its own confidence.
- FHR confirmation (applied *after* the response window closes in
  `ContractionQueue`): if a qualifying deceleration (|nadir| ≥ 10 bpm
  for ≥ 10 s) is extracted, confidence += 0.2; otherwise the
  accel-only detection's confidence is halved.

### Constants

| Constant | Value | Source |
|---|---|---|
| `CTX_MIN_DISTANCE` | 60 s | Clinical minimum between contractions in active labor |
| `CTX_SMOOTHING_WINDOW` | 10 s | Matches the temporal resolution of clinical TOCO processing |
| `CTX_PROMINENCE_FRACTION` | 0.15 | Empirical — from pilot accelerometer recordings |
| `CTX_CONFIDENCE_FLOOR` | 0.5 | Below this, a detection is too uncertain to drive alerts |

## 3. Response extraction

### Clinical context
For each contraction, Paper V computed baseline FHR from the 30 s before
the peak, then extracted response features from the 60 s after.

### Implementation mapping (SPEC §3)

| Constant | Value | Role |
|---|---|---|
| `BASELINE_WINDOW` | 30 s | Pre-contraction window for baseline median |
| `RESPONSE_WINDOW` | 60 s | Post-contraction window for response features |
| `RECOVERY_THRESHOLD` | 5 bpm | Band within which FHR counts as "recovered" |
| `MIN_BASELINE_VALID` | 0.5 | Minimum valid-sample fraction in baseline window |
| `MIN_RESPONSE_VALID` | 0.6 | Minimum valid-sample fraction in response window |
| `BASELINE_RANGE_MIN` | 100 bpm | Below this, baseline is implausible → reject |
| `BASELINE_RANGE_MAX` | 180 bpm | Above this, baseline is implausible → reject |

### Recovery time algorithm

Recovery is the time from contraction peak until a **5-second window**
entirely within ±`RECOVERY_THRESHOLD` of baseline begins. If no such
window exists within the 60 s response window, recovery = `RESPONSE_WINDOW`
(maximum).

The 5-second stability requirement suppresses false recoveries from
brief upward swings that cross baseline and fall again.

## 4. Torus computation

### Angle mapping (SPEC §4.1)

Two modes. **The mode matters:**

- **Alert-logic / trajectory features** → FIXED population bounds
  (`NADIR_MAP_MIN=0, NADIR_MAP_MAX=-50`, `RECOVERY_MAP_MIN=5, RECOVERY_MAP_MAX=60`).
  These are the bounds Paper V used to derive the slope and last-5 thresholds.
- **Visualization** → ADAPTIVE 2nd–98th percentile of session data for
  better visual spread.

**Do not mix the two.** See CLAUDE.md §"Critical Discovery".

### Menger curvature

Canonical implementation in `src/torus/math.ts`, reproduced verbatim from
CLAUDE.md. Computed on geodesic distances (wraps at 2π on each axis).

## 5. Alert logic

### Decision tree (SPEC §5.1)

```
n < 6                                                     → grey
recent fhrQuality < 0.5 OR recent conf < 0.5              → grey
recoverySlope ≥ 1.0 AND last5 ≥ red_threshold
  (sustained for RED_PERSISTENCE contractions)            → red
recoverySlope ≥ 0.3 OR last5 ≥ yellow_threshold
  OR nadirAcceleration > 0                                → yellow
else                                                      → green
```

### Adaptive thresholds (SPEC §5.3)

After `MIN_CONTRACTIONS` (6), a personal baseline is computed from those
first six and **frozen**:

```
yellow_threshold = min(LAST5_YELLOW, baseline.recoveryMean + σ)
red_threshold    = min(LAST5_RED,    baseline.recoveryMean + 2σ)
```

Population thresholds are a ceiling — personal thresholds can only
tighten the alert zone, never loosen it.

### Why persistence

A single red-eligible contraction raises the `redPersistenceCount` but
does not surface red — the app returns yellow with an internal counter
of 1. Red only fires after `RED_PERSISTENCE = 2` consecutive red-eligible
contractions. This prevents a single noise-driven spike from producing
a red alert.

## 6. Simulation scenarios

Three scenarios for development and demo (SPEC §8). See
`src/simulation/scenarios.ts`:

- **Normal:** stable 28–35 s recovery, gradual nadir deepening -10 → -30 bpm.
- **Concerning:** recovery rises 30 → 45 s, similar nadir pattern.
- **Distress:** recovery rises 35 → 55 s with acceleration, nadir deepens
  faster -10 → -40 bpm.

The full pipeline (extraction → trajectory features → alerts) is exercised
by the simulation — the Phase 2 integration test confirms Distress walks
the status machine `grey → green/yellow → red`.

## 7. Storage

Auto-save every 30 s and after every new contraction (SPEC §7.1).
Up to 50 completed sessions retained; oldest drops first (SPEC §7.2).
Keys: `session_current` and `session_history` (`src/storage/session-store.ts`).

## 8. Export

- CSV: one row per contraction with all `ContractionResponse` fields plus
  the trajectory features *computed cumulatively* at that index
  (`src/export/csv.ts`).
- PDF: one-page HTML summary rendered via expo-print — status pill,
  summary stats grid, inline SVG trend chart, contraction table,
  disclaimer (`src/export/pdf.ts`).

Both pipe through the platform Share sheet; the user chooses the
destination. The app itself never uploads.
