/**
 * PDF export — builds a one-page HTML summary and hands it to expo-print.
 *
 * Reference: fetal-contraction-monitor-SPEC.md §7.3 (lines 414–419).
 *
 * The HTML is assembled by a pure helper `buildSessionHtml`, which is
 * unit-tested without expo-print. `exportSessionPdf` is the React-Native
 * entry point that calls expo-print to produce a shareable file URI.
 *
 * The chart rendered in the PDF is a compact inline SVG of the recovery
 * trend — no external fonts or images — so the PDF renders identically
 * across devices and never needs network access.
 */

import { computeTrajectoryFeatures } from '../trajectory/features';
import { LAST5_RED, LAST5_YELLOW } from '../constants';
import type { LaborSession } from '../types';

export interface PdfExportOptions {
  /** Title shown in the PDF header. */
  title?: string;
}

/** Round to one decimal, preserve 0. */
function f1(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(1);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTrendSvg(
  contractions: LaborSession['contractions'],
  width = 560,
  height = 180,
): string {
  const pad = 20;
  const w = width - 2 * pad;
  const h = height - 2 * pad;
  const ys = contractions.map((c) => c.recoveryTime);
  const yMax = Math.max(60, ...ys);
  const scaleY = (v: number) => pad + h - (v / yMax) * h;
  const n = contractions.length;
  const xAt = (i: number) => (n <= 1 ? pad + w / 2 : pad + (i / (n - 1)) * w);

  const redBandY = scaleY(LAST5_RED);
  const yellowBandY = scaleY(LAST5_YELLOW);

  const polyline = contractions
    .map((c, i) => `${xAt(i)},${scaleY(c.recoveryTime)}`)
    .join(' ');

  const points = contractions
    .map(
      (c, i) =>
        `<circle cx="${xAt(i)}" cy="${scaleY(
          c.recoveryTime,
        )}" r="2.5" fill="${
          c.recoveryTime >= LAST5_RED
            ? '#c0392b'
            : c.recoveryTime >= LAST5_YELLOW
              ? '#d4a017'
              : '#27ae60'
        }" />`,
    )
    .join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#fcfcfa" stroke="#d0d0d0" />
      <rect x="${pad}" y="${pad}" width="${w}" height="${redBandY - pad}" fill="#fdecea" />
      <rect x="${pad}" y="${redBandY}" width="${w}" height="${
        yellowBandY - redBandY
      }" fill="#fdf4da" />
      ${n >= 2 ? `<polyline points="${polyline}" fill="none" stroke="#666" stroke-width="1"/>` : ''}
      ${points}
      <text x="${pad}" y="${pad - 6}" font-size="10" fill="#666">Recovery (s) per contraction</text>
    </svg>
  `;
}

/**
 * Pure HTML builder. No React Native dependency — unit-testable.
 */
export function buildSessionHtml(
  session: LaborSession,
  opts: PdfExportOptions = {},
): string {
  const title = opts.title ?? `Session ${session.id.slice(0, 8)}`;
  const features = computeTrajectoryFeatures(session.contractions);
  const durationMin = session.endTime
    ? Math.round((session.endTime - session.startTime) / 60_000)
    : Math.round((Date.now() - session.startTime) / 60_000);

  const dateStr = new Date(session.startTime).toISOString().slice(0, 10);

  const logRows = session.contractions
    .map((c, i) => {
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${f1(c.nadirDepth)}</td>
          <td>${f1(c.recoveryTime)}</td>
          <td>${f1(c.responseArea)}</td>
          <td>${(c.detectionConfidence * 100).toFixed(0)}%</td>
          <td>${escapeHtml(c.qualityGrade)}</td>
        </tr>`;
    })
    .join('');

  const statusColor =
    session.status === 'red'
      ? '#c0392b'
      : session.status === 'yellow'
        ? '#d4a017'
        : session.status === 'green'
          ? '#27ae60'
          : '#7f8c8d';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 24mm; }
    body { font-family: -apple-system, 'Segoe UI', sans-serif; color: #222; font-size: 11pt; }
    h1 { margin: 0 0 4px 0; font-size: 18pt; }
    .meta { color: #666; font-size: 10pt; }
    .status-pill {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 10px;
      color: #fff;
      font-weight: 600;
      font-size: 10pt;
      margin-left: 8px;
      background: ${statusColor};
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-top: 16px;
    }
    .stat {
      border: 1px solid #e0e0e0;
      padding: 8px 10px;
      border-radius: 6px;
    }
    .stat-label { font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 14pt; font-weight: 600; color: #222; margin-top: 2px; }
    .section-title { margin-top: 20px; font-size: 12pt; font-weight: 600; color: #444; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 9.5pt; }
    th, td { border-bottom: 1px solid #eee; padding: 4px 6px; text-align: left; }
    th { background: #f7f7f5; font-weight: 600; color: #555; }
    .disclaimer {
      margin-top: 20px;
      padding: 10px;
      border-left: 3px solid #999;
      background: #f6f6f4;
      font-size: 9pt;
      color: #555;
    }
  </style>
</head>
<body>
  <h1>Fetal Contraction Monitor <span class="status-pill">${session.status.toUpperCase()}</span></h1>
  <div class="meta">${escapeHtml(dateStr)} · ${durationMin} min · ${session.contractions.length} contractions</div>

  <div class="grid">
    <div class="stat">
      <div class="stat-label">Mean Nadir</div>
      <div class="stat-value">${f1(
        session.contractions.length === 0
          ? 0
          : session.contractions.reduce((s, c) => s + c.nadirDepth, 0) /
              session.contractions.length,
      )} bpm</div>
    </div>
    <div class="stat">
      <div class="stat-label">Mean Recovery</div>
      <div class="stat-value">${f1(
        session.contractions.length === 0
          ? 0
          : session.contractions.reduce((s, c) => s + c.recoveryTime, 0) /
              session.contractions.length,
      )} s</div>
    </div>
    <div class="stat">
      <div class="stat-label">Recovery Slope</div>
      <div class="stat-value">${f1(features.recoveryTrendSlope)} s/ctx</div>
    </div>
    <div class="stat">
      <div class="stat-label">Last-5 Recovery</div>
      <div class="stat-value">${f1(features.recoveryLast5Mean)} s</div>
    </div>
  </div>

  <div class="section-title">Recovery trend</div>
  ${renderTrendSvg(session.contractions)}

  <div class="section-title">Contraction log</div>
  <table>
    <thead>
      <tr><th>#</th><th>Nadir (bpm)</th><th>Recovery (s)</th><th>Area (bpm·s)</th><th>Conf.</th><th>Quality</th></tr>
    </thead>
    <tbody>${logRows}</tbody>
  </table>

  <div class="disclaimer">
    <strong>RESEARCH PROTOTYPE — Not a medical device.</strong>
    This report summarizes a labor session recorded by a research prototype validated
    retrospectively on 552 intrapartum CTG recordings (CTU-UHB, PhysioNet).
    No prospective clinical validation has been performed. This document does not
    constitute a diagnosis and must not replace clinical monitoring. If you have
    concerns, contact your healthcare provider.
  </div>
</body>
</html>`;
}

/**
 * React-Native entry point. Thin wrapper over expo-print. Callers must
 * be running in an Expo runtime; tests should import `buildSessionHtml`
 * directly instead of this function.
 */
export async function exportSessionPdf(
  session: LaborSession,
  opts: PdfExportOptions = {},
): Promise<{ uri: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Print = require('expo-print') as typeof import('expo-print');
  const html = buildSessionHtml(session, opts);
  const result = await Print.printToFileAsync({ html });
  return { uri: result.uri };
}
