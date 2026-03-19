# SPEC.md — Fetal Contraction Monitor

## Overview

Build a React Native (Expo) app that:
1. Connects to a Bluetooth fetal Doppler and receives FHR data
2. Detects uterine contractions via phone accelerometer, manual button, or external TOCO
3. Extracts fetal heart rate response features per contraction
4. Maps consecutive responses onto a flat torus T² and computes geodesic curvature
5. Tracks recovery time trend as the primary clinical signal
6. Displays a traffic light status (GREEN/YELLOW/RED/GREY) with adaptive thresholds

---

## 1. BLE Signal Acquisition

### 1.1 Doppler Connection

**Protocol:** BLE Heart Rate Service (UUID `0x180D`), Heart Rate Measurement characteristic (UUID `0x2A37`).

**Connection flow:**
1. Scan for BLE devices advertising Heart Rate Service
2. Display discovered devices with name and signal strength
3. User selects device → connect
4. Subscribe to notifications on `0x2A37`
5. Parse each notification:
   - Byte 0, bit 0: HR format (0 = uint8, 1 = uint16)
   - Byte 0, bit 4: RR-Interval present flag
   - Bytes 1-2 (or 1): Heart Rate value
   - Remaining bytes (if RR flag set): RR intervals in 1/1024 second units, packed sequentially

**If RR intervals are present:** Use them directly (convert from 1/1024s to milliseconds: `rr_ms = rr_raw / 1.024`). These are the primary data.

**If RR intervals are NOT present:** Derive instantaneous interval from HR: `interval_ms = 60000 / hr_bpm`. This is lower quality but usable.

**Reconnection:** If BLE disconnects, attempt reconnection every 5 seconds for 2 minutes. Display "Doppler disconnected — reconnecting..." with elapsed time. Log the gap. Resume data collection on reconnect without resetting the session.

### 1.2 FHR Stream Processing

Convert incoming data to a continuous FHR stream at approximately 1-4 Hz:

```typescript
interface FHRSample {
  timestamp: number;    // Unix ms
  fhr: number;          // bpm
  source: 'rr' | 'hr'; // derived from RR interval or direct HR
  valid: boolean;       // passes quality gate
}
```

**Quality gate (per sample):**
- `fhr < 80 || fhr > 200` → `valid = false` (artifact or maternal)
- Gap since last valid sample > 10 seconds → log gap event
- Rolling CV in 5-second window > 0.30 → flag as possibly maternal signal

**Store the last 120 seconds of FHR samples** in a ring buffer for baseline computation and response extraction.

### 1.3 Fallback: No Doppler

If no Doppler is paired, the app can still function for contraction timing only. Display: "No Doppler connected — recording contraction timing only. Connect a Doppler to enable fetal heart rate analysis." The contraction log records timing without FHR response features.

---

## 2. Contraction Detection

### 2.1 Accelerometer Detection

**Sensor:** Phone accelerometer z-axis (perpendicular to screen). Sample at device native rate (typically 50-100 Hz).

**Pipeline:**
1. **Downsample** to 4 Hz (average each 250ms window)
2. **Low-pass filter:** 10-second causal moving average on the 4 Hz stream
3. **Rolling standard deviation:** 30-second sliding window on the filtered signal
4. **Adaptive threshold:** Compute 5th and 95th percentiles of the rolling std over the last 10 minutes. Prominence threshold = 15% of this range, minimum 0.01 g.
5. **Peak detection:** Find peaks in rolling std with prominence ≥ threshold and minimum 60-second inter-peak distance.
6. **Confidence scoring:**
   - Base confidence = prominence / (2 × threshold). Clip to [0.3, 0.9].
   - Timing bonus: if inter-peak interval is within ±30% of the running mean interval, add +0.1
   - FHR confirmation: if a deceleration (≥10 bpm below baseline for ≥10 seconds) occurs within 90 seconds after the peak, add +0.2
   - Clip final confidence to [0, 1]

