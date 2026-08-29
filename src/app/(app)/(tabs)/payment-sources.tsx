import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Smartphone, RefreshCw, CheckCircle2, XCircle, MessageSquare, ShieldCheck, ShieldAlert } from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import { getIndexedSmsStats, getIndexedSmsCount } from '@/services/localSmsIndex';
import type { ProviderName } from '@/types/agent';

const PROVIDERS: { key: ProviderName; label: string; senderExamples: string }[] = [
  { key: 'vodafone_cash', label: 'Vodafone Cash', senderExamples: 'Vodafone Cash, فودافون كاش' },
  { key: 'orange_cash', label: 'Orange Cash', senderExamples: 'Orange Cash, أورانج كاش' },
  { key: 'insta_pay', label: 'InstaPay', senderExamples: 'InstaPay, IPN' },
  { key: 'bank_transfer', label: 'تحويل بنكي', senderExamples: 'رسائل البنك' },
];

export default function PaymentSourcesScreen() {
  const { state, settings, refreshOrders, runDiagnostics } = useAgent();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<Record<ProviderName, { messages: number; lastAt: string | null }>>({
    vodafone_cash: { messages: 0, lastAt: null },
    orange_cash: { messages: 0, lastAt: null },
    insta_pay: { messages: 0, lastAt: null },
    bank_transfer: { messages: 0, lastAt: null },
    unknown: { messages: 0, lastAt: null },
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [rows, total] = await Promise.all([getIndexedSmsStats(), getIndexedSmsCount()]);
    const next: typeof stats = {
      vodafone_cash: { messages: 0, lastAt: null },
      orange_cash: { messages: 0, lastAt: null },
      insta_pay: { messages: 0, lastAt: null },
      bank_transfer: { messages: 0, lastAt: null },
      unknown: { messages: 0, lastAt: null },
    };
    for (const row of rows) {
      const key = row.provider as ProviderName;
      if (key in next) {
        next[key] = { messages: row.count, lastAt: row.lastReceivedAt };
      } else {
        next.unknown.messages += row.count;
        if (row.lastReceivedAt && (!next.unknown.lastAt || row.lastReceivedAt > next.unknown.lastAt)) {
          next.unknown.lastAt = row.lastReceivedAt;
        }
      }
    }
    setStats(next);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      refreshOrders();
      runDiagnostics();
    }, [load, refreshOrders, runDiagnostics])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
      await refreshOrders();
      await runDiagnostics();
    } finally {
      setRefreshing(false);
    }
  }, [load, refreshOrders, runDiagnostics]);

  const orderCounts = useCallback(() => {
    const map: Record<ProviderName, { total: number; confirmed: number; rejected: number; review: number }> = {
      vodafone_cash: { total: 0, confirmed: 0, rejected: 0, review: 0 },
      orange_cash: { total: 0, confirmed: 0, rejected: 0, review: 0 },
      insta_pay: { total: 0, confirmed: 0, rejected: 0, review: 0 },
      bank_transfer: { total: 0, confirmed: 0, rejected: 0, review: 0 },
      unknown: { total: 0, confirmed: 0, rejected: 0, review: 0 },
    };
    for (const o of state.pendingOrders) {
      const key = (o.provider ?? 'unknown') as ProviderName;
      if (!(key in map)) continue;
      map[key].total += 1;
      if (['confirmed', 'confirmed_local'].includes(o.localStatus ?? '')) map[key].confirmed += 1;
      if (['rejected', 'rejected_local', 'expired'].includes(o.localStatus ?? '')) map[key].rejected += 1;
      if (o.localStatus === 'review_required') map[key].review += 1;
    }
    return map;
  }, [state.pendingOrders])();

  const totalMessages = Object.values(stats).reduce((a, b) => a + b.messages, 0);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <ScrollView
        className="flex-1 px-5"
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View className="flex-row items-center justify-between py-6">
          <View className="gap-1">
            <Text className="text-2xl font-bold text-foreground">مصادر الدفع</Text>
            <Text className="text-xs text-muted-foreground">
              {totalMessages} رسالة مفهرسة • {state.pendingOrders.length} طلب
            </Text>
          </View>
          <Pressable
            onPress={onRefresh}
            className="w-10 h-10 items-center justify-center border border-border rounded-full active:opacity-70"
          >
            <RefreshCw size={18} color="#6b7280" />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator className="mt-12" />
        ) : (
          <View className="gap-4 pb-8">
            {PROVIDERS.map((p) => {
              const s = stats[p.key];
              const oc = orderCounts[p.key];
              const enabled = settings.providers[p.key]?.enabled ?? true;
              return (
                <View key={p.key} className="px-4 py-5 border border-border rounded-2xl bg-card gap-3">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-3">
                      <View className="w-10 h-10 rounded-full bg-muted items-center justify-center">
                        <Smartphone size={20} color="#6b7280" />
                      </View>
                      <View>
                        <Text className="text-base font-semibold text-foreground">{p.label}</Text>
                        <Text className="text-xs text-muted-foreground">{p.senderExamples}</Text>
                      </View>
                    </View>
                    <View className="flex-row items-center gap-1">
                      {enabled ? <ShieldCheck size={18} color="#22c55e" /> : <ShieldAlert size={18} color="#ef4444" />}
                      <Text className={`text-xs font-medium ${enabled ? 'text-green-600' : 'text-destructive'}`}>
                        {enabled ? 'مفعل' : 'معطل'}
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row flex-wrap gap-2 pt-2">
                    <MetricBadge icon={MessageSquare} label="رسائل" value={s.messages} />
                    <MetricBadge icon={CheckCircle2} label="مؤكد" value={oc.confirmed} />
                    <MetricBadge icon={XCircle} label="مرفوض" value={oc.rejected} />
                    <MetricBadge icon={ShieldAlert} label="مراجعة" value={oc.review} />
                  </View>

                  <Text className="text-xs text-muted-foreground">
                    آخر رسالة: {s.lastAt ? formatDate(s.lastAt) : '—'}
                  </Text>
                </View>
              );
            })}

            <View className="px-4 py-4 border border-border rounded-2xl bg-muted/30 gap-2">
              <Text className="text-sm font-semibold text-foreground">التحقق من مصدر الرسالة</Text>
              <Text className="text-xs text-muted-foreground leading-5">
                يتم فحص الرسائل المستلمة ومطابقة مصدرها باستخدام قواعد المزود. قم بتفعيل المزودات المستخدمة فقط لتقليل الأخطاء.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function MetricBadge({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <View className="flex-row items-center gap-1 px-2.5 py-1.5 rounded-lg bg-muted">
      <Icon size={14} color="#6b7280" />
      <Text className="text-xs text-foreground">
        {label}: {value}
      </Text>
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
