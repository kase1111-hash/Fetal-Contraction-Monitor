/**
 * Equivalence report — renders an EquivalenceSummary as a self-contained
 * HTML document with inline SVG Bland-Altman and confusion-matrix visuals.
 *
 * Follows the same pattern as `src/export/pdf.ts`: a pure `buildEquivalenceHtml`
 * that is unit-testable, plus a thin `exportEquivalencePdf` wrapper that
 * calls expo-print at runtime.
 *
 * The output is designed to be the kind of thing you'd hand to a reviewer
 * during a consumer-vs-clinical equivalence study: every number it claims
 * is computed in-app and auditable from the CSV exports.
 */

import type { AlignedPoint } from './align';
import type { EquivalenceSummary } from './equivalence';
import type { AlertStatus } from '../types';

export interface EquivalenceReportOptions {
  /** Label for the A-side recording. Defaults to "Consumer Doppler". */
  labelA?: string;
  /** Label for the B-side recording. Defaults to "Clinical CTG". */
  labelB?: string;
  /** ISO date for the report header. Defaults to today. */
  dateIso?: string;
}

function f2(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}
function pct(n: number): string {
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—';
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATUSES: AlertStatus[] = ['grey', 'green', 'yellow', 'red'];
const STATUS_COLORS: Record<AlertStatus, string> = {
  green: '#27ae60',
  yellow: '#d4a017',
  red: '#c0392b',
  grey: '#7f8c8d',
};

/**
 * Bland-Altman plot as inline SVG. X-axis: (A+B)/2. Y-axis: (A-B).
 * Lines at bias and ±1.96·sd limits.
 */
function blandAltmanSvg(
  aligned: readonly AlignedPoint[],
  bias: number,
  sd: number,
  width = 520,
  height = 220,
): string {
  const pad = 30;
  const w = width - 2 * pad;
  const h = height - 2 * pad;

  if (aligned.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fcfcfa" stroke="#d0d0d0"/></svg>`;
  }

  const means = aligned.map((p) => (p.fhrA + p.fhrB) / 2);
  const diffs = aligned.map((p) => p.fhrA - p.fhrB);
  const xMin = Math.min(...means);
  const xMax = Math.max(...means);
  const rangeAbs = Math.max(Math.abs(bias - 1.96 * sd), Math.abs(bias + 1.96 * sd), 5);
  const yMin = -rangeAbs * 1.2;
  const yMax = rangeAbs * 1.2;

  const xS = (x: number) => pad + ((x - xMin) / Math.max(1e-6, xMax - xMin)) * w;
  const yS = (y: number) => pad + h - ((y - yMin) / (yMax - yMin)) * h;

  const points = aligned
    .map((_, i) => `<circle cx="${xS(means[i]!)}" cy="${yS(diffs[i]!)}" r="2" fill="#333" opacity="0.5"/>`)
    .join('');

  const refLines = [
    { y: bias, color: '#3a5bff', label: `bias ${f2(bias)}` },
    { y: bias + 1.96 * sd, color: '#c0392b', label: `+1.96·sd ${f2(bias + 1.96 * sd)}` },
    { y: bias - 1.96 * sd, color: '#c0392b', label: `−1.96·sd ${f2(bias - 1.96 * sd)}` },
  ]
    .map(
      (l) => `
      <line x1="${pad}" y1="${yS(l.y)}" x2="${pad + w}" y2="${yS(l.y)}" stroke="${l.color}" stroke-width="1" stroke-dasharray="4,3"/>
      <text x="${pad + w - 4}" y="${yS(l.y) - 4}" font-size="9" fill="${l.color}" text-anchor="end">${l.label}</text>`,
    )
    .join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#fcfcfa" stroke="#d0d0d0"/>
      <line x1="${pad}" y1="${yS(0)}" x2="${pad + w}" y2="${yS(0)}" stroke="#999" stroke-width="1"/>
      ${refLines}
      ${points}
      <text x="${pad}" y="${pad - 8}" font-size="10" fill="#555">diff (A − B, bpm)</text>
      <text x="${pad + w - 4}" y="${pad + h + 16}" font-size="10" fill="#555" text-anchor="end">mean(A, B) bpm</text>
    </svg>
  `;
}

function confusionTable(confusion: EquivalenceSummary['status']['confusion']): string {
  const rows = STATUSES.map((a) => {
    const cells = STATUSES.map((b) => {
      const v = confusion[a][b];
      const onDiag = a === b;
      return `<td style="text-align:right; background:${onDiag ? '#eaf6ee' : 'transparent'}">${v}</td>`;
    }).join('');
    return `<tr><th style="text-align:left; color:${STATUS_COLORS[a]}">${a.toUpperCase()}</th>${cells}</tr>`;
  }).join('');

  const headerCells = STATUSES.map(
    (b) => `<th style="color:${STATUS_COLORS[b]}">${b.toUpperCase()}</th>`,
  ).join('');

  return `
    <table style="border-collapse:collapse;margin-top:6px;font-size:10pt">
      <thead><tr><th></th>${headerCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="font-size:9pt;color:#666;margin-top:4px">rows = consumer (A) · columns = clinical (B) · diagonal = agreement</div>
  `;
}

export function buildEquivalenceHtml(
  aligned: readonly AlignedPoint[],
  summary: EquivalenceSummary,
  opts: EquivalenceReportOptions = {},
): string {
  const labelA = escapeHtml(opts.labelA ?? 'Consumer Doppler');
  const labelB = escapeHtml(opts.labelB ?? 'Clinical CTG');
  const date = escapeHtml(opts.dateIso ?? new Date().toISOString().slice(0, 10));

  const featureRows = summary.features.byFeature
    .map(
      (f) => `
      <tr>
        <td>${f.feature}</td>
        <td>${f.n}</td>
        <td>${f2(f.bias)}</td>
        <td>${f2(f.meanAbsDiff)}</td>
        <td>${pct(f.meanPctDiff)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Equivalence report — ${labelA} vs ${labelB}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    body { font-family: -apple-system, 'Segoe UI', sans-serif; color: #222; font-size: 11pt; }
    h1 { margin: 0 0 4px 0; font-size: 18pt; }
    h2 { margin-top: 22px; font-size: 13pt; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    .meta { color: #666; font-size: 10pt; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 10px; }
    .stat { border: 1px solid #e0e0e0; padding: 8px 10px; border-radius: 6px; }
    .stat-label { font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 14pt; font-weight: 600; color: #222; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10pt; }
    th, td { border-bottom: 1px solid #eee; padding: 4px 6px; text-align: left; }
    th { background: #f7f7f5; font-weight: 600; color: #555; }
    .disclaimer {
      margin-top: 24px; padding: 10px;
      border-left: 3px solid #999; background: #f6f6f4;
      font-size: 9pt; color: #555;
    }
  </style>
</head>
<body>
  <h1>Equivalence report</h1>
  <div class="meta">${date} · A = ${labelA} · B = ${labelB}</div>

  <h2>Counts</h2>
  <div class="grid">
    <div class="stat"><div class="stat-label">N aligned FHR</div><div class="stat-value">${summary.fhr.n}</div></div>
    <div class="stat"><div class="stat-label">Contractions A</div><div class="stat-value">${summary.counts.nA}</div></div>
    <div class="stat"><div class="stat-label">Contractions B</div><div class="stat-value">${summary.counts.nB}</div></div>
    <div class="stat"><div class="stat-label">Matched pairs</div><div class="stat-value">${summary.counts.matched}</div></div>
  </div>

  <h2>Sample-level FHR agreement (Bland-Altman)</h2>
  <div class="grid">
    <div class="stat"><div class="stat-label">Bias (A − B)</div><div class="stat-value">${f2(summary.fhr.bias)} bpm</div></div>
    <div class="stat"><div class="stat-label">SD of diff</div><div class="stat-value">${f2(summary.fhr.sd)} bpm</div></div>
    <div class="stat"><div class="stat-label">RMSE</div><div class="stat-value">${f2(summary.fhr.rmse)} bpm</div></div>
    <div class="stat"><div class="stat-label">Pearson r</div><div class="stat-value">${f2(summary.fhr.pearsonR)}</div></div>
  </div>
  <div style="margin-top:6px;font-size:10pt;color:#555">
    95% limits of agreement: [${f2(summary.fhr.loaLow)}, ${f2(summary.fhr.loaHigh)}] bpm
  </div>
  ${blandAltmanSvg(aligned, summary.fhr.bias, summary.fhr.sd)}

  <h2>Per-contraction feature agreement</h2>
  <table>
    <thead><tr><th>Feature</th><th>N</th><th>Bias (A − B)</th><th>Mean |Δ|</th><th>Mean %|Δ|</th></tr></thead>
    <tbody>${featureRows}</tbody>
  </table>

  <h2>Alert-status concordance</h2>
  <div class="grid">
    <div class="stat"><div class="stat-label">Accuracy</div><div class="stat-value">${pct(summary.status.accuracy)}</div></div>
    <div class="stat"><div class="stat-label">Cohen's κ</div><div class="stat-value">${f2(summary.status.kappa)}</div></div>
    <div class="stat"><div class="stat-label">N paired</div><div class="stat-value">${summary.status.n}</div></div>
  </div>
  ${confusionTable(summary.status.confusion)}

  <div class="disclaimer">
    <strong>Research output — not a validation of clinical use.</strong>
    This report compares two recordings of the same labor produced by
    different sensors. Equivalence on the numeric metrics here does not
    imply clinical equivalence or regulatory acceptability. See
    docs/SAFETY.md and docs/SCIENCE.md.
  </div>
</body>
</html>`;
}

/**
 * Runtime entry point — wraps buildEquivalenceHtml in expo-print.
 * Tests import buildEquivalenceHtml directly.
 */
export async function exportEquivalencePdf(
  aligned: readonly AlignedPoint[],
  summary: EquivalenceSummary,
  opts: EquivalenceReportOptions = {},
): Promise<{ uri: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Print = require('expo-print') as typeof import('expo-print');
  const html = buildEquivalenceHtml(aligned, summary, opts);
  const r = await Print.printToFileAsync({ html });
  return { uri: r.uri };
}
