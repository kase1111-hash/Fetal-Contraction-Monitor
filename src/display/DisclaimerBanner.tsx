/**
 * DisclaimerBanner — persistent 24 px banner at the top of every screen.
 * Reference: SPEC.md §6.6.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function DisclaimerBanner(): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable onPress={() => setExpanded((e) => !e)} style={styles.banner}>
      <Text style={styles.short}>RESEARCH PROTOTYPE — Not a medical device</Text>
      {expanded && (
        <View style={styles.expanded}>
          <Text style={styles.long}>
            This app has been validated retrospectively on one database (CTU-UHB,
            552 recordings). No prospective clinical validation has been performed.
            Do not use it to make medical decisions. If you have concerns about
            your pregnancy, contact your healthcare provider immediately.
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#15151c',
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  short: {
    color: '#9a9aa6',
    fontSize: 11,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  expanded: {
    paddingTop: 8,
  },
  long: {
    color: '#cfcfd4',
    fontSize: 12,
    lineHeight: 16,
  },
});
