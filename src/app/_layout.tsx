import * as Sentry from '@sentry/react-native';
import { Stack, useRouter } from 'expo-router';
import { PortalHost } from '@rn-primitives/portal';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, View } from 'react-native';
import { useEffect, useState } from 'react';

import { SessionProvider, useSession } from '@/ctx';
import { AgentProvider } from '@/contexts/AgentContext';
import { checkLatestVersion, runCleanMigration, shouldRunMigration } from '@/services/versionCheck';
import "../global.css";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
});

function VersionGuard({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [updateNeeded, setUpdateNeeded] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    (async () => {
      // تشغيل Clean Migration في البداية
      try {
        if (await shouldRunMigration()) {
          await runCleanMigration();
        }
      } catch {
        // ignore
      }

      // التحقق من الإصدار
      try {
        const info = await checkLatestVersion();
        if (mounted && info?.updateRequired) {
          setUpdateNeeded(true);
          router.replace('/update');
        }
      } catch {
        // فشل الفحص لا يوقف التطبيق
      } finally {
        if (mounted) setChecking(false);
      }
    })();
    return () => { mounted = false; };
  }, [router]);

  if (checking) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#1e3a5f" />
      </View>
    );
  }

  if (updateNeeded) return null;

  return <>{children}</>;
}

function RootLayoutNav() {
  const { session, isLoading } = useSession();

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
      <Stack.Screen name="update" />
    </Stack>
  );
}

const RootLayout: React.FC = () => {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <AgentProvider>
          <VersionGuard>
            <RootLayoutNav />
          </VersionGuard>
          <PortalHost />
        </AgentProvider>
      </SessionProvider>
    </GestureHandlerRootView>
  );
};

export default Sentry.wrap(RootLayout);
