import * as Sentry from '@sentry/react-native';
import { Stack } from 'expo-router';
import { PortalHost } from '@rn-primitives/portal';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, View, Text } from 'react-native';
import { useEffect, useState } from 'react';

import { SessionProvider, useSession } from '@/ctx';
import { AgentProvider } from '@/contexts/AgentContext';
import { runCleanMigration, shouldRunMigration } from '@/services/versionCheck';
import { getRemoteConfig, type RemoteConfig } from '@/services/remoteConfigService';
import "../global.css";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
});

// تشغيل Clean Migration في الخلفية بدون blocking عند أول تشغيل
function useMigrationOnStart() {
  useEffect(() => {
    (async () => {
      try {
        if (await shouldRunMigration()) {
          await runCleanMigration();
        }
      } catch {
        // ignore — لا يوقف التطبيق
      }
    })();
  }, []);
}

function RootLayoutNav() {
  const { session, isLoading } = useSession();
  useMigrationOnStart();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#1e3a5f" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Screen name="update" options={{ headerShown: false }} />
    </Stack>
  );
}

const RootLayout: React.FC = () => {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <AgentProvider>
          <RootLayoutNav />
          <PortalHost />
        </AgentProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
};

export default Sentry.wrap(RootLayout);
