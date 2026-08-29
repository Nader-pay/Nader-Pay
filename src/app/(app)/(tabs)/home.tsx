import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CircleCheck,
  CircleX,
  Clock,
  RefreshCw,
  Server,
  ShieldAlert,
  Smartphone,
  Wifi,
  Activity,
  Globe,
  Radio,
} from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';

export default function HomeScreen() {
  const { state, deviceState, refreshOrders, runDiagnostics } = useAgent();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshOrders();
      runDiagnostics();
    }, [refreshOrders, runDiagnostics])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshOrders();
      await runDiagnostics();
    } finally {
      setRefreshing(false);
    }
  }, [refreshOrders, runDiagnostics]);

  const isReady = Boolean(deviceState.deviceId && state.isReady && state.diagnostics.activeServerProfile);
  const statusInfo = getStatusInfo(state.connectionStatus, isReady, state.lastError, state.diagnostics.backendStatus);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <ScrollView
        className="flex-1 px-5"
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View className="py-8 gap-2">
          <Text className="text-3xl font-bold text-foreground tracking-tight">Nader Pay Agent</Text>
          <Text className="text-sm text-muted-foreground">وكيل تحقق Vodafone Cash للشحنات</Text>
        </View>

        {/* حالة الاتصال */}
        <View className="flex-row items-center gap-3 px-4 py-4 border border-border rounded-2xl bg-card mb-6">
          <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: statusInfo.color }} />
          <View className="flex-1 min-w-0">
            <Text className="text-sm font-medium text-foreground">{statusInfo.label}</Text>
            {state.lastError ? (
              <Text className="text-xs text-destructive mt-1" numberOfLines={2}>
                {state.lastError}
              </Text>
            ) : (
              <Text className="text-xs text-muted-foreground mt-1">
                آخر تحديث: {state.lastPollAt ? formatTime(state.lastPollAt) : '—'}
              </Text>
            )}
          </View>
          {state.isPolling && <ActivityIndicator size="small" className="text-muted-foreground" />}
        </View>

        {/* الإحصائيات */}
        <View className="flex-row flex-wrap gap-4 mb-6">
          <StatCard icon={Clock} label="نشط" value={state.stats.active} color="#3b82f6" />
          <StatCard icon={CircleCheck} label="مؤكد" value={state.stats.confirmed} color="#22c55e" />
          <StatCard icon={CircleX} label="مرفوض" value={state.stats.rejected} color="#ef4444" />
          <StatCard icon={Server} label="إجمالي" value={state.stats.total} color="#6b7280" />
        </View>

        {/* حالة الخدمات */}
        <View className="flex-row gap-4 mb-6">
          <ServiceCard
            icon={Wifi}
            label="الشبكة"
            value={state.diagnostics.network === 'ONLINE' ? 'متصل' : 'غير متصل'}
            active={state.diagnostics.network === 'ONLINE'}
          />
          <ServiceCard
            icon={Smartphone}
            label="قراءة SMS"
            value={state.diagnostics.smsReady ? 'جاهز' : 'لا يوجد إذن'}
            active={state.diagnostics.smsReady}
          />
        </View>
        <View className="flex-row gap-4 mb-6">
          <ServiceCard
            icon={Server}
            label="المزامنة"
            value={state.pendingSyncCount > 0 ? `${state.pendingSyncCount} معلق` : 'متزامن'}
            active={state.pendingSyncCount === 0}
          />
          <ServiceCard
            icon={Activity}
            label="الوكيل"
            value={state.diagnostics.agentRunning ? 'يعمل' : 'متوقف'}
            active={state.diagnostics.agentRunning}
          />
        </View>
        <View className="flex-row gap-4 mb-6">
          <ServiceCard
            icon={Globe}
            label="Backend"
            value={state.diagnostics.activeServerProfile || 'غير مضبوط'}
            active={state.diagnostics.backendStatus === 'online'}
          />
          <ServiceCard
            icon={Radio}
            label="Realtime"
            value={state.diagnostics.realtimeStatus === 'connected' ? 'متصل' : 'Polling'}
            active={state.diagnostics.realtimeStatus === 'connected'}
          />
        </View>

        {/* الأحداث الأخيرة */}
        <View className="mb-8">
          <Text className="text-base font-semibold text-foreground mb-4">آخر التطابقات</Text>
          {state.recentMatches.length === 0 ? (
            <View className="items-center py-12 gap-3 border border-dashed border-border rounded-2xl">
              <ShieldAlert size={32} color="#9ca3af" />
              <Text className="text-sm text-muted-foreground">لم يتم التعرف على أي دليل دفع بعد</Text>
            </View>
          ) : (
            <View className="gap-3">
              {state.recentMatches.slice(0, 5).map((m, index) => (
                <View
                  key={index}
                  className="px-4 py-4 border border-border rounded-2xl bg-card"
                >
                  <View className="flex-row justify-between items-center mb-2">
                    <Text className="text-sm font-medium text-foreground">
                      {m.order.external_reference}
                    </Text>
                    <Text className="text-xs font-medium" style={{ color: m.confirmed ? '#22c55e' : '#f59e0b' }}>
                      {m.confirmed ? 'مؤكد' : 'مراجعة'}
                    </Text>
                  </View>
                  <Text className="text-xs text-muted-foreground">
                    مبلغ {m.transaction.amount} {m.transaction.currency} — نقاط التطابق: {m.score}
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-1" numberOfLines={2}>
                    {m.reasons.join(' • ')}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <Pressable
          className="flex-row items-center justify-center gap-2 py-3 border border-border rounded-2xl active:opacity-70 mb-8"
          onPress={onRefresh}
        >
          <RefreshCw size={16} color="#6b7280" />
          <Text className="text-sm font-medium text-muted-foreground">تحديث الآن</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function getStatusInfo(
  connection: string,
  isReady: boolean,
  lastError: string | null,
  backendStatus?: 'online' | 'offline' | 'error' | 'unknown'
) {
  if (!isReady) return { label: 'الخادم غير مضبوط', color: '#ef4444' };
  if (backendStatus === 'error') {
    return { label: lastError || 'خطأ في الاتصال بالخادم', color: '#ef4444' };
  }
  switch (connection) {
    case 'ONLINE':
      return { label: 'متصل مع الخادم', color: '#22c55e' };
    case 'OFFLINE':
      return { label: 'غير متصل — وضع عدم الاتصال', color: '#ef4444' };
    case 'CONNECTING':
      return { label: 'جاري الاتصال...', color: '#f59e0b' };
    case 'SYNCING':
      return { label: 'جاري المزامنة...', color: '#3b82f6' };
    case 'ERROR':
      return { label: lastError || 'خطأ في المزامنة', color: '#ef4444' };
    default:
      return { label: '—', color: '#6b7280' };
  }
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View className="flex-1 min-w-[22%] px-4 py-4 border border-border rounded-2xl bg-card items-center gap-2">
      <Icon size={20} color={color} />
      <Text className="text-xl font-bold text-foreground">{value}</Text>
      <Text className="text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}

function ServiceCard({
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
    <View className="flex-1 flex-row items-center gap-3 px-4 py-4 border border-border rounded-2xl bg-card">
      <Icon size={20} color={active ? '#22c55e' : '#ef4444'} />
      <View>
        <Text className="text-xs text-muted-foreground">{label}</Text>
        <Text className="text-sm font-medium text-foreground">{value}</Text>
      </View>
    </View>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
