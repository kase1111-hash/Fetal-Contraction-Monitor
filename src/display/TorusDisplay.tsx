/**
 * TorusDisplay — renders the trajectory of TorusPoints on a square SVG.
 *
 * Reference: SPEC.md §6.1.
 *
 *   - Dark background (#0a0a0f), thin border (#1a1a2e)
 *   - Grid lines at 25%, 50%, 75%
 *   - Polyline connecting consecutive points (low opacity)
 *   - Circles at each point: radius + opacity scale with recency;
 *     color scales with curvature (green low → red high)
 *   - Latest point: pulsing white ring (static here; animation deferred)
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Rect } from 'react-native-svg';
import { TWO_PI } from '../torus/math';
import type { TorusPoint } from '../types';

export interface TorusDisplayProps {
  points: readonly TorusPoint[];
  size?: number;
}

/** Color ramp: green at kappa 0 → red at high kappa. Clamps at ~2. */
function kappaColor(kappa: number): string {
  const t = Math.min(1, kappa / 2);
  const r = Math.round(62 + (235 - 62) * t);
  const g = Math.round(207 - (207 - 87) * t);
  const b = Math.round(117 - (117 - 87) * t);
  return `rgb(${r},${g},${b})`;
}

export function TorusDisplay({ points, size = 280 }: TorusDisplayProps): React.ReactElement {
  const pad = 10;
  const box = size - 2 * pad;
  const proj = (theta: number) => pad + (theta / TWO_PI) * box;

  const polyPoints = points.map((p) => `${proj(p.theta1)},${size - proj(p.theta2)}`).join(' ');

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Rect x={0} y={0} width={size} height={size} fill="#0a0a0f" stroke="#1a1a2e" />
        <G>
          {[0.25, 0.5, 0.75].map((f) => (
            <React.Fragment key={f}>
              <Line
                x1={pad + f * box}
                y1={pad}
                x2={pad + f * box}
                y2={size - pad}
                stroke="#1a1a2e"
                strokeWidth={1}
              />
              <Line
                x1={pad}
                y1={pad + f * box}
                x2={size - pad}
                y2={pad + f * box}
                stroke="#1a1a2e"
                strokeWidth={1}
              />
            </React.Fragment>
          ))}
        </G>

        {points.length >= 2 && (
          <Polyline points={polyPoints} fill="none" stroke="#4a4a6b" strokeWidth={1} opacity={0.6} />
        )}

        {points.map((p, i) => {
          const recency = points.length <= 1 ? 1 : i / (points.length - 1);
          const radius = 2 + 4 * recency;
          const opacity = 0.2 + 0.8 * recency;
          const cx = proj(p.theta1);
          const cy = size - proj(p.theta2);
          return (
            <Circle
              key={p.contractionId}
              cx={cx}
              cy={cy}
              r={radius}
              fill={kappaColor(p.kappa)}
              opacity={opacity}
            />
          );
        })}

        {points.length > 0 && (
          <Circle
            cx={proj(points[points.length - 1]!.theta1)}
            cy={size - proj(points[points.length - 1]!.theta2)}
            r={8}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1.5}
            opacity={0.8}
          />
        )}
      </Svg>
    </View>
  );
}
