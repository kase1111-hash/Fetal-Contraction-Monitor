/**
 * Root layout: wraps every screen in SessionProvider + DisclaimerBanner.
 */

import React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { SessionProvider } from '../src/state/session-context';
import { DisclaimerBanner } from '../src/display/DisclaimerBanner';
import { asyncStorageKv } from '../src/storage/async-storage-kv';

export default function RootLayout(): React.ReactElement {
  return (
    <SessionProvider kv={asyncStorageKv}>
      <SafeAreaView style={styles.root}>
        <DisclaimerBanner />
        <View style={styles.content}>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: '#0a0a0f' },
              headerTintColor: '#cfcfd4',
              contentStyle: { backgroundColor: '#0a0a0f' },
            }}
          />
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { flex: 1 },
});
