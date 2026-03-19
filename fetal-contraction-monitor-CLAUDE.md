# CLAUDE.md — Fetal Contraction Monitor

## What This Is

A React Native app that monitors fetal heart rate responses to uterine contractions during labor, maps them onto a flat torus T², and tracks the recovery trend as an early warning indicator. Validated on 552 CTG recordings (Paper V, Cardiac Torus series). Research prototype, not a medical device.

## Core Insight

Recovery time diverges from normal 60 minutes before deceleration depth does. The baby tires before it fails. A rising recovery trend line is the primary signal. Everything else — the torus, the curvature, the Gini — is visualization and context around that trend line.

## Tech Stack

- **Framework:** React Native with Expo (managed workflow)
- **Language:** TypeScript (strict mode)
- **BLE:** `react-native-ble-plx` for Doppler connection
- **Sensors:** `expo-sensors` for accelerometer contraction detection
- **State:** React Context + useReducer for labor session state. No Redux.
- **Storage:** `@react-native-async-storage/async-storage` for session persistence
- **Charts:** `react-native-svg` for torus display and trend charts. No charting libraries.
- **Export:** Generate PDF via `expo-print`, CSV via string building
- **Testing:** Jest + React Native Testing Library
- **Navigation:** `expo-router` (file-based routing)

## Critical Discovery: Fixed vs Adaptive Normalization

Found during the cardiac dance monitor build: **torus feature computation for matching against validated thresholds requires fixed normalization bounds, not adaptive percentile-based normalization.** When angle mapping uses the individual session's narrow range (adaptive), κ and Gini shift to values that don't match the research-validated thresholds. The validated results (Paper V) used population-wide bounds.

**Rule:**
- **Alert logic / trajectory features** → fixed normalization (NADIR_MAP_MIN/MAX, RECOVERY_MAP_MIN/MAX constants)
- **Torus visualization** → adaptive normalization (2nd–98th percentile of session data) for better visual spread
- **Personal baseline deviation** → either works (relative to personal baseline)

The `toAngle` function accepts `min`/`max` parameters. The caller decides which bounds to pass. Do not hardcode either strategy inside the engine.

## Architecture Principles

1. **All computation is local.** Zero cloud. Zero network. Zero data leaves the device unless the user explicitly exports.
2. **The recovery trend is the engine.** The torus is the visualization. The app must work correctly even if torus rendering is disabled.
3. **Graceful degradation.** If BLE drops, keep accumulating contraction timing. If accelerometer is noisy, fall back to manual. If fewer than 6 contractions, show "collecting data" not a false green.
4. **Honest uncertainty.** Grey state when data is insufficient. Confidence scores on contraction detection. Signal quality badges. Never fake certainty.
5. **Safety first.** Never diagnose. Never recommend actions. Always defer to provider. Persistent disclaimer banner.

## Key Constants

```typescript
// Quality gating
const FHR_MIN = 80;           // bpm - below this = artifact
const FHR_MAX = 200;          // bpm - above this = artifact
const FHR_GAP_THRESHOLD = 10; // seconds - gap = probe displaced
const FHR_CV_THRESHOLD = 0.30; // coefficient of variation in 5s window = possible maternal signal

// Contraction detection
const CTX_MIN_DISTANCE = 60;       // seconds between contractions
const CTX_SMOOTHING_WINDOW = 10;   // seconds for accelerometer low-pass
const CTX_PROMINENCE_FRACTION = 0.15; // 15% of 5th-95th percentile range
const CTX_CONFIDENCE_FLOOR = 0.5;  // below this, mark as uncertain

// Response extraction
const BASELINE_WINDOW = 30;   // seconds pre-contraction for baseline
const RESPONSE_WINDOW = 60;   // seconds post-contraction for response
const RECOVERY_THRESHOLD = 5; // bpm - "within 5 bpm of baseline" = recovered
const MIN_BASELINE_VALID = 0.5;  // 50% valid samples required
const MIN_RESPONSE_VALID = 0.6;  // 60% valid samples required
const BASELINE_RANGE_MIN = 100;  // bpm
const BASELINE_RANGE_MAX = 180;  // bpm

// Torus
const NADIR_MAP_MIN = 0;    // bpm (maps to 0)
const NADIR_MAP_MAX = -50;  // bpm (maps to 2π)
const RECOVERY_MAP_MIN = 5;  // seconds
const RECOVERY_MAP_MAX = 60; // seconds

// Alerts
const MIN_CONTRACTIONS = 6;   // before any trajectory analysis
const SLOPE_YELLOW = 0.3;     // s/contraction
const SLOPE_RED = 1.0;        // s/contraction
const LAST5_YELLOW = 40;      // seconds
const LAST5_RED = 45;         // seconds
const RED_PERSISTENCE = 2;    // consecutive contractions at RED before alert
```

