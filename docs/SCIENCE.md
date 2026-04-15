# SCIENCE.md

A summary of what Paper V ("The Fetal Dance") validated, the specific numbers
the app implements, and what has **not** been validated.

For the full research pipeline see
[Cardiac Torus GitHub](https://github.com/kase1111-hash/Cardiac_Torus).

---

## Database

- **CTU-UHB Intrapartum Cardiotocography Database** (PhysioNet, 552 recordings)
- Single hospital, Czech Republic
- Clinical CTG, not consumer Doppler
- Clinical TOCO for contraction timing, not accelerometer

From 13,319 extracted contraction responses:
- 1,203 responses classified as late decelerations
- 2,197 as early decelerations
- 9,919 as variable or no clear type

## The four per-contraction features

| Feature | Measurement | Unit |
|---|---|---|
| Nadir depth | max(baseline − fhr) during the 60 s response window | bpm (reported as a negative number) |
| Recovery time | time until FHR returns to within ±5 bpm of baseline and stays for ≥5 s | seconds |
| Response area | integral of deviation below baseline | bpm·s |
| Nadir timing | seconds from contraction peak to nadir | seconds |

Baseline = median FHR in the 30 s before the contraction peak.

## Mapping to the torus T²

Two of the four features (nadir depth, recovery time) map to the two angles
of the flat torus T² = [0, 2π) × [0, 2π). See `SPEC.md §4.1` for the exact
computation and `CLAUDE.md §"Critical Discovery"` for the fixed-vs-adaptive
normalization requirement.

## Key findings from Paper V

- **Recovery time separates Normal from Acidotic fetuses at 20 contractions
  before delivery (~60 minutes).**
- **Deceleration depth only separates at 8 contractions (~24 minutes).**
- Recovery leads depth by **36 minutes** — the clinically actionable early
  warning window the app surfaces.
- 5/5 contraction-torus features carry **independent** information beyond
  standard FHR variability (short-term and long-term variability).
- Classification performance: basic CTG + trends reaches AUC = 0.712.
- Effect sizes are modest: partial ρ ≈ 0.10–0.17. These features are
  independent but not standalone — they supplement, never replace, CTG.

## Suppression effect

Response area has a marginal Spearman correlation with acidosis of
ρ = −0.132. After controlling for FHR standard deviation (a standard
CTG variability measure), the partial correlation **strengthens** to
partial ρ = −0.169.

This is a classical suppression pattern: the noise-driven component of
response area is orthogonal to the contraction-response signal, and
conditioning on noise removes variance that was muddying the estimate.

## Alert thresholds (validated by Paper V)

From CLAUDE.md §"Key Constants":

- MIN_CONTRACTIONS = 6       — trajectory analysis off below this
- SLOPE_YELLOW    = 0.3 s/ctx — recovery-time trend slope
- SLOPE_RED       = 1.0 s/ctx
- LAST5_YELLOW    = 40 s      — running mean of last 5 recovery times
- LAST5_RED       = 45 s
- RED_PERSISTENCE = 2         — consecutive red-eligible contractions

## What has NOT been validated

- Accelerometer-based contraction detection (research used clinical TOCO).
- Consumer Doppler FHR quality (research used clinical CTG).
- Prospective clinical outcomes.
- Any population other than CTU-UHB (single hospital).

## Citation

```bibtex
@article{branham2026fetal,
  title={The Fetal Dance: Contraction-Response Geometry on T² Predicts Acidosis
         in 552 Intrapartum Cardiotocograms},
  author={Branham, Kase},
  year={2026},
  note={Paper V, Cardiac Torus Series. Independent Researcher, Portland, OR}
}
```