**Output per detection:**
```typescript
interface ContractionDetection {
  peakTimestamp: number;
  method: 'accelerometer';
  confidence: number;        // 0-1
  prominenceRaw: number;
  fhrConfirmed: boolean;
}
```

### 2.2 Manual Detection

**UI:** A large button labeled "Contraction" at the bottom of the monitor screen. Tap once at perceived contraction peak. The button pulses during a cooldown period (60 seconds) to prevent double-taps.

```typescript
interface ContractionDetection {
  peakTimestamp: number;
  method: 'manual';
  confidence: 1.0;
}
```

### 2.3 External TOCO (Future)

BLE tocodynamometer connection. Same peak detection as accelerometer but on the TOCO waveform. Higher priority when available.

### 2.4 Fusion

If both accelerometer and manual are active:
- If both fire within 30 seconds of each other: merge into single detection. Timestamp = manual (user is ground truth). Confidence = max(accel_conf, 1.0).
- If only accelerometer fires: use accel detection with its confidence.
- If only manual fires: use manual at confidence 1.0.

**User correction:** The contraction log displays all detected contractions. The user can:
- **Delete** a false positive (tap to remove)
- **Add** a missed contraction (long-press timeline to insert)
- **Adjust** timing (drag contraction marker on timeline)

All corrections update the torus trajectory in real time.

---

## 3. Response Extraction

**Trigger:** After each detected contraction peak, wait `RESPONSE_WINDOW` (60 seconds) for the full response to develop, then extract features.

### 3.1 Baseline Computation

Collect FHR samples from `peakTimestamp - 30s` to `peakTimestamp`. Filter to valid samples only. If fewer than 50% are valid, mark this contraction as `fhrQuality: 'poor'` and skip torus computation (but still log timing).

`baselineFHR = median(valid samples in pre-contraction window)`

If baseline is outside [100, 180] bpm, skip this contraction (likely artifact).

### 3.2 Response Window

Collect FHR samples from `peakTimestamp` to `peakTimestamp + 60s`. Filter to valid samples.

If fewer than 60% are valid, mark as `fhrQuality: 'poor'`.

### 3.3 Feature Extraction

```typescript
// Deviation from baseline
const deviation = responseSamples.map(s => s.fhr - baselineFHR);

// Nadir depth: maximum drop below baseline
const nadirDepth = Math.min(...deviation);  // negative value

// Nadir timing: seconds from contraction peak to nadir
const nadirIndex = deviation.indexOf(nadirDepth);
const nadirTiming = nadirIndex / sampleRate;

// Recovery time: first sustained return within 5 bpm of baseline
// "Sustained" = remains within threshold for ≥5 seconds
let recoveryTime = 60; // default: no recovery within window
for (let i = nadirIndex; i < deviation.length - (5 * sampleRate); i++) {
  const window = deviation.slice(i, i + 5 * sampleRate);
  if (window.every(d => Math.abs(d) < RECOVERY_THRESHOLD)) {
    recoveryTime = i / sampleRate;
    break;
  }
}

// Response area: integral of deviation below baseline
const responseArea = deviation
  .filter(d => d < 0)
  .reduce((sum, d) => sum + d, 0) / sampleRate;  // bpm·seconds
```

### 3.4 Quality Classification

Each `ContractionResponse` gets a quality grade:
- `good`: confidence ≥ 0.7 AND fhrQuality ≥ 0.8 AND baseline in [100, 180]
- `fair`: confidence ≥ 0.5 AND fhrQuality ≥ 0.6
- `poor`: anything below fair thresholds

Only `good` and `fair` responses enter the torus computation. `poor` responses are logged but greyed out in the display.

---

## 4. Torus Computation

### 4.1 Angle Mapping

Use adaptive normalization from the current session's data:

