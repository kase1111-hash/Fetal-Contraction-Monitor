import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ContractionLog } from '../../src/display/ContractionLog';
import { useSession } from '../../src/state/session-context';

export default function LogScreen(): React.ReactElement {
  const { session, deleteContraction } = useSession();
  const contractions = session?.contractions ?? [];
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Contractions ({contractions.length})</Text>
      <Text style={styles.hint}>Tap a row to expand · long-press to delete</Text>
      <View style={styles.list}>
        <ContractionLog contractions={contractions} onDelete={deleteContraction} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f', padding: 16 },
  title: { color: '#cfcfd4', fontSize: 16, fontWeight: '600' },
  hint: { color: '#5a5a66', fontSize: 11, marginTop: 4, marginBottom: 12 },
  list: { flex: 1 },
});
