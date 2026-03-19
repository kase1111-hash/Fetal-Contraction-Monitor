# Fetal Contraction Monitor

**Real-time geometric fetal monitoring from a $30 Doppler and a phone.**

Track how your baby responds to each contraction. Watch the recovery trend. See the trajectory on a torus. The math is 30 lines of code. The hardware is a Bluetooth fetal Doppler. The insight: recovery time diverges from normal 60 minutes before deceleration depth — the baby tires before it fails.

> **⚠️ RESEARCH PROTOTYPE — NOT A MEDICAL DEVICE**
> This software has been validated retrospectively on one database (CTU-UHB, 552 recordings). No prospective clinical validation has been performed. This does not replace clinical monitoring. If you have concerns about your pregnancy, contact your healthcare provider immediately.

---

## What It Does

For each uterine contraction during labor, the app extracts the fetal heart rate response:

| Feature | What it measures |
|---------|-----------------|
| **Nadir depth** | How far the heart rate drops (bpm below baseline) |
| **Recovery time** | How long until the heart rate returns to baseline (seconds) |
| **Response area** | Total deviation below baseline (bpm·seconds) |
| **Nadir timing** | When the drop occurs relative to the contraction peak |

Consecutive contraction responses are mapped onto the flat torus T² = [0, 2π) × [0, 2π), and the trajectory across labor is tracked in real time. The recovery trend — whether recovery time is stable, rising, or accelerating — is the primary clinical signal.

### The Key Finding

From 13,319 contraction responses across 542 labor recordings:

- **Recovery time** separates Normal from Acidotic fetuses at **20 contractions before delivery** (~60 minutes)
- **Deceleration depth** only separates at **8 contractions** (~24 minutes)
- Recovery leads depth by **36 minutes** — a clinically actionable early warning window
- 5/5 contraction-torus features carry **independent** information beyond standard FHR variability

The baby is tiring before it's failing. Recovery is the leading indicator.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  BLE Doppler     │────▶│  Signal Layer     │────▶│  Torus Engine   │
│  (FHR @ 1-4 Hz) │     │  quality gate     │     │  κ, Gini, trend │
└─────────────────┘     │  artifact reject  │     └────────┬────────┘
                        └──────────────────┘              │
┌─────────────────┐     ┌──────────────────┐     ┌────────▼────────┐
│  Accelerometer   │────▶│  Contraction      │────▶│  Alert Logic    │
│  (or manual tap) │     │  Detection        │     │  GREEN/YELLOW/  │
└─────────────────┘     │  confidence 0-1   │     │  RED / GREY     │
                        │  Bayesian fusion  │     └────────┬────────┘
                        └──────────────────┘              │
                                                 ┌────────▼────────┐
                                                 │  Display         │
                                                 │  torus + trend   │
                                                 │  + contraction   │
                                                 │    log           │
                                                 └─────────────────┘
```

**Four layers:**

1. **Signal Acquisition** — BLE Doppler for FHR, phone accelerometer (or manual timing) for contractions
2. **Response Extraction** — Per-contraction feature extraction: baseline, nadir, recovery, area
3. **Torus Computation** — Map to T², compute geodesic curvature, track trajectory
4. **Alert Logic** — Traffic light (GREEN/YELLOW/RED) based on recovery trend + adaptive personal thresholds

All computation runs locally on the phone. Zero cloud. Zero internet. Zero data leaves the device.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native (iOS + Android) |
| BLE | `react-native-ble-plx` |
| Sensors | Accelerometer via `expo-sensors` |
| Math | Pure JS/TS — no external math libraries needed |
| Storage | AsyncStorage (local only) |
| Export | PDF/CSV generation for provider sharing |

---

## Getting Started

```bash
# Clone
git clone https://github.com/kase1111-hash/fetal-contraction-monitor.git
cd fetal-contraction-monitor

# Install dependencies
npm install

# Run on iOS simulator
npx expo start --ios

