# CODING_GUIDE.md — Fetal Contraction Monitor

A step-by-step implementation roadmap synthesized from `README.md`, `fetal-contraction-monitor-CLAUDE.md`, and `fetal-contraction-monitor-SPEC.md`. Use this as the working plan; reach for the source docs for full rationale and constants.

---

## 0. Orientation

**What you are building:** A React Native (Expo) app that reads fetal heart rate from a BLE Doppler, detects uterine contractions from the phone's accelerometer (or a manual button), extracts per-contraction response features, maps them onto a flat torus T², and surfaces a traffic-light alert driven by the **recovery-time trend**.

**The single most important rule:** Recovery trend is the engine; the torus is the visualization. Build the recovery-trend pipeline first and make sure it works end-to-end before polishing any display.

**Non-negotiables:**
- All computation is local. No cloud, no analytics, no tracking.
- No diagnosis language. No action recommendations beyond "contact your provider."
- Honest uncertainty: `grey` state when data is insufficient or noisy.
- Fixed normalization for alert logic; adaptive only for visualization (see CLAUDE.md §"Fixed vs Adaptive Normalization").

---

## 1. Project Scaffold

### 1.1 Initialize

```bash
npx create-expo-app@latest fetal-contraction-monitor -t expo-template-blank-typescript
cd fetal-contraction-monitor
```

Enable **TypeScript strict mode** in `tsconfig.json`:

```json
{ "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true } }
```

### 1.2 Install Dependencies

```bash
npx expo install expo-router expo-sensors expo-print expo-haptics \
  react-native-ble-plx react-native-svg \
  @react-native-async-storage/async-storage
npm install -D jest @testing-library/react-native @types/jest ts-jest
```

### 1.3 Directory Layout

Create the folder tree exactly as specified in README §"Project Structure":

```
src/
  ble/            # BLE scanning, connection, HRM parsing
  detection/      # Accelerometer, manual, TOCO, fusion
  extraction/     # Per-contraction response extraction
  torus/          # Pure math: toAngle, geodesicDistance, mengerCurvature, giniCoefficient
  trajectory/     # Trend slopes, last-5 means, baseline, acceleration
  alerts/         # Status determination, persistence counter, notifications
  display/        # TorusDisplay, RecoveryTrendChart, StatusLight, etc.
  export/         # PDF and CSV generation
  storage/        # AsyncStorage wrappers
  simulation/     # Demo scenarios
  state/          # React Context + useReducer
  constants.ts    # All UPPER_SNAKE_CASE constants from CLAUDE.md
  types.ts        # ContractionResponse, LaborSession, TorusPoint, FHRSample
app/
  _layout.tsx
  (tabs)/monitor.tsx
  (tabs)/log.tsx
  (tabs)/settings.tsx
  session/[id].tsx
  session/export.tsx
test/
  simulation/
  validation/
```

### 1.4 Drop In Canonical Code

Copy the `constants.ts` block verbatim from CLAUDE.md §"Key Constants" and the four math functions (`toAngle`, `geodesicDistance`, `mengerCurvature`, `giniCoefficient`) verbatim from CLAUDE.md §"The Torus Math" into `src/torus/`. **Do not rewrite these.** They are the canonical implementations.

---

## 2. Build Order (Phase 1: Data-Only, No Alerts)

Work strictly top-to-bottom. Each step lands testable, reviewable value.

### Step 1 — Torus Math + Tests (half-day, zero UI)

- `src/torus/math.ts` holds the four functions from CLAUDE.md.
- Write Jest tests covering every item in SPEC.md §10 "Testing Checklist" that concerns math (lines 471–479).
- This is the **foundation layer**. No other step is allowed to land until these tests pass.

### Step 2 — Types + Constants

- `src/types.ts`: the three interfaces from CLAUDE.md §"Data Models" (`ContractionResponse`, `LaborSession`, `TorusPoint`) plus `FHRSample` from SPEC.md §1.2.
- `src/constants.ts`: every constant from CLAUDE.md §"Key Constants".

### Step 3 — FHR Sample Store

- `src/ble/fhr-buffer.ts`: a 120-second ring buffer of `FHRSample`.
- `src/ble/quality-gate.ts`: per-sample validation (`FHR_MIN`, `FHR_MAX`, 10s gap event, rolling 5s CV > 0.30 warning).
- Pure functions; no BLE yet. Test with synthetic samples.

### Step 4 — BLE Doppler

