import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Server, RefreshCw, Wifi, WifiOff, Clock, AlertCircle, CheckCircle } from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';

export default function ServersScreen() {
  const insets = useSafeAreaInsets();
  const { settings, state, refreshOrders } = useAgent();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // لا شيء إضافي — البيانات تأتي من AgentContext
    }, [])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshOrders();
    } finally {
      setRefreshing(false);
    }
  };

  const status = state.connectionStatus;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />

      {/* Header */}
      <View className="px-5 pt-4 pb-3 border-b border-border flex-row items-center justify-between">
        <View className="gap-0.5">
          <Text className="text-2xl font-bold text-foreground">الخوادم</Text>
          <Text className="text-xs text-muted-foreground">حالة الاتصال والمزامنة</Text>
        </View>
        <Pressable
          className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl border border-border active:opacity-70"
          onPress={handleRefresh}
          disabled={refreshing}
        >
          {refreshing
            ? <ActivityIndicator size="small" color="#6b7280" />
            : <RefreshCw size={16} color="#374151" />
          }
          <Text className="text-xs font-medium text-foreground">تحديث</Text>
        </Pressable>
      </View>

      <ScrollView className="flex-1 px-5" contentInsetAdjustmentBehavior="automatic">
        {/* حالة الاتصال */}
        <View className="mt-5 border border-border rounded-2xl bg-card p-4 gap-3">
          <View className="flex-row items-center gap-3">
            {status === 'ONLINE' ? <Wifi size={20} color="#166534" /> : <WifiOff size={20} color="#9ca3af" />}
            <Text className="text-sm font-semibold text-foreground">حالة الاتصال</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: statusColor(status) }} />
            <Text className="text-sm text-foreground">{statusLabel(status)}</Text>
          </View>
          {state.lastError ? (
            <View className="flex-row items-start gap-2">
              <AlertCircle size={14} color="#dc2626" />
              <Text className="text-xs text-destructive flex-1">{state.lastError}</Text>
            </View>
          ) : null}
        </View>

        {/* تفاصيل الخادم */}
        <View className="mt-4 border border-border rounded-2xl bg-card p-4 gap-3">
          <View className="flex-row items-center gap-3">
            <Server size={20} color="#6b7280" />
            <Text className="text-sm font-semibold text-foreground">خادم Nader AI</Text>
          </View>
          <ServerInfoRow label="Supabase URL" value={settings.supabaseUrl} />
          <ServerInfoRow label="فترة التحديث" value={`${settings.pollingIntervalMs / 1000} ثانية`} />
          <ServerInfoRow label="نافذة البحث" value={`${settings.maxSearchWindowHours} ساعة`} />
          <ServerInfoRow label="أقصى محاولات" value={String(settings.retryMaxAttempts)} />
        </View>

        {/* إحصائيات المزامنة */}
        <View className="mt-4 border border-border rounded-2xl bg-card p-4 gap-3">
          <View className="flex-row items-center gap-3">
            <CheckCircle size={20} color="#6b7280" />
            <Text className="text-sm font-semibold text-foreground">المزامنة</Text>
          </View>
          <View className="flex-row gap-3">
            <SyncCard label="معلّق" value={state.pendingSyncCount} color="#854d0e" />
            <SyncCard label="مؤكّد" value={state.stats.confirmed} color="#166534" />
            <SyncCard label="مرفوض" value={state.stats.rejected} color="#991b1b" />
          </View>
          <View className="flex-row items-center gap-2">
            <Clock size={14} color="#9ca3af" />
            <Text className="text-xs text-muted-foreground">
              آخر تحديث: {state.lastPollAt ? formatTime(state.lastPollAt) : '—'}
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            <Clock size={14} color="#9ca3af" />
            <Text className="text-xs text-muted-foreground">
              آخر مزامنة: {state.lastSyncAt ? formatTime(state.lastSyncAt) : '—'}
            </Text>
          </View>
        </View>

        {/* إحصائيات الطلبات */}
        <View className="mt-4 mb-8 border border-border rounded-2xl bg-card p-4 gap-3">
          <Text className="text-sm font-semibold text-foreground">الطلبات</Text>
          <View className="flex-row flex-wrap gap-3">
            <StatBadge label="نشط" value={state.stats.active} />
            <StatBadge label="انتظار" value={state.stats.waiting} />
            <StatBadge label="مؤكّد" value={state.stats.confirmed} />
            <StatBadge label="مرفوض" value={state.stats.rejected} />
            <StatBadge label="الإجمالي" value={state.stats.total} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function ServerInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-2">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="text-xs font-medium text-foreground flex-shrink" numberOfLines={1}>{value}</Text>
    </View>
  );
}

function SyncCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View className="flex-1 px-3 py-2 rounded-xl border border-border bg-background">
      <Text className="text-lg font-bold" style={{ color }}>{value}</Text>
      <Text className="text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}

function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <View className="px-3 py-1.5 rounded-full bg-muted">
      <Text className="text-xs text-muted-foreground">{label}: <Text className="font-semibold text-foreground">{value}</Text></Text>
    </View>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case 'ONLINE': return '#22c55e';
    case 'OFFLINE': return '#ef4444';
    case 'CONNECTING':
    case 'SYNCING': return '#3b82f6';
    case 'ERROR': return '#ef4444';
    default: return '#6b7280';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ONLINE': return 'متصل';
    case 'OFFLINE': return 'غير متصل';
    case 'CONNECTING': return 'جاري الاتصال';
    case 'SYNCING': return 'جاري المزامنة';
    case 'ERROR': return 'خطأ في الاتصال';
    default: return '—';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
