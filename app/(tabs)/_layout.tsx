import React from 'react';
import { Tabs } from 'expo-router';

export default function TabsLayout(): React.ReactElement {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: { backgroundColor: '#0a0a0f', borderTopColor: '#1a1a2e' },
        tabBarActiveTintColor: '#6b8cff',
        tabBarInactiveTintColor: '#5a5a66',
        headerStyle: { backgroundColor: '#0a0a0f' },
        headerTintColor: '#cfcfd4',
      }}
    >
      <Tabs.Screen name="monitor" options={{ title: 'Monitor' }} />
      <Tabs.Screen name="log" options={{ title: 'Log' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
