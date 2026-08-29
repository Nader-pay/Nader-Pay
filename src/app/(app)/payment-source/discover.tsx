import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Radar, Plus, ShieldCheck, ShieldX } from 'lucide-react-native';

import { discoverSmsSources, addSourceManually, verifySource } from '@/services/providerSourceService';
import type { DiscoveredSmsSource } from '@/types/provider';

export default function DiscoverSourceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [discovered, setDiscovered] = useState<DiscoveredSmsSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualId, setManualId] = useState('');
  const [adding, setAdding] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleDiscover = useCallback(async () => {
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const results = await discoverSmsSources('vodafone_cash');
      setDiscovered(results);
      if (results.length === 0) {
        setMessage('لم يتم العثور على مصادر — تأكد من فهرسة الرسائل أولاً');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل الاستكشاف');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      handleDiscover();
    }, [handleDiscover])
  );

  const handleAddManual = async () => {
    const id = manualId.trim();
    if (!id) return;
    setAdding(true);
    setError('');
    setMessage('');
    try {
      await addSourceManually('vodafone_cash', id);
      setMessage(`تمت إضافة "${id}" — يمكن توثيقه من صفحة التفاصيل`);
      setManualId('');
      await handleDiscover();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل الإضافة');
    } finally {
      setAdding(false);
    }
  };

  const handleQuickVerify = async (sourceId: string) => {
    setVerifyingId(sourceId);
    setError('');
    setMessage('');
    try {
      const result = await verifySource('vodafone_cash', sourceId);
      setMessage(result.reason);
      await handleDiscover();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل التوثيق');
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />

      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4 border-b border-border">
        <Pressable onPress={() => router.back()} className="active:opacity-60">
          <ArrowRight size={22} color="#374151" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-bold text-foreground">استكشاف المصادر</Text>
          <Text className="text-xs text-muted-foreground">فودافون كاش — Vodafone Cash</Text>
        </View>
        <Pressable
          className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl bg-primary active:opacity-80"
          onPress={handleDiscover}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator size="small" color="#ffffff" />
            : <Radar size={16} color="#ffffff" />
          }
          <Text className="text-xs font-semibold text-primary-foreground">مسح</Text>
        </Pressable>
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

        {/* إضافة يدوية */}
        <View className="mt-5 border border-border rounded-2xl bg-card p-4 gap-3">
          <Text className="text-sm font-semibold text-foreground">إضافة مصدر يدويًا</Text>
          <Text className="text-xs text-muted-foreground">أدخل رقم الهاتف أو اسم المرسل (مثل: VFCash أو +201001234567)</Text>
          <View className="flex-row gap-2">
            <TextInput
              className="flex-1 border border-border rounded-xl bg-background px-4 py-3 text-sm text-foreground"
              placeholder="رقم أو اسم المرسل"
              placeholderTextColor="#9ca3af"
              value={manualId}
              onChangeText={setManualId}
              autoCapitalize="none"
            />
            <Pressable
              className="flex-row items-center gap-1.5 px-4 rounded-xl bg-primary active:opacity-80"
              onPress={handleAddManual}
              disabled={adding || !manualId.trim()}
            >
              {adding
                ? <ActivityIndicator size="small" color="#ffffff" />
                : <Plus size={18} color="#ffffff" />
              }
            </Pressable>
          </View>
        </View>

        {/* نتائج الاستكشاف */}
        <View className="mt-5 mb-8">
          <Text className="text-sm font-semibold text-foreground mb-3">
            المصادر المكتشفة {discovered.length > 0 ? `(${discovered.length})` : ''}
          </Text>

          {loading && discovered.length === 0 ? (
            <View className="items-center py-8">
              <ActivityIndicator />
              <Text className="text-xs text-muted-foreground mt-2">جاري الاستكشاف...</Text>
            </View>
          ) : discovered.length === 0 ? (
            <View className="items-center py-8 border border-border rounded-2xl bg-card">
              <Radar size={32} color="#9ca3af" />
              <Text className="text-sm text-muted-foreground mt-2">لا توجد مصادر مكتشفة</Text>
              <Text className="text-xs text-muted-foreground mt-1">تأكد من وجود رسائل SMS مفهرسة</Text>
            </View>
          ) : (
            <View className="gap-3">
              {discovered.map((src) => (
                <Pressable
                  key={src.sourceId}
                  className="border border-border rounded-2xl bg-card p-4 gap-2 active:opacity-80"
                  onPress={() => router.push(`/payment-source/${encodeURIComponent(`vodafone_cash::${src.sourceId}`)}`)}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2 flex-1">
                      {src.isCurrentlyVerified
                        ? <ShieldCheck size={18} color="#166534" />
                        : <ShieldX size={18} color="#9ca3af" />
                      }
                      <Text className="text-sm font-semibold text-foreground flex-1" numberOfLines={1}>
                        {src.displayName}
                      </Text>
                    </View>
                    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: confidenceColor(src.confidence) + '20' }}>
                      <Text className="text-xs font-medium" style={{ color: confidenceColor(src.confidence) }}>
                        {src.confidence}%
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row gap-3">
                    <Text className="text-xs text-muted-foreground">{src.matchedCount}/{src.messageCount} رسالة مطابقة</Text>
                    {src.lastMessageAt ? (
                      <Text className="text-xs text-muted-foreground">آخر رسالة: {formatDate(src.lastMessageAt)}</Text>
                    ) : null}
                  </View>

                  {src.lastMessageBody ? (
                    <Text className="text-xs text-muted-foreground" numberOfLines={2}>{src.lastMessageBody}</Text>
                  ) : null}

                  {!src.isCurrentlyVerified && (
                    <Pressable
                      className="mt-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl bg-primary active:opacity-80"
                      onPress={(e) => { e.stopPropagation?.(); handleQuickVerify(src.sourceId); }}
                      disabled={verifyingId === src.sourceId}
                    >
                      {verifyingId === src.sourceId
                        ? <ActivityIndicator size="small" color="#ffffff" />
                        : <ShieldCheck size={15} color="#ffffff" />
                      }
                      <Text className="text-xs font-semibold text-primary-foreground">توثيق سريع</Text>
                    </Pressable>
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function confidenceColor(confidence: number): string {
  if (confidence >= 80) return '#166534';
  if (confidence >= 50) return '#854d0e';
  return '#6b7280';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