- `src/ble/doppler.ts`: scan for Heart Rate Service `0x180D`, connect, subscribe to `0x2A37`.
- `src/ble/parse-hrm.ts`: parse the HRM characteristic byte layout from SPEC.md §1.1 (flags byte, uint8 vs uint16 HR, optional RR intervals in 1/1024s units).
- Prefer RR intervals when present; derive `interval_ms = 60000 / hr_bpm` otherwise.
- Reconnection loop: 5s retry, 2-minute ceiling; do not reset the session on reconnect.
- **Mock first:** build a `FakeDoppler` that emits synthetic HRM notifications so the rest of the app is developable without hardware.

### Step 5 — Live FHR Display

- Minimal `app/(tabs)/monitor.tsx`: current BPM, signal quality badge, last-120s sparkline.
- Confirms end-to-end BLE → buffer → UI.

### Step 6 — Manual Contraction Button

- Large button, 60s cooldown visual, pulses during cooldown (SPEC.md §2.2).
- Emits `ContractionDetection { method: 'manual', confidence: 1.0 }`.
- Store detections in session state (React Context + useReducer, per CLAUDE.md §"Tech Stack").

### Step 7 — Response Extraction

- `src/extraction/extract-response.ts` implements SPEC.md §3 exactly.
- Trigger: 60s after each contraction peak.
- Baseline = median of valid FHR in `[peak − 30s, peak]`; reject if < 50% valid or outside [100, 180] bpm.
- Nadir = `min(fhr − baseline)` in response window; `nadirTiming` = seconds to nadir.
- Recovery = first index where the next 5 seconds stay within ±`RECOVERY_THRESHOLD` of baseline; default to 60 if never.
- Response area = sum of negative deviations / sampleRate (bpm·seconds).
- Quality grade: `good` / `fair` / `poor` per SPEC.md §3.4. Only `good` + `fair` feed torus.

### Step 8 — Torus Computation

- `src/torus/map-point.ts` implements SPEC.md §4.1 (adaptive 2nd–98th percentile when `n ≥ 6`, otherwise fixed `NADIR_MAP_*` / `RECOVERY_MAP_*`).
- On each new contraction: append a `TorusPoint`; if `n ≥ 3`, back-fill `kappa` on `pts[n-2]` using `mengerCurvature`.

### Step 9 — Trajectory Features

- `src/trajectory/features.ts` returns the full `TrajectoryFeatures` interface from SPEC.md §4.3.
- OLS linear regression in ~10 lines (no libraries). Covers `recoveryTrendSlope`, `nadirTrendSlope`, and `nadirAcceleration` (slope last-third minus slope first-third; requires ≥ 9 contractions).

### Step 10 — Display Components

Build in this order (each standalone, storybook-style if helpful):

1. `StatusLight.tsx` (trivial; unblocks layout).
2. `RecoveryTrendChart.tsx` — SVG, ~120px, circles colored by threshold, dashed OLS trend line.
3. `TorusDisplay.tsx` — 280px SVG square, dark bg, grid at 25/50/75%, polyline + colored dots, pulsing white ring on latest.
4. `ContractionLog.tsx` — scrollable list; tap to expand response curve.
5. `SignalQualityBadge.tsx` and persistent `DisclaimerBanner.tsx`.

### Step 11 — Session Persistence

- `src/storage/session.ts`: auto-save current session to `session_current` every 30s and on every new contraction.
- On "End Session", move into `session_history` array (max 50, drop oldest).
- Hydrate on app start — must survive cold restart (SPEC.md §10 final checkbox).

### Step 12 — CSV Export + Simulation Mode

- CSV: one row per contraction, all `ContractionResponse` fields + trajectory features at that index.
- Simulation: three scenarios from SPEC.md §8, firing one contraction every 2s. Same pipeline as live mode — this is the integration test.

**Phase 1 Exit Criteria:** Run "Distress" simulation → torus populates, recovery trend climbs, contraction log fills, CSV exports. No alerts yet.

---

## 3. Build Order (Phase 2: Alerts + Detection + Export)

### Step 13 — Accelerometer Detection

`src/detection/accelerometer.ts` implements SPEC.md §2.1 exactly:
- Downsample z-axis to 4 Hz.
- 10s causal moving average low-pass.
- 30s rolling standard deviation.
- Adaptive prominence = 15% of last-10-minute 5th–95th percentile range, floor 0.01 g.
- Peak detection with ≥ 60s inter-peak gap.
- Confidence = `clip(prominence/(2·threshold), 0.3, 0.9)` + timing bonus + FHR-confirmation bonus.

### Step 14 — Bayesian Fusion

`src/detection/fusion.ts`:
- Merge accelerometer + manual detections within 30s windows. Manual wins timestamp; confidence = `max(accel, 1.0)` = 1.0.
- FHR confirmation: if ≥10 bpm deceleration for ≥10s arrives within 90s of accel peak, bump confidence +0.2.
- If accel fires with no FHR response in 90s, cut confidence.

### Step 15 — Personal Baseline + Adaptive Thresholds

