/**
 * FHRResponseCurve — a small inline chart of the fetal heart-rate response
 * for a single contraction.
 *
 * Reference: SPEC.md §6.4 "Row tap → expand to show: full FHR response curve,
 * area, nadir timing, detection method".
 *
 * Since raw FHR samples are NOT persisted on the ContractionResponse (kept
 * only transiently in the live ring buffer), this component reconstructs an
 * idealized curve from the extracted features: baseline, nadirDepth,
 * nadirTiming, recoveryTime. The curve is marked "reconstructed" in the UI
 * label so the user isn't misled into thinking this is the raw trace.
 *
 * Shape: constant at baseline until t=0 → linear descent to nadir at
 * nadirTiming → linear rise to within RECOVERY_THRESHOLD of baseline at
 * recoveryTime → back to baseline.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Line,
  Polyline,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import { BASELINE_WINDOW, RECOVERY_THRESHOLD, RESPONSE_WINDOW } from '../constants';
import type { ContractionResponse } from '../types';

export interface FHRResponseCurveProps {
  contraction: ContractionResponse;
  width?: number;
  height?: number;
}

/**
 * Reconstruct the response curve shape as (tSec, fhr) pairs.
 * Visible window: [-BASELINE_WINDOW, +RESPONSE_WINDOW] relative to peak.
 */
function reconstructCurve(c: ContractionResponse): { t: number; fhr: number }[] {
  const b = c.baselineFHR;
  const nadir = b + c.nadirDepth; // nadirDepth is negative
  const nadirTiming = Math.max(1, c.nadirTiming); // guard against 0
  const recoveryTime = Math.min(RESPONSE_WINDOW, Math.max(c.recoveryTime, nadirTiming + 1));
  // Breakpoints
  const pts: { t: number; fhr: number }[] = [];
  pts.push({ t: -BASELINE_WINDOW, fhr: b });
  pts.push({ t: 0, fhr: b });
  pts.push({ t: nadirTiming, fhr: nadir });
  pts.push({ t: recoveryTime, fhr: b });
  pts.push({ t: RESPONSE_WINDOW, fhr: b });
  return pts;
}

export function FHRResponseCurve({
  contraction,
  width = 320,
  height = 120,
}: FHRResponseCurveProps): React.ReactElement {
  const pad = 24;
  const w = width - 2 * pad;
  const h = height - 2 * pad;

  const tMin = -BASELINE_WINDOW;
  const tMax = RESPONSE_WINDOW;
  const curve = reconstructCurve(contraction);
  const baseline = contraction.baselineFHR;
  const nadir = baseline + contraction.nadirDepth;

  // FHR axis: baseline ± 40 bpm, but always include the nadir with margin.
  const yMax = Math.max(baseline + 10, baseline + 20);
  const yMin = Math.min(nadir - 10, baseline - 40);

  const xScale = (t: number) => pad + ((t - tMin) / (tMax - tMin)) * w;
  const yScale = (fhr: number) => pad + h - ((fhr - yMin) / (yMax - yMin)) * h;

  const curvePts = curve
    .map((p) => `${xScale(p.t)},${yScale(p.fhr)}`)
    .join(' ');

  // Nadir marker position
  const nadirX = xScale(contraction.nadirTiming);
  const nadirY = yScale(nadir);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>FHR response (reconstructed)</Text>
        <Text style={styles.subtitle}>
          Idealized from baseline, nadir, and recovery — not the raw trace.
        </Text>
      </View>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill="#0a0a0f" stroke="#1a1a2e" />
        {/* Baseline ±RECOVERY_THRESHOLD band */}
        <Rect
          x={pad}
          y={yScale(baseline + RECOVERY_THRESHOLD)}
          width={w}
          height={Math.max(
            0,
            yScale(baseline - RECOVERY_THRESHOLD) - yScale(baseline + RECOVERY_THRESHOLD),
          )}
          fill="#27ae60"
          opacity={0.08}
        />
        {/* Baseline line */}
        <Line
          x1={pad}
          y1={yScale(baseline)}
          x2={pad + w}
          y2={yScale(baseline)}
          stroke="#4a4a6b"
          strokeWidth={1}
          strokeDasharray="3,3"
        />
        {/* Contraction peak vertical */}
        <Line
          x1={xScale(0)}
          y1={pad}
          x2={xScale(0)}
          y2={pad + h}
          stroke="#f2c94c"
          strokeWidth={1}
          strokeDasharray="2,4"
          opacity={0.6}
        />
        {/* Recovery marker */}
        <Line
          x1={xScale(contraction.recoveryTime)}
          y1={pad}
          x2={xScale(contraction.recoveryTime)}
          y2={pad + h}
          stroke="#3ecf75"
          strokeWidth={1}
          strokeDasharray="2,4"
          opacity={0.4}
        />
        {/* Response curve */}
        <Polyline
          points={curvePts}
          fill="none"
          stroke="#cfcfd4"
          strokeWidth={1.5}
        />
        {/* Nadir dot */}
        <Circle cx={nadirX} cy={nadirY} r={4} fill="#eb5757" />
        {/* Labels */}
        <SvgText
          x={xScale(0) + 3}
          y={pad + 10}
          fontSize={9}
          fill="#f2c94c"
        >
          peak
        </SvgText>
        <SvgText
          x={nadirX + 6}
          y={nadirY + 3}
          fontSize={9}
          fill="#eb5757"
        >
          nadir
        </SvgText>
        <SvgText
          x={pad}
          y={pad - 6}
          fontSize={9}
          fill="#9a9aa6"
        >
          bpm
        </SvgText>
        <SvgText
          x={pad + w - 24}
          y={pad + h + 14}
          fontSize={9}
          fill="#9a9aa6"
        >
          {`${RESPONSE_WINDOW}s →`}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 8 },
  header: { marginBottom: 4 },
  title: { color: '#cfcfd4', fontSize: 11, letterSpacing: 0.5 },
  subtitle: { color: '#5a5a66', fontSize: 10 },
});
