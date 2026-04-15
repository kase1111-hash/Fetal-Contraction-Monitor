/**
 * Core domain types for the Fetal Contraction Monitor.
 *
 * Sourced from:
 *  - fetal-contraction-monitor-CLAUDE.md §"Data Models" (lines 83–120)
 *  - fetal-contraction-monitor-SPEC.md §1.2 (FHRSample)
 *  - fetal-contraction-monitor-SPEC.md §2.1 / §2.2 (ContractionDetection)
 *  - fetal-contraction-monitor-SPEC.md §4.3 (TrajectoryFeatures)
 */

// ---------------------------------------------------------------------------
// FHR stream
// ---------------------------------------------------------------------------

export interface FHRSample {
  /** Unix ms. */
  timestamp: number;
  /** Beats per minute. */
  fhr: number;
  /** Whether the value came from RR intervals (preferred) or a direct HR reading. */
  source: 'rr' | 'hr';
  /** True if the sample passes the quality gate (FHR_MIN..FHR_MAX). */
  valid: boolean;
}

export type FHRQuality = 'good' | 'fair' | 'poor' | 'disconnected';

// ---------------------------------------------------------------------------
// Contraction detection
// ---------------------------------------------------------------------------

export type DetectionMethod = 'accelerometer' | 'manual' | 'toco';

export interface ContractionDetection {
  /** Unix ms of the detected contraction peak. */
  peakTimestamp: number;
  method: DetectionMethod;
  /** 0–1 confidence; manual detections fix this at 1.0. */
  confidence: number;
  /** Raw peak prominence (accelerometer only). */
  prominenceRaw?: number;
  /** True if an FHR deceleration confirmed this detection within 90 s. */
  fhrConfirmed?: boolean;
}

// ---------------------------------------------------------------------------
// Per-contraction response (after extraction)
// ---------------------------------------------------------------------------

export type ResponseQuality = 'good' | 'fair' | 'poor';
export type AlertStatus = 'green' | 'yellow' | 'red' | 'grey';

export interface ContractionResponse {
  /** UUID. */
  id: string;
  /** Unix ms — time the response record was finalized. */
  timestamp: number;
  /** Unix ms — detected contraction peak. */
  contractionPeakTime: number;
  detectionMethod: DetectionMethod;
  /** 0–1. */
  detectionConfidence: number;

  /** bpm — median of pre-contraction window. */
  baselineFHR: number;
  /** bpm — maximum drop below baseline (negative number). */
  nadirDepth: number;
  /** seconds after contraction peak at which nadir occurs. */
  nadirTiming: number;
  /** seconds until first sustained return within RECOVERY_THRESHOLD of baseline. */
  recoveryTime: number;
  /** bpm·seconds — integral of deviation below baseline. */
  responseArea: number;

  /** 0–1 — fraction of valid samples in response window. */
  fhrQuality: number;
  /** Discrete quality grade derived from fhrQuality + confidence + baseline validity. */
  qualityGrade: ResponseQuality;
}

// ---------------------------------------------------------------------------
// Torus trajectory
// ---------------------------------------------------------------------------

export interface TorusPoint {
  /** [0, 2π) — nadir-depth angle. */
  theta1: number;
  /** [0, 2π) — recovery-time angle. */
  theta2: number;
  /** Menger curvature at this point (0 until three neighbors exist). */
  kappa: number;
  contractionId: string;
}

export interface TrajectoryFeatures {
  kappaMedian: number;
  kappaGini: number;
  /** s/contraction — OLS slope of recovery time vs contraction index. */
  recoveryTrendSlope: number;
  /** bpm/contraction — OLS slope of nadir depth vs contraction index. */
  nadirTrendSlope: number;
  recoveryLast5Mean: number;
  /** slope(last third) − slope(first third); requires ≥9 contractions, else 0. */
  nadirAcceleration: number;
  areaLast5Mean: number;
  contractionCount: number;
}

// ---------------------------------------------------------------------------
// Labor session (the top-level persisted object)
// ---------------------------------------------------------------------------

export interface PersonalBaseline {
  recoveryMean: number;
  recoverySd: number;
  nadirMean: number;
  nadirSd: number;
}

export interface LaborSession {
  id: string;
  startTime: number;
  /** Unix ms — null until session ended. */
  endTime: number | null;
  contractions: ContractionResponse[];
  status: AlertStatus;
  /** s/contraction — null until MIN_CONTRACTIONS reached. */
  recoveryTrendSlope: number | null;
  nadirTrendSlope: number | null;
  personalBaseline: PersonalBaseline | null;
  /** Consecutive red-eligible contractions (for RED_PERSISTENCE gating). */
  redPersistenceCount: number;
  /** Ordered log of status transitions (for review + export). */
  statusHistory: StatusTransition[];
}

export interface StatusTransition {
  from: AlertStatus;
  to: AlertStatus;
  /** Unix ms. */
  at: number;
  /** Index of the contraction that triggered the transition. */
  contractionIndex: number;
}