# Run on Android
npx expo start --android
```

### Hardware

- **Required:** Bluetooth fetal Doppler with BLE Heart Rate Service (UUID 0x180D) or proprietary PPG stream. Examples: BabyTone (~$25), Sonoline B+BT (~$30), or equivalent.
- **Optional:** External BLE TOCO sensor for contraction detection
- **Fallback:** Phone accelerometer on abdomen, or manual contraction timing via button press

---

## Project Structure

```
fetal-contraction-monitor/
├── src/
│   ├── ble/                 # BLE connection, Doppler pairing, FHR parsing
│   ├── detection/           # Contraction detection (accel, manual, TOCO, Bayesian fusion)
│   ├── extraction/          # Per-contraction response extraction (nadir, recovery, area)
│   ├── torus/               # Core torus math (angle mapping, curvature, Gini)
│   ├── trajectory/          # Trend computation, countdown analysis, trajectory features
│   ├── alerts/              # Traffic light logic, adaptive thresholds, safety constraints
│   ├── display/             # Torus visualization, recovery trend chart, contraction log
│   ├── export/              # PDF/CSV session export
│   └── storage/             # Local data persistence
├── docs/
│   ├── PROTOCOL.md          # Full implementation protocol (from research)
│   ├── SCIENCE.md           # Paper V summary: what was validated and what wasn't
│   └── SAFETY.md            # Safety constraints, regulatory considerations, disclaimers
├── test/
│   ├── simulation/          # Simulated labor scenarios (normal, concerning, distress)
│   └── validation/          # Comparison against CTU-UHB research results
├── App.tsx
├── package.json
└── README.md
```

---

## Alert Thresholds

| Status | Criteria | Meaning |
|--------|----------|---------|
| 🟢 GREEN | Recovery slope < 0.3 s/ctx AND last-5 recovery < 40s | Reassuring |
| 🟡 YELLOW | Recovery slope ≥ 0.3 OR last-5 recovery ≥ 40s | Concerning — may be normal progression |
| 🔴 RED | Recovery slope ≥ 1.0 AND last-5 recovery ≥ 45s (sustained) | Alert — contact provider |
| ⚪ GREY | Signal quality poor OR < 6 contractions recorded | Insufficient data |

Thresholds adapt to the individual: after the first 6–10 contractions, alerts express as deviations from personal baseline (1σ = YELLOW, 2σ = RED) with the population thresholds as a safety floor.

---

## The Science

This app implements findings from **Paper V of the Cardiac Torus series**:

- **Database:** CTU-UHB Intrapartum Cardiotocography Database (PhysioNet, 552 recordings)
- **Independence:** 5/5 contraction-torus features survive controlling for FHR variability
- **Suppression effect:** Response area strengthens from ρ = −0.132 to partial ρ = −0.169 after controlling for std_fhr
- **Birth trajectory:** Recovery diverges 60 min before delivery; nadir at 24 min. 36-minute lead time.
- **Classification:** Basic CTG + trends reaches AUC = 0.712
- **Effect sizes:** Modest (partial ρ ≈ 0.10–0.17) — independent but not standalone

### What was NOT validated:
- Accelerometer-based contraction detection (research used clinical TOCO)
- Consumer Doppler FHR quality (research used clinical CTG)
- Prospective clinical outcomes
- Any population other than CTU-UHB (single hospital, Czech Republic)

Full research: [Cardiac Torus GitHub](https://github.com/kase1111-hash/Cardiac_Torus)

---

## Roadmap

- [ ] **Phase 1:** BLE Doppler pairing + FHR display + manual contraction timing + torus visualization (data-only, no alerts)
- [ ] **Phase 2:** Accelerometer contraction detection + Bayesian fusion + recovery trend chart + contraction log
- [ ] **Phase 3:** Alert logic (traffic light) + adaptive thresholds + uncertainty display + export
- [ ] **Phase 4:** Consumer-vs-clinical equivalence study (simultaneous recording)
- [ ] **Phase 5:** Prospective hospital pilot alongside standard CTG

---

## Related

- [Cardiac Torus](https://github.com/kase1111-hash/Cardiac_Torus) — Full research pipeline, papers, and validation
- [Cardiac Dance Monitor](https://github.com/kase1111-hash/cardiac-dance-monitor) — Adult heart rhythm identification on T²
- [Interactive Visualizer](https://cardiactorus.netlify.app/) — Paper I: 13 cardiac conditions on the torus
- [Trilogy Visualizer](https://cardiactorus-trilogy.netlify.app/) — Papers I–III: rhythm, imaging, sound

---

## Citation

```bibtex
@article{branham2026fetal,
  title={The Fetal Dance: Contraction-Response Geometry on T² Predicts Acidosis in 552 Intrapartum Cardiotocograms},
  author={Branham, Kase},
  year={2026},
  note={Paper V, Cardiac Torus Series. Independent Researcher, Portland, OR}
}
```

---

## License

MIT

---

*The beat is the contraction. The dance floor is a donut. And when the recoveries slow before the decelerations deepen, the geometry says what matters most: this baby needs help now.*
