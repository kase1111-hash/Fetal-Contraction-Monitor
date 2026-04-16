/**
 * StatusLight — the large traffic-light circle at the top of the monitor screen.
 *
 * Reference: SPEC.md §6.3 "StatusLight" and §5.2 "Notifications" color mapping.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { STATUS_COLORS } from './colors';
import type { AlertStatus } from '../types';

export interface StatusLightProps {
  status: AlertStatus;
  size?: number;
}

export function StatusLight({ status, size = 64 }: StatusLightProps): React.ReactElement {
  const color = STATUS_COLORS[status];
  const r = size / 2 - 2;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="45%" r="55%">
            <Stop offset="0%" stopColor={color} stopOpacity={1} />
            <Stop offset="100%" stopColor={color} stopOpacity={status === 'grey' ? 0.7 : 0.9} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="url(#glow)" />
      </Svg>
    </View>
  );
}