```typescript
function computeTorusPoint(
  contraction: ContractionResponse,
  allContractions: ContractionResponse[]
): TorusPoint {
  // Adaptive bounds from session data (2nd-98th percentile)
  const nadirs = allContractions.map(c => c.nadirDepth);
  const recoveries = allContractions.map(c => c.recoveryTime);

  const nadirMin = percentile(nadirs, 2) - 1;
  const nadirMax = percentile(nadirs, 98) + 1;
  const recoveryMin = percentile(recoveries, 2) - 1;
  const recoveryMax = percentile(recoveries, 98) + 1;

  // Fall back to population bounds if session data insufficient
  const nMin = allContractions.length >= 6 ? nadirMin : NADIR_MAP_MAX;  // -50
  const nMax = allContractions.length >= 6 ? nadirMax : NADIR_MAP_MIN;  // 0
  const rMin = allContractions.length >= 6 ? recoveryMin : RECOVERY_MAP_MIN;
  const rMax = allContractions.length >= 6 ? recoveryMax : RECOVERY_MAP_MAX;

  return {
    theta1: toAngle(contraction.nadirDepth, nMin, nMax),
    theta2: toAngle(contraction.recoveryTime, rMin, rMax),
    kappa: 0,  // computed after 3+ points
    contractionId: contraction.id,
  };
}
```

### 4.2 Curvature

After each new torus point (when there are ≥ 3 points), compute Menger curvature for the latest triplet:

```typescript
const pts = torusPoints;
const n = pts.length;
if (n >= 3) {
  pts[n - 2].kappa = mengerCurvature(
    [pts[n - 3].theta1, pts[n - 3].theta2],
    [pts[n - 2].theta1, pts[n - 2].theta2],
    [pts[n - 1].theta1, pts[n - 1].theta2]
  );
}
```

### 4.3 Trajectory Features (updated after each contraction)

```typescript
interface TrajectoryFeatures {
  kappaMedian: number;
  kappaGini: number;
  recoveryTrendSlope: number;   // linear regression: recovery vs contraction index
  nadirTrendSlope: number;
  recoveryLast5Mean: number;
  nadirAcceleration: number;    // slope(last third) - slope(first third), requires ≥9 ctx
  areaLast5Mean: number;
  contractionCount: number;
}
```

Compute via standard linear regression (no library needed — OLS in ~10 lines of TS).

---

## 5. Alert Logic

### 5.1 Status Determination

Run after every new contraction response:

```typescript
function determineStatus(
  session: LaborSession,
  features: TrajectoryFeatures
): 'green' | 'yellow' | 'red' | 'grey' {
  // Gate: insufficient data
  if (features.contractionCount < MIN_CONTRACTIONS) return 'grey';

  // Gate: poor signal
  const recentQuality = session.contractions.slice(-3);
  if (recentQuality.some(c => c.fhrQuality < 0.5)) return 'grey';

  // Adaptive thresholds (if baseline established)
  const baseline = session.personalBaseline;
  let yellowRecovery = LAST5_YELLOW;
  let redRecovery = LAST5_RED;
  if (baseline) {
    yellowRecovery = Math.min(LAST5_YELLOW, baseline.recoveryMean + baseline.recoverySd);
    redRecovery = Math.min(LAST5_RED, baseline.recoveryMean + 2 * baseline.recoverySd);
  }

  // RED: sustained deterioration
  if (
    features.recoveryTrendSlope >= SLOPE_RED &&
    features.recoveryLast5Mean >= redRecovery
  ) {
    // Persistence check: was previous status also red-eligible?
    // (tracked via session.redPersistenceCount)
    return 'red';
  }

  // YELLOW: any single concerning indicator
  if (
    features.recoveryTrendSlope >= SLOPE_YELLOW ||
    features.recoveryLast5Mean >= yellowRecovery ||
    features.nadirAcceleration > 0
  ) {
    return 'yellow';
  }

  return 'green';
}
```

### 5.2 Notifications

