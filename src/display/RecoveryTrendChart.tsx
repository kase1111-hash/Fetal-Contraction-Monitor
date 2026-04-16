/**
 * RecoveryTrendChart — mini line chart: recovery time per contraction
 * with an OLS trend line. Reference: SPEC.md §6.2.
 *
 * Visual priority: this is the primary clinical signal of the app (see
 * CLAUDE.md §"Core Insight"). Design for clarity at a glance, not pixels.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';
import { LAST5_RED, LAST5_YELLOW } from '../constants';
import { STATUS_COLORS, recoveryDotColor } from './colors';
import { mean, olsSlope } from '../extraction/statistics';
import type { AlertStatus, ContractionResponse } from '../types';

export interface RecoveryTrendChartProps {
  contractions: readonly ContractionResponse[];
  status: AlertStatus;
  width?: number;
  height?: number;
}

export function RecoveryTrendChart({
  contractions,
  status,
  width = 320,
  height = 120,
}: RecoveryTrendChartProps): React.ReactElement {
  const pad = 8;
  const w = width - 2 * pad;
  const h = height - 2 * pad;

  // Y-axis scales between 0 and max(60, observed) so the RED shading band at 45 s
  // is always visible.
  const observed = contractions.map((c) => c.recoveryTime);
  const yMax = Math.max(60, ...observed);
  const yScale = (v: number) => pad + h - (v / yMax) * h;

  const n = contractions.length;
  const xAt = (i: number) => {
    if (n <= 1) return pad + w / 2;
    return pad + (i / (n - 1)) * w;
  };

  const trendSlope = olsSlope(observed);
  const trendIntercept = mean(observed) - trendSlope * ((n - 1) / 2);
  const trendStart = trendIntercept;
  const trendEnd = trendIntercept + trendSlope * (n - 1);

  const points = contractions
    .map((c, i) => `${xAt(i)},${yScale(c.recoveryTime)}`)
    .join(' ');

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        {/* Red danger band above LAST5_RED */}
        <Rect
          x={pad}
          y={pad}
          width={w}
          height={yScale(LAST5_RED) - pad}
          fill="#eb5757"
          opacity={0.08}
        />
        {/* Yellow band */}
        <Rect
          x={pad}
          y={yScale(LAST5_RED)}
          width={w}
          height={yScale(LAST5_YELLOW) - yScale(LAST5_RED)}
          fill="#f2c94c"
          opacity={0.08}
        />
        {/* Baseline border */}
        <Rect x={0} y={0} width={width} height={height} fill="none" stroke="#1a1a2e" />

        {n >= 2 && (
          <Polyline
            points={points}
            fill="none"
            stroke="#4a4a6b"
            strokeWidth={1}
          />
        )}

        {n >= 2 && (
          <Line
            x1={xAt(0)}
            y1={yScale(trendStart)}
            x2={xAt(n - 1)}
            y2={yScale(trendEnd)}
            stroke={STATUS_COLORS[status]}
            strokeWidth={1.5}
            strokeDasharray="4,3"
          />
        )}

        {contractions.map((c, i) => (
          <Circle
            key={c.id}
            cx={xAt(i)}
            cy={yScale(c.recoveryTime)}
            r={3}
            fill={recoveryDotColor(c.recoveryTime)}
          />
        ))}
      </Svg>
    </View>
  );
}