## Data Models

```typescript
interface ContractionResponse {
  id: string;                    // UUID
  timestamp: number;             // Unix ms
  contractionPeakTime: number;   // Unix ms
  detectionMethod: 'accelerometer' | 'manual' | 'toco';
  detectionConfidence: number;   // 0-1
  baselineFHR: number;           // bpm (median of pre-contraction window)
  nadirDepth: number;            // bpm (negative, max drop below baseline)
  nadirTiming: number;           // seconds after contraction peak
  recoveryTime: number;          // seconds until within RECOVERY_THRESHOLD of baseline
  responseArea: number;          // bpm·seconds (integral below baseline)
  fhrQuality: number;            // 0-1 (fraction of valid samples)
}

interface LaborSession {
  id: string;
  startTime: number;
  contractions: ContractionResponse[];
  status: 'green' | 'yellow' | 'red' | 'grey';
  recoveryTrendSlope: number | null;  // s/contraction
  nadirTrendSlope: number | null;
  personalBaseline: {
    recoveryMean: number;
    recoverySd: number;
    nadirMean: number;
    nadirSd: number;
  } | null;  // null until MIN_CONTRACTIONS reached
}

interface TorusPoint {
  theta1: number;  // [0, 2π) - nadir depth angle
  theta2: number;  // [0, 2π) - recovery time angle
  kappa: number;   // geodesic curvature at this point
  contractionId: string;
}
```

## The Torus Math

The complete algorithm. This is canonical — implement exactly as written.

```typescript
const TWO_PI = 2 * Math.PI;

function toAngle(value: number, min: number, max: number): number {
  if (max - min < 0.001) return Math.PI;
  return TWO_PI * Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function geodesicDistance(a: [number, number], b: [number, number]): number {
  let d1 = Math.abs(a[0] - b[0]);
  d1 = Math.min(d1, TWO_PI - d1);
  let d2 = Math.abs(a[1] - b[1]);
  d2 = Math.min(d2, TWO_PI - d2);
  return Math.sqrt(d1 * d1 + d2 * d2);
}

function mengerCurvature(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number]
): number {
  const a = geodesicDistance(p2, p3);
  const b = geodesicDistance(p1, p3);
  const c = geodesicDistance(p1, p2);
  if (a < 1e-8 || b < 1e-8 || c < 1e-8) return 0;
  const s = (a + b + c) / 2;
  const area2 = s * (s - a) * (s - b) * (s - c);
  if (area2 <= 0) return 0;
  return (4 * Math.sqrt(area2)) / (a * b * c);
}

function giniCoefficient(values: number[]): number {
  const v = values.filter(x => x > 0).sort((a, b) => a - b);
  if (v.length < 2) return 0;
  const n = v.length;
  const sum = v.reduce((a, b) => a + b, 0);
  let weighted = 0;
  v.forEach((val, i) => { weighted += (i + 1) * val; });
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}
```

## Alert Logic

