/**
 * Study screen — consumer-vs-clinical equivalence workflow.
 *
 * Phase 4 infrastructure. Three things live here:
 *   1. Import a clinical CTG CSV (paste text, parse via importCtgCsv).
 *   2. Inspect capture status — how many samples in each stream.
 *   3. Generate an equivalence report: alignStreams → equivalenceSummary
 *      → exportEquivalencePdf (or Share as HTML fallback).
 *
 * The screen requires study mode to be on (toggled from Settings). If
 * it's off, the screen explains how to enable it.
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack } from 'expo-router';

import { useSession } from '../src/state/session-context';
import {
  CtgParseError,
  importCtgCsv,
} from '../src/study/import-ctg';
import { alignStreams } from '../src/study/align';
import {
  equivalenceSummary,
  extractResponsesFromStream,
} from '../src/study/equivalence';
import {
  buildEquivalenceHtml,
  exportEquivalencePdf,
} from '../src/study/report';
import type { FHRSample } from '../src/types';

export default function StudyScreen(): React.ReactElement {
  const { studyMode, studyRecorder, session } = useSession();
  const [csvText, setCsvText] = useState('');
  const [clinical, setClinical] = useState<FHRSample[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<string | null>(null);

  const consumerStream = studyRecorder.stream('consumer-doppler');

  const counts = useMemo(() => {
    return {
      consumerSamples: consumerStream?.samples.length ?? 0,
      consumerDetections: consumerStream?.detections.length ?? 0,
      clinicalSamples: clinical?.length ?? 0,
    };
  }, [consumerStream, clinical]);

  function importClinical(): void {
    if (csvText.trim() === '') {
      setStatus('Paste CTG CSV into the field above first.');
      return;
    }
    try {
      const r = importCtgCsv(csvText);
      setClinical(r.samples);
      studyRecorder.open('clinical-ctg', r.samples[0]?.timestamp ?? Date.now());
      for (const s of r.samples) studyRecorder.sample('clinical-ctg', s);
      setStatus(
        `Imported ${r.samples.length} clinical samples (${r.invalid} out-of-range).`,
      );
    } catch (e) {
      if (e instanceof CtgParseError) {
        setStatus(`Parse error: ${e.message}`);
      } else {
        setStatus('Parse failed.');
      }
    }
  }

  async function generateReport(): Promise<void> {
    if (consumerStream === null || consumerStream.samples.length === 0) {
      setStatus('No consumer samples captured. Turn on study mode and record a session.');
      return;
    }
    if (clinical === null || clinical.length === 0) {
      setStatus('Import a clinical CTG CSV first.');
      return;
    }
    const aligned = alignStreams(consumerStream.samples, clinical, { targetHz: 2 });

    // Re-extract contractions from each stream using the session's detections
    // (which live in studyRecorder). Fall back to the session's responses
    // if the recorder has none.
    const detections =
      consumerStream.detections.length > 0
        ? consumerStream.detections
        : (session?.contractions ?? []).map((c) => ({
            peakTimestamp: c.contractionPeakTime,
            method: c.detectionMethod,
            confidence: c.detectionConfidence,
          }));
    const aResponses = extractResponsesFromStream(detections, consumerStream.samples, 'A');
    const bResponses = extractResponsesFromStream(detections, clinical, 'B');
    const summary = equivalenceSummary(aligned.aligned, aResponses, bResponses);

    try {
      const { uri } = await exportEquivalencePdf(aligned.aligned, summary, {
        labelA: 'Consumer Doppler',
        labelB: 'Clinical CTG',
      });
      await Share.share({ url: uri, title: 'equivalence-report.pdf' });
      setLastReport(
        `Report: N aligned=${summary.fhr.n}, matched=${summary.counts.matched}, ` +
          `bias=${summary.fhr.bias.toFixed(2)} bpm, ` +
          `κ=${summary.status.kappa.toFixed(2)}.`,
      );
    } catch {
      // Fallback: share the HTML directly.
      const html = buildEquivalenceHtml(aligned.aligned, summary);
      await Share.share({ message: html, title: 'equivalence-report.html' });
      setLastReport('Shared HTML fallback (PDF generation unavailable).');
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Equivalence study' }} />

      {!studyMode && (
        <View style={styles.warnBox}>
          <Text style={styles.warnTitle}>Study mode is off.</Text>
          <Text style={styles.warnBody}>
            Turn on "Study mode" in Settings to start capturing raw consumer
            Doppler samples. You can still import clinical data here for
            offline comparison.
          </Text>
        </View>
      )}

      <Section title="Capture status">
        <Stat label="Consumer FHR samples" value={String(counts.consumerSamples)} />
        <Stat label="Consumer detections" value={String(counts.consumerDetections)} />
        <Stat label="Clinical samples" value={String(counts.clinicalSamples)} />
      </Section>

      <Section title="Import clinical CTG">
        <Text style={styles.helpText}>
          Paste two-column CSV: timestamp_ms,fhr_bpm (one row per sample).
          Header row and # comments are OK.
        </Text>
        <TextInput
          style={styles.input}
          value={csvText}
          onChangeText={setCsvText}
          multiline
          placeholder={'timestamp_ms,fhr_bpm\n1700000000000,140\n...'}
          placeholderTextColor="#5a5a66"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button label="Parse & import" onPress={importClinical} />
      </Section>

      <Section title="Equivalence report">
        <Text style={styles.helpText}>
          Aligns the two streams to a common 2 Hz grid, computes Bland-Altman
          statistics on the overlap, per-contraction feature agreement, and
          alert-status concordance. Exports as PDF.
        </Text>
        <Button label="Generate report" onPress={() => void generateReport()} />
      </Section>

      {status && <Text style={styles.status}>{status}</Text>}
      {lastReport && <Text style={styles.success}>{lastReport}</Text>}
    </ScrollView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Button({ label, onPress }: { label: string; onPress(): void }): React.ReactElement {
  return (
    <Pressable onPress={onPress} style={styles.btn}>
      <Text style={styles.btnLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { padding: 16 },
  warnBox: {
    borderLeftWidth: 3,
    borderLeftColor: '#f2c94c',
    backgroundColor: '#1a1a0f',
    padding: 10,
    marginBottom: 16,
  },
  warnTitle: { color: '#f2c94c', fontWeight: '600', fontSize: 13 },
  warnBody: { color: '#cfcfd4', fontSize: 12, marginTop: 4, lineHeight: 16 },
  section: { marginBottom: 24 },
  sectionTitle: {
    color: '#9a9aa6',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  helpText: { color: '#9a9aa6', fontSize: 12, lineHeight: 16, marginBottom: 8 },
  stat: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a2e',
  },
  statLabel: { color: '#cfcfd4', fontSize: 13 },
  statValue: {
    color: '#cfcfd4',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#15151c',
    borderColor: '#2a2a3b',
    borderWidth: 1,
    borderRadius: 6,
    color: '#cfcfd4',
    fontSize: 12,
    padding: 8,
    minHeight: 120,
    textAlignVertical: 'top',
    fontFamily: 'Courier',
  },
  btn: {
    marginTop: 8,
    backgroundColor: '#3a5bff',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnLabel: { color: '#fff', fontWeight: '600', letterSpacing: 0.5 },
  status: { color: '#f2c94c', fontSize: 12, marginTop: 6 },
  success: { color: '#3ecf75', fontSize: 12, marginTop: 6 },
});
