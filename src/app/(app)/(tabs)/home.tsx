import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell,
  CircleCheck,
  CircleX,
  Clock,
  MessageSquareWarning,
  RefreshCw,
  Server,
  ShieldAlert,
  Smartphone,
  Activity,
  Globe,
  Radio,
  Settings,
  Play,
} from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import { getUnreadNotificationCount, markNotificationsAsRead } from '@/services/notifications';

export default function HomeScreen() {
  const router = useRouter();
  const { state, deviceState, refreshOrders, runDiagnostics, triggerSync, scanSmsNow, setEnabled } = useAgent();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifMarked, setNotifMarked] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshOrders();
      runDiagnostics();
    }, [refreshOrders, runDiagnostics])
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setUnread(getUnreadNotificationCount());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshOrders();
      await runDiagnostics();
    } finally {
      setRefreshing(false);
    }
  }, [refreshOrders, runDiagnostics]);

  const handleBellPress = () => {
    markNotificationsAsRead();
    setUnread(0);
    setNotifMarked(true);
  };

  const isReady = Boolean(deviceState.deviceId && state.isReady && state.diagnostics.activeServerProfile);
  const statusInfo = getStatusInfo(
    state.connectionStatus,
    isReady,
    state.lastError,
    state.diagnostics.backendStatus
  );

  const agentEnabled = state.diagnostics.agentRunning;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <ScrollView
        className="flex-1 px-5"
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between py-6">
          <View className="gap-1">
            <View className="flex-row items-center gap-2">
              <View className="w-8 h-8 rounded-xl bg-primary items-center justify-center">
                <Activity size={18} color="#ffffff" />
              </View>
              <Text className="text-2xl font-bold text-foreground tracking-tight">Nader Pay Agent</Text>
            </View>
            <Text className="text-sm text-muted-foreground">وكيل التحقق الآلي للمدفوعات</Text>
          </View>
          <View className="flex-row gap-2">
            <Pressable
              onPress={handleBellPress}
              className="relative w-10 h-10 items-center justify-center border border-border rounded-full active:opacity-70"
            >
              <Bell size={20} color="#6b7280" />
              {unread > 0 && (
                <View className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-destructive items-center justify-center px-1">
                  <Text className="text-[10px] font-bold text-primary-foreground">{unread > 99 ? '99+' : unread}</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={() => router.push('/(app)/settings' as any)}
              className="w-10 h-10 items-center justify-center border border-border rounded-full active:opacity-70"
            >
              <Settings size={20} color="#6b7280" />
            </Pressable>
          </View>
        </View>

        {notifMarked && (
          <View className="mb-4 px-4 py-3 border border-primary/20 rounded-2xl bg-primary/5">
            <Text className="text-sm text-primary">تم تحديد الإشعارات كمقروءة</Text>
          </View>
        )}

        {/* Status card */}
        <View className="px-5 py-5 border border-border rounded-2xl bg-card mb-6 gap-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <View className="w-3 h-3 rounded-full" style={{ backgroundColor: statusInfo.color }} />
              <Text className="text-base font-semibold text-foreground">{statusInfo.label}</Text>
            </View>
            {state.isPolling && <ActivityIndicator size="small" className="text-muted-foreground" />}
          </View>

          <View className="flex-row flex-wrap gap-3">
            <MiniStatus icon={Globe} label="Backend" active={state.diagnostics.backendStatus === 'online'} />
            <MiniStatus icon={Radio} label="Realtime" value={state.diagnostics.realtimeStatus === 'connected' ? 'متصل' : 'Polling'} active={state.diagnostics.realtimeStatus === 'connected'} />
            <MiniStatus icon={Smartphone} label="SMS" active={state.diagnostics.smsReady} />
            <MiniStatus icon={Bell} label="إشعارات" active={state.diagnostics.notifications} />
          </View>

          {state.lastError ? (
            <View className="px-3 py-2 rounded-lg bg-destructive/10">
              <Text className="text-xs text-destructive" numberOfLines={2}>
                {state.lastError}
              </Text>
            </View>
          ) : (
            <Text className="text-xs text-muted-foreground">
              آخر تحديث: {state.lastPollAt ? formatTime(state.lastPollAt) : '—'}
            </Text>
          )}
        </View>

        {/* Stats */}
        <View className="mb-2">
          <Text className="text-base font-semibold text-foreground mb-3">إحصائيات الطلبات</Text>
        </View>
        <View className="flex-row flex-wrap gap-3 mb-6">
          <StatCard icon={Clock} label="نشط" value={state.stats.active} color="#3b82f6" />
          <StatCard icon={CircleCheck} label="مؤكد" value={state.stats.confirmed} color="#22c55e" />
          <StatCard icon={CircleX} label="مرفوض" value={state.stats.rejected} color="#ef4444" />
          <StatCard icon={MessageSquareWarning} label="مراجعة" value={state.stats.review} color="#f59e0b" />
          <StatCard icon={Server} label="إجمالي" value={state.stats.total} color="#6b7280" />
          <StatCard icon={ShieldAlert} label="معلّق" value={state.stats.syncPending} color="#8b5cf6" />
        </View>

        {/* Service controls */}
        <View className="mb-6 px-5 py-5 border border-border rounded-2xl bg-card gap-4">
          <Text className="text-sm font-semibold text-foreground">خدمات الوكيل</Text>
          <View className="flex-row gap-3">
            <Pressable
              onPress={async () => {
                if (!agentEnabled) {
                  await setEnabled(true);
                } else {
                  await triggerSync();
                }
              }}
              className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl bg-primary active:opacity-70"
            >
              <Play size={18} color="#ffffff" />
              <Text className="text-sm font-semibold text-primary-foreground">
                {agentEnabled ? 'مزامنة الآن' : 'تشغيل الوكيل'}
              </Text>
            </Pressable>
            <Pressable
              onPress={scanSmsNow}
              className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border border-border active:opacity-70"
            >
              <Smartphone size={18} color="#6b7280" />
              <Text className="text-sm font-semibold text-foreground">مسح SMS</Text>
            </Pressable>
          </View>
          <View className="flex-row gap-3">
            <Pressable
              onPress={onRefresh}
              className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border border-border active:opacity-70"
            >
              <RefreshCw size={18} color="#6b7280" />
              <Text className="text-sm font-semibold text-muted-foreground">تحديث الحالة</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/(app)/diagnostics' as any)}
              className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border border-border active:opacity-70"
            >
              <Activity size={18} color="#6b7280" />
              <Text className="text-sm font-semibold text-muted-foreground">تشخيص مفصّل</Text>
            </Pressable>
          </View>
        </View>

        {/* Recent matches */}
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
    <View className="flex-1 min-w-[30%] px-4 py-4 border border-border rounded-2xl bg-card items-center gap-2">
      <Icon size={20} color={color} />
      <Text className="text-xl font-bold text-foreground">{value}</Text>
      <Text className="text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}

function MiniStatus({
  icon: Icon,
  label,
  value,
  active,
}: {
  icon: React.ElementType;
  label: string;
  value?: string;
  active: boolean;
}) {
  return (
    <View className="flex-row items-center gap-2 px-3 py-2 rounded-xl bg-muted">
      <Icon size={16} color={active ? '#22c55e' : '#ef4444'} />
      <View>
        <Text className="text-[10px] text-muted-foreground">{label}</Text>
        <Text className="text-xs font-medium text-foreground">{value ?? (active ? 'يعمل' : 'متوقف')}</Text>
      </View>
    </View>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
