/**
 * All clinical, signal-processing, and alert constants.
 * Reproduced verbatim from fetal-contraction-monitor-CLAUDE.md §"Key Constants" (lines 45–80).
 *
 * Every constant here is tied to Paper V validation. Changing any of these
 * invalidates the research-backed thresholds. Do not edit without citing the
 * replacement study.
 */

// ---------------------------------------------------------------------------
// Quality gating (FHR sample validity)
// ---------------------------------------------------------------------------

/** bpm — below this = artifact or maternal signal. */
export const FHR_MIN = 80;
/** bpm — above this = artifact. */
export const FHR_MAX = 200;
/** seconds — gap this long indicates a displaced probe. */
export const FHR_GAP_THRESHOLD = 10;
/** Coefficient of variation in a 5s window above this = possibly maternal. */
export const FHR_CV_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Contraction detection (accelerometer)
// ---------------------------------------------------------------------------

/** seconds — minimum inter-contraction distance. */
export const CTX_MIN_DISTANCE = 60;
/** seconds — low-pass window for the accelerometer stream. */
export const CTX_SMOOTHING_WINDOW = 10;
/** Fraction of the 5th–95th percentile range used as prominence threshold. */
export const CTX_PROMINENCE_FRACTION = 0.15;
/** Detections below this confidence are flagged as uncertain. */
export const CTX_CONFIDENCE_FLOOR = 0.5;

// ---------------------------------------------------------------------------
// Response extraction
// ---------------------------------------------------------------------------

/** seconds — pre-contraction window used to compute baseline FHR. */
export const BASELINE_WINDOW = 30;
/** seconds — post-contraction window within which response features are measured. */
export const RESPONSE_WINDOW = 60;
/** bpm — "within this of baseline" counts as recovered. */
export const RECOVERY_THRESHOLD = 5;
/** Fraction of the baseline window that must consist of valid samples. */
export const MIN_BASELINE_VALID = 0.5;
/** Fraction of the response window that must consist of valid samples. */
export const MIN_RESPONSE_VALID = 0.6;
/** bpm — baseline below this is implausible → reject contraction. */
export const BASELINE_RANGE_MIN = 100;
/** bpm — baseline above this is implausible → reject contraction. */
export const BASELINE_RANGE_MAX = 180;

// ---------------------------------------------------------------------------
// Torus angle mapping (fixed population bounds for alert logic)
// ---------------------------------------------------------------------------
//
// CLINICAL semantics, not numerical min/max. When calling `toAngle`, callers
// must pass the numerically smaller value as `min`. See SPEC.md §4.1 for the
// correct calling convention (nMin = NADIR_MAP_MAX, nMax = NADIR_MAP_MIN).

/** bpm — nadir of 0 (no drop) maps to one end of the circle. */
export const NADIR_MAP_MIN = 0;
/** bpm — nadir of -50 (max drop) maps to the opposite end. */
export const NADIR_MAP_MAX = -50;
/** seconds — recovery of 5s maps to one end. */
export const RECOVERY_MAP_MIN = 5;
/** seconds — recovery of 60s maps to the opposite end. */
export const RECOVERY_MAP_MAX = 60;

// ---------------------------------------------------------------------------
// Alert thresholds (Paper V, population-level)
// ---------------------------------------------------------------------------

/** Minimum contractions before trajectory analysis runs. Below → grey. */
export const MIN_CONTRACTIONS = 6;
/** s/contraction — recovery trend slope above this = YELLOW-eligible. */
export const SLOPE_YELLOW = 0.3;
/** s/contraction — recovery trend slope above this = RED-eligible (sustained). */
export const SLOPE_RED = 1.0;
/** seconds — last-5 recovery mean above this = YELLOW-eligible. */
export const LAST5_YELLOW = 40;
/** seconds — last-5 recovery mean above this = RED-eligible. */
export const LAST5_RED = 45;
/** Consecutive red-eligible contractions required before surfacing RED. */
export const RED_PERSISTENCE = 2;

// ---------------------------------------------------------------------------
// Buffering and timing
// ---------------------------------------------------------------------------

/** seconds — rolling FHR ring-buffer horizon. Covers baseline + response windows. */
export const FHR_BUFFER_SECONDS = 120;
/** milliseconds between auto-saves of the live session to AsyncStorage. */
export const AUTO_SAVE_INTERVAL_MS = 30_000;
/** Maximum number of completed sessions kept in history. */
export const MAX_SESSION_HISTORY = 50;
