import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Battery, Bell, RefreshCw, Server, Smartphone, Wifi, MessageSquare, Activity } from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import { getActiveServerProfile } from '@/services/serverProfileManager';
import { getLastBackendRequestMeta } from '@/services/backendConnector';
import type { ServerProfile } from '@/types/backend';

export default function DiagnosticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, deviceState, runDiagnostics, triggerSync, scanSmsNow } = useAgent();
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [activeProfile, setActiveProfile] = useState<ServerProfile | null>(null);
  const [lastMeta, setLastMeta] = useState<ReturnType<typeof getLastBackendRequestMeta>>(null);
  const d = state.diagnostics;

  useFocusEffect(
    useCallback(() => {
      runDiagnostics();
      (async () => {
        setActiveProfile(await getActiveServerProfile());
        setLastMeta(getLastBackendRequestMeta());
      })();
    }, [runDiagnostics])
  );

  useFocusEffect(
    useCallback(() => {
      runDiagnostics();
    }, [runDiagnostics])
  );

  const handleTestSync = async () => {
    setSyncing(true);
    try {
      await triggerSync();
    } finally {
      setSyncing(false);
    }
  };

  const handleTestScan = async () => {
    setScanning(true);
    try {
      await scanSmsNow();
    } finally {
      setScanning(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setTesting(true);
    try {
      await runDiagnostics();
    } finally {
      setTesting(false);
    }
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <ScrollView className="flex-1 px-5" contentInsetAdjustmentBehavior="automatic">
        <View className="flex-row items-center py-6 gap-3">
          <Pressable onPress={() => router.back()} className="p-2 border border-border rounded-full active:opacity-70">
            <ArrowRight size={20} color="#374151" />
          </Pressable>
          <Text className="text-xl font-bold text-foreground">تشخيص الوكيل</Text>
        </View>

        <View className="mb-6 px-4 py-5 border border-border rounded-2xl bg-card gap-4">
          <Text className="text-sm font-semibold text-foreground">حالة النظام</Text>
          <StatusRow
            icon={Activity}
            label="حالة الوكيل"
            value={d.agentRunning ? 'يعمل' : 'متوقف'}
            active={d.agentRunning}
          />
          <StatusRow
            icon={Wifi}
            label="الشبكة"
            value={d.network === 'ONLINE' ? 'متصل' : 'غير متصل'}
            active={d.network === 'ONLINE'}
          />
          <StatusRow
            icon={MessageSquare}
            label="قراءة SMS"
            value={d.smsReady ? 'جاهز' : 'لا يوجد إذن'}
            active={d.smsReady}
          />
          <StatusRow
            icon={Bell}
            label="الإشعارات"
            value={d.notifications ? 'مفعلة' : 'معطلة'}
            active={d.notifications}
          />
          <StatusRow
            icon={Server}
            label="المزامنة في الخلفية"
            value={d.backgroundAgent ? 'مسجلة' : 'غير مسجلة'}
            active={d.backgroundAgent}
          />
          <StatusRow
            icon={Smartphone}
            label="تسجيل الجهاز"
            value={d.deviceRegistered ? 'مسجل' : 'غير مسجل'}
            active={d.deviceRegistered}
          />
          <StatusRow
            icon={Battery}
            label="تحسين البطارية"
            value={d.batteryOptimization === 'restricted' ? 'مقيد' : 'غير معروف'}
            active={d.batteryOptimization !== 'restricted'}
          />
        </View>

        <View className="mb-6 px-4 py-5 border border-border rounded-2xl bg-card gap-4">
          <Text className="text-sm font-semibold text-foreground">البيانات والمزامنة</Text>
          <InfoRow label="قيد المزامنة" value={String(d.pendingSyncCount)} />
          <InfoRow label="طلبات نشطة" value={String(d.activeOrders)} />
          <InfoRow label="آخر رسالة SMS" value={d.lastSmsAt ? formatTime(d.lastSmsAt) : '—'} />
          <InfoRow label="آخر مسح" value={d.lastScanAt ? formatTime(d.lastScanAt) : '—'} />
          <InfoRow label="آخر مزامنة" value={state.lastSyncAt ? formatTime(state.lastSyncAt) : '—'} />
          {d.lastError && <Text className="text-xs text-destructive">{d.lastError}</Text>}
        </View>

        <View className="mb-6 px-4 py-5 border border-border rounded-2xl bg-card gap-4">
          <Text className="text-sm font-semibold text-foreground">Backend</Text>
          <InfoRow label="Active Server" value={d.activeServerProfile || '—'} />
          <InfoRow label="Base URL" value={activeProfile?.baseUrl || '—'} />
          <InfoRow label="Realtime" value={d.realtimeStatus === 'polling' ? 'Polling' : activeProfile?.apiContract?.realtime?.type || '—'} />
          <InfoRow label="Auth Type" value={activeProfile?.apiContract?.auth?.type || activeProfile?.authType || '—'} />
          <InfoRow label="Backend Status" value={d.backendStatus === 'online' ? 'Online' : d.backendStatus === 'error' ? 'Error' : 'Unknown'} />
          {lastMeta && (
            <>
              <InfoRow label="Last Method" value={d.lastBackendMethod || '—'} />
              <InfoRow label="Last Endpoint" value={d.lastBackendEndpoint || '—'} />
              <InfoRow label="Last Status" value={d.lastBackendStatus ? String(d.lastBackendStatus) : '—'} />
              <InfoRow label="Request ID" value={d.lastBackendRequestId || '—'} />
              {d.lastBackendError && <InfoRow label="Error" value={d.lastBackendError} />}
              {d.lastBackendResponse && (
                <Text className="text-xs text-muted-foreground" numberOfLines={6}>
                  {d.lastBackendResponse}
                </Text>
              )}
            </>
          )}
        </View>

        <View className="gap-3 mb-8">
          <ActionButton
            label="تحديث التشخيص"
            onPress={handleRunDiagnostics}
            loading={testing}
            icon={RefreshCw}
          />
          <ActionButton
            label="اختبار المزامنة"
            onPress={handleTestSync}
            loading={syncing}
            icon={Server}
          />
          <ActionButton
            label="اختبار مسح SMS"
            onPress={handleTestScan}
            loading={scanning}
            icon={MessageSquare}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
  active,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between">
      <View className="flex-row items-center gap-3">
        <Icon size={18} color={active ? '#22c55e' : '#ef4444'} />
        <Text className="text-sm text-foreground">{label}</Text>
      </View>
      <Text className="text-sm font-medium" style={{ color: active ? '#22c55e' : '#ef4444' }}>
        {value}
      </Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  loading,
  icon: Icon,
}: {
  label: string;
  onPress: () => void;
  loading: boolean;
  icon: React.ElementType;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      className="flex-row items-center justify-center gap-2 py-3.5 rounded-2xl border border-border active:opacity-70"
    >
      {loading ? <ActivityIndicator size="small" className="text-muted-foreground" /> : <Icon size={18} color="#6b7280" />}
      <Text className="text-sm font-medium text-foreground">{label}</Text>
    </Pressable>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
