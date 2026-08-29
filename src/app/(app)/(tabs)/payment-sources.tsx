import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShieldCheck, ShieldX, Plus, ChevronLeft, Shield } from 'lucide-react-native';

import { getProviderSources } from '@/services/providerSourceService';

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
};

export default function PaymentSourcesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        try {
          const data = await getProviderSources('vodafone_cash');
          setSources(data);
        } finally {
          setLoading(false);
        }
      })();
    }, [])
  );

  const verified = sources.filter((s) => s.verified === 1 && s.enabled === 1);
  const unverified = sources.filter((s) => !(s.verified === 1 && s.enabled === 1));

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />

      {/* Header */}
      <View className="px-5 pt-4 pb-3 border-b border-border">
        <View className="flex-row items-center justify-between">
          <View className="gap-0.5">
            <Text className="text-2xl font-bold text-foreground">مصادر الدفع</Text>
            <Text className="text-xs text-muted-foreground">مصادر SMS الموثّقة</Text>
          </View>
          <Pressable
            className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl border border-border active:opacity-70"
            onPress={() => router.push('/payment-source/discover' as any)}
          >
            <Plus size={16} color="#374151" />
            <Text className="text-xs font-medium text-foreground">استكشاف</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView className="flex-1 px-5" contentInsetAdjustmentBehavior="automatic">
          {/* ملخص */}
          <View className="flex-row gap-3 mt-5">
            <StatCard label="موثّق ومفعّل" value={verified.length} color="#166534" bg="#f0fdf4" />
            <StatCard label="غير موثّق" value={unverified.length} color="#6b7280" bg="#f9fafb" />
            <StatCard label="الإجمالي" value={sources.length} color="#1d4ed8" bg="#eff6ff" />
          </View>

          {/* المصادر الموثّقة */}
          {verified.length > 0 && (
            <View className="mt-6">
              <Text className="text-sm font-semibold text-foreground mb-3">✅ موثّقة ومفعّلة</Text>
              <View className="gap-2">
                {verified.map((src) => (
                  <SourceRow key={src.id} source={src} onPress={() =>
                    router.push(`/payment-source/${encodeURIComponent(`${src.provider_id}::${src.source_id}`)}` as any)
                  } />
                ))}
              </View>
            </View>
          )}

          {/* المصادر غير الموثّقة */}
          {unverified.length > 0 && (
            <View className="mt-6 mb-8">
              <Text className="text-sm font-semibold text-foreground mb-3">⚠️ غير موثّقة / معطّلة</Text>
              <View className="gap-2">
                {unverified.map((src) => (
                  <SourceRow key={src.id} source={src} onPress={() =>
                    router.push(`/payment-source/${encodeURIComponent(`${src.provider_id}::${src.source_id}`)}` as any)
                  } />
                ))}
              </View>
            </View>
          )}

          {/* حالة فارغة */}
          {sources.length === 0 && (
            <View className="mt-10 items-center gap-3">
              <Shield size={48} color="#d1d5db" />
              <Text className="text-base font-semibold text-muted-foreground">لا توجد مصادر مضافة</Text>
              <Text className="text-sm text-muted-foreground text-center px-4">
                اضغط «استكشاف» لاكتشاف مصادر SMS تلقائيًا من رسائلك
              </Text>
              <Pressable
                className="flex-row items-center gap-2 px-5 py-3 rounded-2xl bg-primary active:opacity-80 mt-2"
                onPress={() => router.push('/payment-source/discover' as any)}
              >
                <Plus size={18} color="#ffffff" />
                <Text className="text-sm font-semibold text-primary-foreground">استكشاف المصادر</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function SourceRow({ source, onPress }: { source: Source; onPress: () => void }) {
  const isVerifiedEnabled = source.verified === 1 && source.enabled === 1;
  return (
    <Pressable
      className="flex-row items-center gap-3 px-4 py-3.5 border border-border rounded-2xl bg-card active:opacity-70"
      onPress={onPress}
    >
      {isVerifiedEnabled
        ? <ShieldCheck size={20} color="#166534" />
        : <ShieldX size={20} color="#9ca3af" />
      }
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {source.display_name ?? source.source_id}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {sourceTypeLabel(source.source_type)} — {providerLabel(source.provider_id)}
        </Text>
      </View>
      <ChevronLeft size={16} color="#9ca3af" />
    </Pressable>
  );
}

function StatCard({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <View className="flex-1 px-3 py-3 rounded-2xl border border-border" style={{ backgroundColor: bg }}>
      <Text className="text-xl font-bold" style={{ color }}>{value}</Text>
      <Text className="text-xs text-muted-foreground mt-0.5">{label}</Text>
    </View>
  );
}

function providerLabel(id: string): string {
  return id === 'vodafone_cash' ? 'Vodafone Cash' : id;
}

function sourceTypeLabel(type: string): string {
  switch (type) {
    case 'phone': return 'هاتف';
    case 'short_code': return 'رمز قصير';
    case 'sender_name': return 'اسم مرسل';
    default: return type;
  }
}