| Status | Visual | Haptic | Message |
|--------|--------|--------|---------|
| grey | Grey circle, "Collecting data..." | None | "Recording contractions. Need X more for analysis." |
| green | Green circle, "Reassuring" | None | None |
| yellow | Yellow circle, "Concerning" | Single vibration | "Recovery time is trending upward. This may be normal labor progression. If you have concerns, contact your provider." |
| red | Red circle, "Alert" | 3 vibrations | "The pattern of fetal responses has changed significantly. Please contact your healthcare provider for assessment." |

**Transition messaging:** When status changes, show a brief toast: "Status changed: GREEN → YELLOW" with timestamp. Log all transitions.

### 5.3 Personal Baseline

Established from the first `MIN_CONTRACTIONS` (6) responses:

```typescript
function establishBaseline(contractions: ContractionResponse[]): PersonalBaseline {
  const first = contractions.slice(0, MIN_CONTRACTIONS);
  const recoveries = first.map(c => c.recoveryTime);
  const nadirs = first.map(c => c.nadirDepth);
  return {
    recoveryMean: mean(recoveries),
    recoverySd: std(recoveries),
    nadirMean: mean(nadirs),
    nadirSd: std(nadirs),
  };
}
```

Baseline is frozen once established (does not update with new contractions). This ensures that late-labor deterioration is measured against early-labor baseline, not a drifting reference.

---

## 6. Display Components

### 6.1 TorusDisplay

**Props:** `points: TorusPoint[]`, `size: number`

