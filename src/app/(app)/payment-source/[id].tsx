import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Shield, ShieldCheck, ShieldX, Trash2, ToggleLeft, ToggleRight } from 'lucide-react-native';

import { getProviderSources, setSourceEnabled, removeSource, verifySource } from '@/services/providerSourceService';
import { getSourceVerificationLogs } from '@/services/localSmsIndex';

type Source = {
  id: number;
  provider_id: string;
  source_id: string;
  source_type: string;
  display_name: string | null;
  verified: number;
  enabled: number;
  last_message_at: string | null;
  last_verification_at: string | null;
  last_verification_result: string | null;
  verification_attempts: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type LogEntry = {
  id: number;
  action: string;
  result: string | null;
  reason: string | null;
  message_count_tested: number | null;
  message_count_passed: number | null;
  created_at: string;
};

export default function PaymentSourceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [source, setSource] = useState<Source | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // id هنا: "vodafone_cash::VFCash" (provider_id::source_id)
  const [providerId, sourceId] = (id ?? '').split('::');

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        try {
          const sources = await getProviderSources(providerId ?? '');
          const found = sources.find((s) => s.source_id === sourceId) ?? null;
          setSource(found);
          if (found) {
            const l = await getSourceVerificationLogs(providerId, sourceId, 20);
            setLogs(l);
          }
        } finally {
          setLoading(false);
        }
      })();
    }, [providerId, sourceId])
  );

  const handleToggleEnabled = async () => {
    if (!source) return;
    const next = source.enabled === 1 ? false : true;
    await setSourceEnabled(providerId as any, sourceId, next);
    setSource((s) => s ? { ...s, enabled: next ? 1 : 0 } : s);
    setMessage(next ? 'تم تفعيل المصدر' : 'تم تعطيل المصدر');
  };

  const handleVerify = async () => {
    setVerifying(true);
    setError('');
    setMessage('');
    try {
      const result = await verifySource(providerId as any, sourceId);
      setMessage(result.reason);
      const sources = await getProviderSources(providerId ?? '');
      const found = sources.find((s) => s.source_id === sourceId) ?? null;
      setSource(found);
      const l = await getSourceVerificationLogs(providerId, sourceId, 20);
      setLogs(l);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل التوثيق');
    } finally {
      setVerifying(false);
    }
  };

  const handleDelete = async () => {
    await removeSource(providerId as any, sourceId);
    router.back();
  };

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (!source) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6" style={{ paddingTop: insets.top }}>
        <StatusBar style="dark" backgroundColor="#ffffff" />
        <Text className="text-base text-muted-foreground text-center">لم يتم العثور على المصدر</Text>
        <Pressable className="mt-4 px-4 py-2 rounded-xl border border-border" onPress={() => router.back()}>
          <Text className="text-sm text-foreground">رجوع</Text>
        </Pressable>
      </View>
    );
  }

  const isVerified = source.verified === 1;
  const isEnabled = source.enabled === 1;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />

      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4 border-b border-border">
        <Pressable onPress={() => router.back()} className="active:opacity-60">
          <ArrowRight size={22} color="#374151" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-bold text-foreground" numberOfLines={1}>
            {source.display_name ?? source.source_id}
          </Text>
          <Text className="text-xs text-muted-foreground">{providerLabel(source.provider_id)}</Text>
        </View>
        <StatusBadge verified={isVerified} enabled={isEnabled} />
      </View>

      <ScrollView className="flex-1 px-5" contentInsetAdjustmentBehavior="automatic">
        {/* رسائل الحالة */}
        {message ? (
          <View className="mt-4 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <Text className="text-sm text-emerald-800">{message}</Text>
          </View>
        ) : null}
        {error ? (
          <View className="mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
            <Text className="text-sm text-red-800">{error}</Text>
          </View>
        ) : null}

        {/* بيانات المصدر */}
        <View className="mt-5 border border-border rounded-2xl bg-card p-4 gap-3">
          <InfoRow label="معرف المصدر" value={source.source_id} />
          <InfoRow label="النوع" value={sourceTypeLabel(source.source_type)} />
          <InfoRow label="المزوّد" value={providerLabel(source.provider_id)} />
          <InfoRow label="محاولات التوثيق" value={String(source.verification_attempts)} />
          <InfoRow label="آخر توثيق" value={source.last_verification_at ? formatDate(source.last_verification_at) : '—'} />
          <InfoRow label="آخر نتيجة" value={source.last_verification_result ?? '—'} />
          <InfoRow label="آخر رسالة" value={source.last_message_at ? formatDate(source.last_message_at) : '—'} />
        </View>

        {/* أزرار الإجراءات */}
        <View className="mt-5 gap-3">
          <Pressable
            className="flex-row items-center gap-3 px-4 py-3.5 rounded-2xl border border-border bg-card active:opacity-70"
            onPress={handleToggleEnabled}
          >
            {isEnabled
              ? <ToggleRight size={20} color="#22c55e" />
              : <ToggleLeft size={20} color="#9ca3af" />
            }
            <Text className="text-sm font-medium text-foreground flex-1">
              {isEnabled ? 'تعطيل المصدر' : 'تفعيل المصدر'}
            </Text>
          </Pressable>

          <Pressable
            className="flex-row items-center gap-3 px-4 py-3.5 rounded-2xl bg-primary active:opacity-80"
            onPress={handleVerify}
            disabled={verifying}
          >
            {verifying
              ? <ActivityIndicator size="small" color="#ffffff" />
              : <Shield size={20} color="#ffffff" />
            }
            <Text className="text-sm font-semibold text-primary-foreground flex-1">
              {verifying ? 'جاري التوثيق...' : 'توثيق المصدر'}
            </Text>
          </Pressable>

          <Pressable
            className="flex-row items-center gap-3 px-4 py-3.5 rounded-2xl border border-red-200 bg-red-50 active:opacity-70"
            onPress={handleDelete}
          >
            <Trash2 size={20} color="#dc2626" />
            <Text className="text-sm font-medium text-red-700 flex-1">حذف المصدر</Text>
          </Pressable>
        </View>

        {/* سجل التوثيق */}
        {logs.length > 0 && (
          <View className="mt-6 mb-8">
            <Text className="text-sm font-semibold text-foreground mb-3">سجل التوثيق</Text>
            <View className="gap-2">
              {logs.map((log) => (
                <View key={log.id} className="px-4 py-3 border border-border rounded-xl bg-card gap-1">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-xs font-medium text-foreground">{actionLabel(log.action)}</Text>
                    <Text className="text-xs text-muted-foreground">{formatDate(log.created_at)}</Text>
                  </View>
                  {log.reason ? <Text className="text-xs text-muted-foreground">{log.reason}</Text> : null}
                  {(log.message_count_tested ?? 0) > 0 && (
                    <Text className="text-xs text-muted-foreground">
                      اختُبر {log.message_count_tested} • نجح {log.message_count_passed}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function StatusBadge({ verified, enabled }: { verified: boolean; enabled: boolean }) {
  if (verified && enabled) {
    return (
      <View className="flex-row items-center gap-1 px-2 py-1 rounded-full bg-emerald-100">
        <ShieldCheck size={14} color="#166534" />
        <Text className="text-xs text-emerald-800 font-medium">موثّق</Text>
      </View>
    );
  }
  if (verified && !enabled) {
    return (
      <View className="flex-row items-center gap-1 px-2 py-1 rounded-full bg-yellow-100">
        <Shield size={14} color="#854d0e" />
        <Text className="text-xs text-yellow-800 font-medium">معطّل</Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-1 px-2 py-1 rounded-full bg-gray-100">
      <ShieldX size={14} color="#6b7280" />
      <Text className="text-xs text-muted-foreground font-medium">غير موثّق</Text>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-2">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="text-xs font-medium text-foreground flex-shrink">{value}</Text>
    </View>
  );
}

function providerLabel(id: string): string {
  return id === 'vodafone_cash' ? 'Vodafone Cash' : id;
}

function sourceTypeLabel(type: string): string {
  switch (type) {
    case 'phone': return 'رقم هاتف';
    case 'short_code': return 'رمز قصير';
    case 'sender_name': return 'اسم مرسل';
    default: return type;
  }
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    verify: 'توثيق',
    add_manual: 'إضافة يدوية',
    enable: 'تفعيل',
    disable: 'تعطيل',
    delete: 'حذف',
  };
  return map[action] ?? action;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