- Establish after `MIN_CONTRACTIONS` (6) responses; **freeze**. Late-labor deterioration must be measured against early-labor baseline (SPEC.md §5.3).
- Adaptive `yellow`/`red` thresholds = `min(fixed_floor, personalMean + kσ)`.

### Step 16 — Alert Logic

`src/alerts/status.ts` implements the decision tree from CLAUDE.md §"Alert Logic" and SPEC.md §5.1:
- `grey` gates: `n < 6`, recent `fhrQuality < 0.5`, or `contractionConfidence < 0.5`.
- `red` requires **sustained** (`RED_PERSISTENCE = 2` consecutive red-eligible contractions) — track `redPersistenceCount` on the session.
- Fire haptics per SPEC.md §5.2 table. Log all transitions with toasts.

### Step 17 — User Correction UI

- Contraction log: swipe-to-delete false positive; long-press timeline to insert missed; drag marker to adjust timing.
- Any correction re-runs the trajectory + alert pipeline.

### Step 18 — PDF Export

`expo-print` renders a one-page HTML → PDF summary (SPEC.md §7.3): session metadata, embedded `RecoveryTrendChart` SVG, summary stats, contraction table, disclaimer.

**Phase 2 Exit Criteria:** Run "Distress" simulation → status walks `grey → green → yellow → red`, haptics fire, PDF exports with embedded chart.

---

## 4. Testing Strategy

Mirror CLAUDE.md §"Testing Strategy" one-for-one:

| Level | What | Where |
|---|---|---|
| Unit | Torus math (every SPEC.md §10 math case) | `test/torus/` |
| Unit | Quality gate boundary cases (FHR = 79, 80, 200, 201; gap = 9.9s vs 10.1s) | `test/ble/` |
| Unit | Recovery extraction edge cases (never recovers → 60s; immediate recovery ≈ nadirTiming) | `test/extraction/` |
| Integration | Detection → extraction → torus → trajectory → alert | `test/integration/` |
| Simulation | Normal → GREEN, Concerning → YELLOW, Distress → RED | `test/simulation/` |
| Snapshot | Display components | `test/display/` |
| Persistence | Auto-save, cold-restart hydration | `test/storage/` |

Every clinical-value function must have a JSDoc comment citing the Paper V section it came from (CLAUDE.md §"File Naming and Style").

---

## 5. Style + Conventions (from CLAUDE.md)

- Files: `kebab-case.ts`
- Components: `PascalCase.tsx`
- Constants: `UPPER_SNAKE_CASE`
- Functions: `camelCase`
- Types/Interfaces: `PascalCase`
- No default exports except screen components.
- JSDoc + Paper V citation on any function returning a clinical value.

---

## 6. Things Not To Build (CLAUDE.md §"What NOT To Build")

- No accounts, login, backend, analytics, crash reporting, ads, tracking.
- No diagnosis words anywhere: not "acidosis," "distress," "hypoxia."
- No action recommendations beyond "contact your provider."
- No Apple Health / Google Fit integration.
- No sharing except explicit user-initiated PDF/CSV export.

---

## 7. Definition of Done Per Phase

**Phase 1 is done when:**
- All math-tier tests from SPEC.md §10 pass.
- BLE pairs with a real Doppler OR `FakeDoppler` streams → live BPM updates.
- Manual button → response extracts → torus paints a point → CSV exports.
- Simulation mode runs all three scenarios end-to-end.
- Session survives cold restart.

**Phase 2 is done when:**
- Accelerometer detects contractions with confidence scores.
- Fusion merges manual + accel correctly.
- Status transitions `grey → green → yellow → red` fire with haptics + toasts.
- Personal baseline freezes at 6 contractions.
- PDF export renders with embedded chart.
- All SPEC.md §10 checkboxes are checked.

**Out-of-scope until later phases (README roadmap):**
- Phase 3: richer uncertainty display, polish.
- Phase 4: consumer-vs-clinical equivalence study.
- Phase 5: prospective hospital pilot.

---

## 8. Where To Look When Stuck

| Question | Source |
|---|---|
| What constant value? | `CLAUDE.md §"Key Constants"` |
| Exact algorithm? | `SPEC.md` section matching the module |
| Canonical math? | `CLAUDE.md §"The Torus Math"` — copy verbatim |
| Fixed vs adaptive bounds? | `CLAUDE.md §"Critical Discovery"` |
| Alert thresholds? | `README.md §"Alert Thresholds"` + `SPEC.md §5` |
| What NOT to include? | `CLAUDE.md §"What NOT To Build"` |
| Science / rationale? | `README.md §"The Science"` + future `docs/SCIENCE.md` |

---

*Build the recovery-trend engine first. The donut is just the dashboard.*