**Render:**
- Square SVG, dark background (#0a0a0f)
- Thin border (#1a1a2e)
- Grid lines at 25%, 50%, 75%
- Polyline connecting consecutive points (low opacity)
- Circles at each point: radius scales with recency (2px oldest → 6px newest), opacity scales (0.2 → 1.0), color based on curvature (green low → red high)
- Latest point: white pulsing ring (animated)
- X-axis label: "Decel Depth →"
- Y-axis label: "Recovery Time →"

**Interaction:** Tap a point to show its contraction details in a tooltip.

### 6.2 RecoveryTrendChart

**Props:** `contractions: ContractionResponse[]`, `status: AlertStatus`

**Render:**
- SVG, ~120px tall, full width
- X-axis: contraction index
- Y-axis: recovery time (seconds)
- Circles at each contraction, colored: green (<38s), yellow (38-45s), red (>45s)
- Connecting lines between consecutive points
- Dashed trend line (linear regression), colored to match status
- Background shading: light red zone above 45s

### 6.3 StatusLight

**Props:** `status: 'green' | 'yellow' | 'red' | 'grey'`

**Render:** Circle, 64px diameter, centered. Solid fill with subtle glow/shadow matching color. Grey has no glow. Red pulses slowly when active.

### 6.4 ContractionLog

**Props:** `contractions: ContractionResponse[]`

**Render:** Scrollable list (most recent first), each row:
- Index number
- Nadir depth (colored red if < -25 bpm)
- Recovery time (colored by threshold)
- Contraction confidence badge (filled bar)
- Quality grade icon (✓ good, ~ fair, ✗ poor)

Row tap → expand to show: full FHR response curve, area, nadir timing, detection method.

### 6.5 SignalQualityBadge

**Props:** `quality: 'good' | 'fair' | 'poor' | 'disconnected'`

**Render:** Small icon top-right corner. Green dot = good. Yellow dot = fair. Red dot = poor. Grey with X = disconnected.

### 6.6 DisclaimerBanner

Persistent top banner, 24px tall, dark background with subtle text:
"RESEARCH PROTOTYPE — Not a medical device"

Tap to expand full disclaimer text.

---

## 7. Session Persistence

### 7.1 Auto-Save

The current session auto-saves to AsyncStorage every 30 seconds and after every new contraction. Key: `session_current`. Format: JSON-serialized `LaborSession`.

### 7.2 Session History

Completed sessions (user taps "End Session") are moved to `session_history` as an array of `LaborSession` objects. Maximum 50 stored sessions. Oldest are deleted first.

### 7.3 Export

**PDF:** One-page summary containing:
- Session date, duration, total contractions
- Recovery trend chart (rendered as static SVG)
- Summary statistics: mean nadir, mean recovery, trend slope, final status
- Contraction log table
- Disclaimer text

**CSV:** One row per contraction with all `ContractionResponse` fields plus computed trajectory features at that point.

---

## 8. Simulation Mode

For development and demonstration. Accessible via Settings → "Demo Mode."

Three scenarios:

| Scenario | Recovery pattern | Nadir pattern |
|----------|-----------------|---------------|
| Normal | Stable 28-35s | Gradual deepening -10 → -30 bpm |
| Concerning | Rising from 30s → 45s | Similar to normal |
| Distress | Rising from 35s → 55s, accelerating | Deepening faster, -10 → -40 bpm |

Simulation generates one contraction every 2 seconds (accelerated). All detection, extraction, torus, and alert logic runs identically to live mode. This exercises the full pipeline.

---

## 9. Build Order

Phase 1 deliverables (data-only, no alerts):

1. **Expo project scaffold** with file-based routing, TypeScript strict
2. **BLE module** — scan, connect, parse HR + RR from 0x2A37
3. **FHR display** — live BPM readout + signal quality badge
4. **Manual contraction button** — tap to record, cooldown, log
5. **Response extraction** — baseline, nadir, recovery, area from FHR buffer + contraction timing
6. **Torus math** — angle mapping, curvature, Gini (pure functions, unit tested)
7. **Torus display** — SVG rendering of trajectory points
8. **Recovery trend chart** — mini chart with trend line
9. **Contraction log** — scrollable table
10. **Session persistence** — auto-save, history, basic export (CSV)
11. **Simulation mode** — three scenarios for testing

Phase 2 additions:

12. Accelerometer contraction detection
13. Bayesian fusion (accel + FHR confirmation)
14. Alert logic + status light
15. Adaptive thresholds + personal baseline
16. Uncertainty display (quality badges, confidence, grey state)
17. PDF export
18. User contraction correction (add/delete/adjust)

---

## 10. Testing Checklist

- [ ] `toAngle(0, 0, 50)` returns `0`
- [ ] `toAngle(50, 0, 50)` returns `≈ 2π`
- [ ] `toAngle(25, 0, 50)` returns `≈ π`
- [ ] `geodesicDistance([0, 0], [π, π])` returns `≈ π√2`
- [ ] `geodesicDistance([0, 0], [2π - 0.01, 0])` returns `≈ 0.01` (wraps)
- [ ] `mengerCurvature` of three collinear points returns `0`
- [ ] `mengerCurvature` of three points forming an equilateral triangle returns expected value
- [ ] `giniCoefficient([1, 1, 1, 1])` returns `0`
- [ ] `giniCoefficient([0, 0, 0, 100])` returns `≈ 0.75`
- [ ] Quality gate rejects FHR = 79 and FHR = 201
- [ ] Quality gate accepts FHR = 80 and FHR = 200
- [ ] Recovery extraction: if FHR stays 20 bpm below baseline for entire window, recovery = 60s
- [ ] Recovery extraction: if FHR returns immediately, recovery ≈ nadirTiming
- [ ] Alert status = 'grey' when contractions < 6
- [ ] Alert status = 'green' when recovery trend flat and last-5 < 40s
- [ ] Alert status = 'yellow' when slope = 0.3
- [ ] Alert status = 'red' when slope = 1.0 AND last-5 = 45s (sustained)
- [ ] Simulation mode "Normal" produces final status GREEN
- [ ] Simulation mode "Distress" produces final status RED
- [ ] BLE reconnection resumes data collection without resetting session
- [ ] Session auto-saves and survives app restart
