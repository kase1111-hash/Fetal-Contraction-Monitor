import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ContractionLog } from '../../src/display/ContractionLog';
import { useSession } from '../../src/state/session-context';

export default function LogScreen(): React.ReactElement {
  const { session } = useSession();
  const contractions = session?.contractions ?? [];
  return (
    <View style={styles.root}>
      <Text style={styles.title}>
        Contractions ({contractions.length})
      </Text>
      <View style={styles.list}>
        <ContractionLog contractions={contractions} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f', padding: 16 },
  title: { color: '#cfcfd4', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  list: { flex: 1 },
});
