# SAFETY.md

## This is not a medical device.

Every screen of this app displays this. Every export carries a disclaimer.
Every "alert" defers to the user's healthcare provider.

If you are using this app during labor:

- **Do not rely on it to detect fetal distress.** The validated early warning
  window (36 minutes) was derived retrospectively from clinical CTG data. The
  same numbers do not necessarily hold for consumer Doppler data, for your
  specific pregnancy, or for the edge cases the database did not sample.
- **If you have any concern at all, contact your healthcare provider.** The
  app's alert thresholds exist to prompt that conversation earlier, not to
  replace it.
- **Do not delay going to the hospital because the app says "green."** The
  app is green-biased when data is noisy, sparse, or unusual; a false-green
  is the least-informative state.

## Regulatory status

This app is a research prototype. It has not been reviewed or cleared by
the FDA, CE, PMDA, or any other regulator. It is distributed under the MIT
license for research and educational use only.

## Engineering safeguards

The app implements several safety constraints in code:

### No false certainty
- Status is `grey` when `n < MIN_CONTRACTIONS` (6), regardless of FHR data.
- Status is `grey` when recent contractions have `fhrQuality < 0.5` or
  `detectionConfidence < 0.5` — a noisy trace is explicitly unreliable, not
  optimistic.
- `redPersistenceCount` is preserved across quality-induced greys so a
  developing red state cannot be silently erased by a single bad reading.
- Every function returning a clinical value carries a JSDoc citation to the
  validation source.

### No action recommendations
Per CLAUDE.md §"What NOT To Build":
- The app never uses the words *diagnosis*, *acidosis*, *distress*, or
  *hypoxia*.
- Alert messages never say "go to the hospital" or "call 911".
- The only action prompt is "contact your healthcare provider."

### No data exfiltration
- All computation runs locally on the device.
- Zero cloud. Zero analytics. Zero crash reporting.
- No Apple Health / Google Fit / wearable integration.
- Data leaves the device only when the user explicitly exports a PDF or CSV.

### No silent data loss
- Sessions auto-save every 30 s and after each contraction.
- Cold restart hydrates from AsyncStorage (SPEC.md §7.1).
- BLE disconnects log a gap event and retry up to 2 minutes; the session
  is not reset.
- Corrupt storage blobs are cleared rather than crashing the app.

## Limitations to communicate clearly to users

- **Accelerometer detection is noisy.** Phone placement, maternal movement,
  and body habitus all degrade it. Users should manually tap contractions
  when the accelerometer is unreliable — a manual tap always wins in fusion.
- **Consumer Dopplers drop frames.** The app logs gaps ≥ 10 s and greys out
  affected contractions. A greyed contraction is kept in the log but does
  not participate in trajectory analysis.
- **The personal baseline freezes at 6 contractions** (SPEC.md §5.3).
  Late-labor deterioration is measured against early-labor baseline, which
  is the research-validated behavior — but means an abnormal first 6
  contractions produce an abnormal reference.
- **Paper V's effect sizes are modest.** Partial ρ ≈ 0.10–0.17. The app is
  designed to prompt earlier conversation with a provider, not to replace
  clinical monitoring.

## Reporting safety concerns

- GitHub Issues: https://github.com/kase1111-hash/fetal-contraction-monitor/issues
- Security / sensitive issues: contact the maintainer directly.
