import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, CheckCircle2, MessageSquare, RefreshCw, Shield, Smartphone } from 'lucide-react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import {
  discoverSmsSources,
  requestSmsPermission,
  verifyProviderSource,
  type DiscoveryResult,
} from '@/services/providerSourceService';
import type { DiscoveredSmsSource, ProviderName } from '@/types/provider';

const providerLabels: Record<ProviderName, string> = {
  vodafone_cash: 'Vodafone Cash',
  orange_cash: 'Orange Cash',
  insta_pay: 'InstaPay',
  bank_transfer: 'تحويل بنكي',
  unknown: 'غير معروف',
};

const PROVIDER_IDS: ProviderName[] = ['vodafone_cash', 'orange_cash', 'insta_pay', 'bank_transfer'];

export default function PaymentSourceDiscoverScreen() {
  const { provider } = useLocalSearchParams<{ provider: string }>();
  const providerId = (PROVIDER_IDS.includes(provider as ProviderName) ? (provider as ProviderName) : 'unknown') as ProviderName;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<DiscoveredSmsSource | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; reason?: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await discoverSmsSources(providerId);
    setDiscovery(result);
    setLoading(false);
  }, [providerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const requestPermission = async () => {
    const granted = await requestSmsPermission();
    if (granted) await load();
  };

  const handleSelect = (source: DiscoveredSmsSource) => {
    setSelected(source);
    setVerifyResult(null);
  };

  const handleVerify = async () => {
    if (!selected) return;
    setVerifyBusy(true);
    const result = await verifyProviderSource(providerId, selected);
    setVerifyResult(result);
    setVerifyBusy(false);
  };

  const handleCloseResult = () => {
    if (verifyResult?.ok) {
      router.back();
    } else {
      setVerifyResult(null);
      setSelected(null);
    }
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <View className="flex-1 px-5">
        <View className="flex-row items-center justify-between py-6">
          <View className="gap-1">
            <Text className="text-2xl font-bold text-foreground">
              اختر مصدر رسائل {providerLabels[providerId]}
            </Text>
            <Text className="text-xs text-muted-foreground">
              سيستخدم التطبيق هذا المصدر فقط عند التحقق من معاملات {providerLabels[providerId]}.
            </Text>
          </View>
          <Pressable
            onPress={() => router.back()}
            className="w-10 h-10 items-center justify-center border border-border rounded-full active:opacity-70"
          >
            <ArrowRight size={20} color="#6b7280" />
          </Pressable>
        </View>

        {!discovery?.permissionGranted && (
          <Card className="p-5 border border-border rounded-2xl mb-4 gap-3">
            <View className="flex-row items-center gap-3">
              <MessageSquare size={24} color="#6b7280" />
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">صلاحية قراءة SMS مطلوبة</Text>
                <Text className="text-sm text-muted-foreground">
                  {discovery?.error ?? 'لا يمكن اكتشاف المصادر دون الوصول إلى SMS.'}
                </Text>
              </View>
            </View>
            <Button onPress={requestPermission}>
              <Text className="text-primary-foreground font-medium">السماح بقراءة SMS</Text>
            </Button>
          </Card>
        )}

        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-sm font-medium text-muted-foreground">
            المصادر المكتشفة: {discovery?.sources.length ?? 0}
          </Text>
          <Pressable
            onPress={load}
            disabled={loading}
            className="flex-row items-center gap-1 px-3 py-1.5 border border-border rounded-lg active:opacity-70"
          >
            <RefreshCw size={14} color="#6b7280" />
            <Text className="text-sm text-foreground">إعادة الفحص</Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator className="mt-12" />
        ) : (
          <FlatList
            data={discovery?.sources ?? []}
            keyExtractor={(item) => item.sourceId}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="pb-6 gap-3"
            ListEmptyComponent={
              <View className="py-12 items-center gap-3">
                <Smartphone size={40} color="#9ca3af" />
                <Text className="text-center text-muted-foreground">
                  {discovery?.error ?? 'لا توجد مصادر مكتشفة.'}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <SourceCard
                source={item}
                selected={selected?.sourceId === item.sourceId}
                onSelect={handleSelect}
              />
            )}
          />
        )}

        <View className="py-4">
          <Text className="text-xs text-center text-muted-foreground">
            بعد اختيار المصدر سيتم اختبار الرسائل قبل اعتماد المصدر.
          </Text>
        </View>
      </View>

      <AlertDialog open={Boolean(selected)} onOpenChange={() => setSelected(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>توثيق المصدر</AlertDialogTitle>
            <AlertDialogDescription>
              {selected ? (
                <Text>
                  سيتم فحص رسائل "{selected.label}" واختبارها باستخدام محلل {providerLabels[providerId]}.
                </Text>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onPress={() => setSelected(null)} variant="outline">
              <Text className="text-foreground">إلغاء</Text>
            </Button>
            <Button onPress={handleVerify} disabled={verifyBusy}>
              {verifyBusy ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text className="text-primary-foreground font-medium">توثيق المصدر</Text>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(verifyResult)} onOpenChange={handleCloseResult}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {verifyResult?.ok ? 'تم التوثيق بنجاح' : 'فشل التوثيق'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Text>
                {verifyResult?.ok
                  ? 'المصدر موثق الآن وسيتم استخدامه في التحقق من المعاملات.'
                  : verifyResult?.reason ?? 'لم يتم التوثيق. يرجى اختيار مصدر آخر أو إعادة الفحص.'}
              </Text>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onPress={handleCloseResult}>
              <Text className="text-primary-foreground">حسنًا</Text>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}

function SourceCard({
  source,
  selected,
  onSelect,
}: {
  source: DiscoveredSmsSource;
  selected: boolean;
  onSelect: (s: DiscoveredSmsSource) => void;
}) {
  return (
    <Card className={`p-4 border rounded-2xl gap-3 ${selected ? 'border-primary bg-primary/5' : 'border-border'}`}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <View className="w-10 h-10 rounded-full bg-muted items-center justify-center">
            <Shield size={20} color="#6b7280" />
          </View>
          <View>
            <Text className="text-base font-semibold text-foreground">{source.label}</Text>
            <Text className="text-xs text-muted-foreground">
              {source.messageCount} رسالة • آخر وصول: {source.lastMessageAt ? formatDate(source.lastMessageAt) : '—'}
            </Text>
          </View>
        </View>
        <Text className={`text-sm font-medium ${source.parserConfidence >= 50 ? 'text-emerald-600' : 'text-destructive'}`}>
          {source.parserConfidence}%
        </Text>
      </View>

      <View className="p-3 rounded-lg bg-muted/50">
        <Text className="text-sm text-foreground" numberOfLines={2}>
          آخر رسالة: {source.lastMessagePreview}
        </Text>
      </View>

      <Button
        onPress={() => {
          onSelect(source);
        }}
        variant={selected ? 'default' : 'outline'}
      >
        <View className="flex-row items-center gap-2">
          <CheckCircle2 size={18} color={selected ? '#ffffff' : '#6b7280'} />
          <Text className={selected ? 'text-primary-foreground font-medium' : 'text-foreground'}>
            {selected ? 'تم الاختيار' : 'اختيار'}
          </Text>
        </View>
      </Button>
    </Card>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
