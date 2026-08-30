import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Smartphone,
  RefreshCw,
  CheckCircle2,
  XCircle,
  MessageSquare,
  ShieldCheck,
  ShieldAlert,
  Search,
  AlertTriangle,
  Loader,
} from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import { getIndexedSmsStats, getIndexedSmsCount } from '@/services/localSmsIndex';
import {
  listProviderSources,
  upsertProviderSource,
  type ProviderSource,
} from '@/services/providerSourceService';
import { discoverSmsSources, verifySourceWithParser, type SmsSource } from '@/services/sourceDiscovery';
import { createHash } from '@/lib/hash';
import type { ProviderName } from '@/types/agent';

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
  const [discovering, setDiscovering] = useState<ProviderName | null>(null);
  const [discovered, setDiscovered] = useState<SmsSource[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderName | null>(null);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [verifyResultOk, setVerifyResultOk] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [rows, total, providerSources] = await Promise.all([
      getIndexedSmsStats(),
      getIndexedSmsCount(),
      listProviderSources(),
    ]);
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

  const handleDiscover = async (provider: ProviderName) => {
    setVerifyResult(null);
    if (process.env.EXPO_OS === 'web') {
      setVerifyResult('اكتشاف المصادر يتطلب جهاز Android.');
      setVerifyResultOk(false);
      return;
    }
    setDiscovering(provider);
    setSelectedProvider(provider);
    setDiscovered([]);
    try {
      const smsSources = await discoverSmsSources();
      const filtered = smsSources.filter((s) => s.providerHint === provider);
      setDiscovered(filtered);
      if (filtered.length === 0) {
        setVerifyResult(`لا توجد مصادر مطابقة لـ ${PROVIDERS.find((p) => p.key === provider)?.label}.`);
        setVerifyResultOk(false);
      }
    } catch (err) {
      setVerifyResult(err instanceof Error ? err.message : 'فشل الاكتشاف');
      setVerifyResultOk(false);
    } finally {
      setDiscovering(null);
    }
  };

  const handleSelectSource = async (provider: ProviderName, source: SmsSource) => {
    setDiscovering(provider);
    const result = await verifySourceWithParser(source, provider);
    const now = new Date().toISOString();
    const id = createHash(`${provider}:${source.sourceId}`);
    const newSource: ProviderSource = {
      id,
      providerId: provider,
      providerName: PROVIDERS.find((p) => p.key === provider)?.label ?? provider,
      sourceId: source.sourceId,
      sourceType: 'sms',
      sourceMetadata: {
        messageCount: source.messageCount,
        displayName: source.displayName,
        samples: source.rawMessages.map((m) => m.body.slice(0, 120)),
      },
      parserVersion: '1',
      receivingAccount: null,
      approvedSenderIdentifiers: [source.sourceId],
      messagePatterns: [],
      verified: result.passed,
      enabled: result.passed,
      status: result.passed ? 'verified' : 'failed',
      lastMessageAt: source.lastMessageAt,
      lastMessageSummary: source.lastMessageSummary,
      lastVerificationAt: now,
      lastVerificationResult: result.reason,
      createdAt: now,
      updatedAt: now,
    };
    await upsertProviderSource(newSource);
    setDiscovered([]);
    setSelectedProvider(null);
    setDiscovering(null);
    setVerifyResult(result.reason);
    setVerifyResultOk(result.passed);
    await load();
  };

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
              const source = sources[p.key];
              const status = source?.status ?? 'unverified';
              const info = statusInfo[status] ?? statusInfo.unverified;
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
                      {source?.verified ? (
                        <ShieldCheck size={18} color="#22c55e" />
                      ) : (
                        <ShieldAlert size={18} color="#ef4444" />
                      )}
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

                  <Pressable
                    onPress={() => handleDiscover(p.key)}
                    disabled={discovering === p.key}
                    className="mt-2 flex-row items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-primary active:opacity-70"
                  >
                    {discovering === p.key ? (
                      <Loader size={16} className="text-primary-foreground" />
                    ) : (
                      <Search size={16} color="#ffffff" />
                    )}
                    <Text className="text-sm font-semibold text-primary-foreground">
                      {source?.verified ? 'إعادة التوثيق' : 'اكتشاف وتوثيق المصدر'}
                    </Text>
                  </Pressable>
                </View>
              );
            })}

            <View className="px-4 py-4 border border-border rounded-2xl bg-muted/30 gap-2">
              <Text className="text-sm font-semibold text-foreground">التحقق من مصدر الرسالة</Text>
              <Text className="text-xs text-muted-foreground leading-5">
                لا يتم معالجة رسائل SMS إلا من مصادر موثقة في قاعدة البيانات. اضغط "اكتشاف وتوثيق المصدر" لقراءة
                رسائل Android SMS Provider وتحديد المصدر الصحيح.
              </Text>
            </View>

            {verifyResult && (
              <View
                className={`px-4 py-4 border border-border rounded-2xl gap-2 ${
                  verifyResultOk ? 'bg-green-50' : 'bg-red-50'
                }`}
              >
                <Text className={`text-sm font-semibold ${verifyResultOk ? 'text-green-700' : 'text-red-700'}`}>
                  {verifyResultOk ? 'نتيجة التوثيق' : 'تنبيه'}
                </Text>
                <Text className={`text-xs leading-5 ${verifyResultOk ? 'text-green-600' : 'text-red-600'}`}>
                  {verifyResult}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={selectedProvider !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedProvider(null)}
      >
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-background rounded-t-3xl p-5 gap-4 max-h-[80%]">
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-bold text-foreground">
                مصادر SMS: {PROVIDERS.find((p) => p.key === selectedProvider)?.label}
              </Text>
              <Pressable onPress={() => setSelectedProvider(null)}>
                <XCircle size={24} color="#6b7280" />
              </Pressable>
            </View>
            {discovering === selectedProvider ? (
              <View className="items-center py-8 gap-2">
                <ActivityIndicator />
                <Text className="text-sm text-muted-foreground">جاري قراءة رسائل الجهاز...</Text>
              </View>
            ) : discovered.length === 0 ? (
              <View className="items-center py-8 gap-2">
                <AlertTriangle size={32} color="#f59e0b" />
                <Text className="text-sm text-muted-foreground">لا توجد مصادر مطابقة.</Text>
              </View>
            ) : (
              <ScrollView className="gap-2">
                {discovered.map((source) => (
                  <Pressable
                    key={source.sourceId}
                    onPress={() => selectedProvider && handleSelectSource(selectedProvider, source)}
                    className="p-4 border border-border rounded-2xl bg-card active:opacity-70 gap-2"
                  >
                    <Text className="text-base font-semibold text-foreground">{source.displayName}</Text>
                    <Text className="text-xs text-muted-foreground">{source.lastMessageSummary}</Text>
                    <Text className="text-xs text-muted-foreground">
                      {source.messageCount} رسالة • آخر رسالة: {formatDate(source.lastMessageAt)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
