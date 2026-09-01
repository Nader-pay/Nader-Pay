import { useCallback, useState } from 'react';
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
  BellOff,
  CheckCircle2,
  FlaskConical,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  XCircle,
} from 'lucide-react-native';
import type { RelativePathString } from 'expo-router';
import { getAllNotificationSources, getNotificationListenerState } from '@/services/notificationSourceService';

import { useAgent } from '@/contexts/AgentContext';
import { getIndexedSmsStats, getIndexedSmsCount } from '@/services/localSmsIndex';
import { listProviderSources, type ProviderSource } from '@/services/providerSourceService';
import type { ProviderName } from '@/types/agent';
import type { NotificationSource } from '@/services/notificationSourceService';

const PROVIDERS: {
  key: ProviderName;
  label: string;
  senderExamples: string;
}[] = [
  { key: 'vodafone_cash', label: 'Vodafone Cash', senderExamples: 'Vodafone Cash, فودافون كاش' },
  { key: 'orange_cash', label: 'Orange Cash', senderExamples: 'Orange Cash, أورانج كاش' },
  { key: 'insta_pay', label: 'InstaPay', senderExamples: 'InstaPay, IPN' },
  { key: 'bank_transfer', label: 'تحويل بنكي', senderExamples: 'رسائل البنك' },
];

const statusInfo: Record<string, { label: string; color: string }> = {
  unverified: { label: 'غير موثق', color: '#ef4444' },
  discovering: { label: 'اكتشاف', color: '#f59e0b' },
  selected: { label: 'مختار', color: '#3b82f6' },
  verifying: { label: 'توثيق', color: '#f59e0b' },
  verified: { label: 'موثق', color: '#22c55e' },
  failed: { label: 'فشل', color: '#ef4444' },
};

