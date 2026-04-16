/**
 * Shared display colors. Keeps thresholds aligned across
 * ContractionLog, RecoveryTrendChart, and any future view that colors
 * by recovery time / nadir depth / alert status.
 *
 * Two flavors of recovery color:
 *   - recoveryTextColor: used when coloring a number in a text row.
 *     Below the yellow threshold returns the neutral text color so the
 *     row is quiet when there's nothing to call out.
 *   - recoveryDotColor: used when coloring a data point on a chart.
 *     Always returns a semantic color — a data point with no semantic
 *     is confusing, so "below yellow" becomes green.
 */

import { LAST5_RED, LAST5_YELLOW, NADIR_ALERT_DEPTH } from '../constants';
import type { AlertStatus } from '../types';

export const COLOR_RED = '#eb5757';
export const COLOR_YELLOW = '#f2c94c';
export const COLOR_GREEN = '#3ecf75';
export const COLOR_GREY = '#5a5a66';
export const COLOR_TEXT_NEUTRAL = '#cfcfd4';

export const STATUS_COLORS: Record<AlertStatus, string> = {
  green: COLOR_GREEN,
  yellow: COLOR_YELLOW,
  red: COLOR_RED,
  grey: COLOR_GREY,
};

export function recoveryTextColor(recoverySeconds: number): string {
  if (recoverySeconds >= LAST5_RED) return COLOR_RED;
  if (recoverySeconds >= LAST5_YELLOW) return COLOR_YELLOW;
  return COLOR_TEXT_NEUTRAL;
}

export function recoveryDotColor(recoverySeconds: number): string {
  if (recoverySeconds >= LAST5_RED) return COLOR_RED;
  if (recoverySeconds >= LAST5_YELLOW) return COLOR_YELLOW;
  return COLOR_GREEN;
}

export function nadirTextColor(nadirDepthBpm: number): string {
  return nadirDepthBpm < NADIR_ALERT_DEPTH ? COLOR_RED : COLOR_TEXT_NEUTRAL;
}