```
IF contractions.length < MIN_CONTRACTIONS:
    status = 'grey'  // insufficient data

ELSE IF signalQuality < 0.5 OR contractionConfidence < CTX_CONFIDENCE_FLOOR:
    status = 'grey'  // unreliable data

ELSE IF recoveryTrendSlope >= SLOPE_RED
    AND last5RecoveryMean >= LAST5_RED
    AND redPersistenceCount >= RED_PERSISTENCE:
    status = 'red'

ELSE IF recoveryTrendSlope >= SLOPE_YELLOW
    OR last5RecoveryMean >= LAST5_YELLOW
    OR nadirAcceleration > 0:
    status = 'yellow'

ELSE:
    status = 'green'
```

Adaptive thresholds: after personalBaseline is established (MIN_CONTRACTIONS), YELLOW also triggers at baseline + 1σ, RED at baseline + 2σ, with the fixed thresholds as a floor.

## Contraction Detection

Three methods, fused:

1. **Accelerometer** — Low-pass z-axis at 0.1 Hz, rolling std in 30s windows, peak detection with adaptive prominence. Outputs confidence 0-1 based on prominence, timing regularity, and FHR confirmation.

2. **Manual** — User taps a button. Confidence = 1.0 (user is the gold standard for timing).

3. **External TOCO** — BLE tocodynamometer if available. Highest priority.

**Bayesian fusion:** If FHR shows a deceleration matching expected contraction-response timing, boost accelerometer confidence. If accelerometer fires but no FHR response follows within 90 seconds, reduce confidence. FHR validates accelerometer, not the other way around.

## Screen Structure

```
app/
├── (tabs)/
│   ├── monitor.tsx      # Main screen: torus + recovery trend + status light
│   ├── log.tsx          # Contraction log table
│   └── settings.tsx     # Doppler pairing, detection method, export, about
├── session/
│   ├── [id].tsx         # Review a past session
│   └── export.tsx       # PDF/CSV export
└── _layout.tsx
```

### Main Monitor Screen Layout (top to bottom)

1. **Status light** — Large circle: green/yellow/red/grey. Center top.
2. **Stats row** — Phase | CTX count | Last nadir | Last recovery
3. **Torus display** — Square, ~280px. Beat-pair dots colored by time (dim→bright). Most recent point pulsing white circle.
4. **Recovery trend chart** — Mini line chart, ~120px tall. Recovery time per contraction with linear trend line. Color matches trend direction.
5. **Contraction info** — Last contraction: nadir, recovery, confidence badge.
6. **Control bar** — Start/Stop, contraction button (manual), speed indicator.

### Persistent Elements
- Top banner: "RESEARCH PROTOTYPE — Not a medical device"
- Signal quality badge: top right corner
- Contraction confidence: next to each detection event

## File Naming and Style

- Files: kebab-case (`torus-engine.ts`, `contraction-detector.ts`)
- Components: PascalCase (`TorusDisplay.tsx`, `RecoveryTrend.tsx`)
- Constants: UPPER_SNAKE_CASE
- Functions: camelCase
- Types/Interfaces: PascalCase
- No default exports except screen components
- Every function that computes a clinical value must have a JSDoc comment citing the source (Paper V section number)

## Testing Strategy

- **Unit tests** for all torus math functions (known-answer tests from research pipeline)
- **Unit tests** for quality gating (boundary cases: FHR = 79, FHR = 201, gap = 9.9s vs 10.1s)
- **Integration tests** for contraction detection → response extraction → torus computation pipeline
- **Simulation tests** using three scenarios: normal labor, concerning (elevated recovery), distress (accelerating deterioration). Compare output trajectory features against expected ranges from CTU-UHB validation data.
- **Snapshot tests** for display components

## What NOT To Build

- No user accounts, no login, no backend, no analytics
- No cloud anything — not even crash reporting (use on-device logs)
- No diagnosis language anywhere in the UI — no "acidosis", "distress", "hypoxia"
- No action recommendations — no "go to hospital", "call doctor", no urgency language beyond "contact your provider"
- No Apple Health / Google Fit integration (unnecessary complexity, privacy risk)
- No social features, no sharing except explicit PDF/CSV export
- No ads, no tracking, no monetization hooks