export default function PaymentSourcesScreen() {
  const { state, settings, refreshOrders, runDiagnostics } = useAgent();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<Record<ProviderName, { messages: number; lastAt: string | null }>>({
    vodafone_cash: { messages: 0, lastAt: null },
    orange_cash: { messages: 0, lastAt: null },
    insta_pay: { messages: 0, lastAt: null },
    bank_transfer: { messages: 0, lastAt: null },
    unknown: { messages: 0, lastAt: null },
  });
  const [sources, setSources] = useState<Record<ProviderName, ProviderSource | null>>({
    vodafone_cash: null,
    orange_cash: null,
    insta_pay: null,
    bank_transfer: null,
    unknown: null,
  });
  const [loading, setLoading] = useState(true);

  // ── Notification Sources state ─────────────────────────────────────────────
  const [notifSources, setNotifSources] = useState<NotificationSource[]>([]);
  const [listenerEnabled, setListenerEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, , providerSources, notifRows, listenerState] = await Promise.all([
        getIndexedSmsStats().catch(() => []),
        getIndexedSmsCount().catch(() => 0),
        listProviderSources().catch(() => []),
        getAllNotificationSources().catch(() => [] as NotificationSource[]),
        getNotificationListenerState().catch(() => 'unknown' as const),
      ]);
      setNotifSources(notifRows);
      setListenerEnabled(listenerState === 'enabled');
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
      const byProvider: typeof sources = {
        vodafone_cash: null,
        orange_cash: null,
        insta_pay: null,
        bank_transfer: null,
        unknown: null,
      };
      for (const src of providerSources) {
        if (src.providerId in byProvider) {
          byProvider[src.providerId as ProviderName] = src;
        }
      }
      setStats(next);
      setSources(byProvider);
    } catch (err) {
      console.warn('[payment-sources] load error:', err);
    } finally {
      setLoading(false);
    }
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
  const activeNotifCount = notifSources.filter(
    (s) => ['verified', 'selected', 'permission_required'].includes(s.status)
  ).length;

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

            {/* ══ بطاقة مصادر الإشعارات المستقلة ══════════════════════════ */}
            <Pressable
              onPress={() => router.push('/(app)/notification-sources' as RelativePathString)}
              className="px-4 py-4 border border-border rounded-2xl bg-card active:opacity-80"
              style={{ borderCurve: 'continuous' } as object}
              android_ripple={{ color: 'rgba(0,0,0,0.05)' }}
            >
              <View className="flex-row items-center gap-3">
                <View
                  className="w-10 h-10 rounded-full items-center justify-center shrink-0"
                  style={{ backgroundColor: activeNotifCount > 0 ? '#f0fdf4' : '#f3f4f6' }}
                >
                  {activeNotifCount > 0
                    ? <Bell size={20} color="#16a34a" />
                    : <BellOff size={20} color="#9ca3af" />}
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className="text-base font-semibold text-foreground">
                    مصادر الإشعارات
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {activeNotifCount > 0
                      ? `${activeNotifCount} تطبيق موثَّق${listenerEnabled ? ' • يستقبل إشعارات' : ' • Listener غير مفعّل'}`
                      : 'لا توجد تطبيقات موثَّقة — اضغط للإضافة'}
                  </Text>
                </View>
                <View className="flex-row items-center gap-1">
                  {listenerEnabled
                    ? <ShieldCheck size={16} color="#22c55e" />
                    : <ShieldAlert size={16} color="#f59e0b" />}
                  <Text className="text-xs font-medium text-muted-foreground">›</Text>
                </View>
              </View>

              {/* شريط التطبيقات الموثَّقة */}
              {activeNotifCount > 0 && (
                <View className="flex-row flex-wrap gap-1.5 mt-3 pl-[52px]">
                  {notifSources
                    .filter((s) => ['verified', 'selected', 'permission_required'].includes(s.status))
                    .slice(0, 4)
                    .map((s) => (
                      <View
                        key={s.id}
                        className="px-2 py-0.5 rounded-full bg-muted"
                      >
                        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                          {s.displayName}
                        </Text>
                      </View>
                    ))}
                  {activeNotifCount > 4 && (
                    <View className="px-2 py-0.5 rounded-full bg-muted">
                      <Text className="text-xs text-muted-foreground">+{activeNotifCount - 4}</Text>
                    </View>
                  )}
                </View>
              )}
            </Pressable>

            {/* ── فاصل ───────────────────────────────────────────────────── */}
            <View className="flex-row items-center gap-2">
              <View className="flex-1 h-px bg-border" />
              <Text className="text-xs text-muted-foreground px-1">مصادر SMS</Text>
              <View className="flex-1 h-px bg-border" />
            </View>

            {/* ══ بطاقات SMS لكل مزود ══════════════════════════════════════ */}
            {PROVIDERS.map((p) => {
              const s = stats[p.key];
              const oc = orderCounts[p.key];
              const source = sources[p.key];
              const status = source?.status ?? 'unverified';
              const info = statusInfo[status] ?? statusInfo.unverified;
              return (
                <View
                  key={p.key}
                  className="px-4 py-5 border border-border rounded-2xl bg-card gap-3"
                  style={{ borderCurve: 'continuous' } as object}
                >
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
                      {source?.verified
                        ? <ShieldCheck size={18} color="#22c55e" />
                        : <ShieldAlert size={18} color="#ef4444" />}
                      <Text className="text-xs font-medium" style={{ color: info.color }}>
                        {info.label}
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

                  <View className="flex-row gap-2 mt-2">
                    <Pressable
                      onPress={() =>
                        router.push(
                          `/(app)/discovery?provider=${encodeURIComponent(p.key)}` as RelativePathString
                        )
                      }
                      className="flex-1 flex-row items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-primary active:opacity-70"
                    >
                      <Search size={15} color="#ffffff" />
                      <Text className="text-xs font-semibold text-primary-foreground">
                        {source?.verified ? 'إعادة التوثيق' : 'اكتشاف المصدر'}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        router.push(
                          `/(app)/test-lab?provider=${encodeURIComponent(p.key)}` as RelativePathString
                        )
                      }
                      className="flex-row items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-border bg-card active:opacity-70"
                    >
                      <FlaskConical size={15} color="#6b7280" />
                      <Text className="text-xs font-medium text-muted-foreground">اختبار</Text>
                    </Pressable>
                  </View>

                  {source?.parserVersion && (
                    <Text className="text-xs text-muted-foreground/60 mt-1">
                      Parser v{source.parserVersion}
                      {source.sourceId ? ` • ${source.sourceId}` : ''}
                    </Text>
                  )}
                </View>
              );
            })}

            <View className="px-4 py-4 border border-border rounded-2xl bg-muted/30 gap-2">
              <Text className="text-sm font-semibold text-foreground">التحقق من مصدر الرسالة</Text>
              <Text className="text-xs text-muted-foreground leading-5">
                لا يتم معالجة رسائل SMS إلا من مصادر موثقة. اضغط "اكتشاف المصدر" لقراءة
                رسائل Android SMS Provider وتحديد المرسِل الصحيح.
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
