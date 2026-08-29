import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowRight,
  CheckCircle2,
  MessageSquare,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  X,
  XCircle,
} from 'lucide-react-native';

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
  getProviderSourceStatus,
  revokeAndResetProviderSource,
  type ProviderSourceStatus as ProviderSourceStatusType,
} from '@/services/providerSourceService';
import type { ProviderName } from '@/types/provider';

const providerLabels: Record<ProviderName, string> = {
  vodafone_cash: 'Vodafone Cash',
  orange_cash: 'Orange Cash',
  insta_pay: 'InstaPay',
  bank_transfer: 'تحويل بنكي',
  unknown: 'غير معروف',
};

const PROVIDER_IDS: ProviderName[] = ['vodafone_cash', 'orange_cash', 'insta_pay', 'bank_transfer'];

function statusLabel(status: ProviderSourceStatusType['status'] | undefined) {
  switch (status) {
    case 'verified':
      return 'موثق ومفعل';
    case 'failed':
      return 'فشل التوثيق';
    case 'discovering':
      return 'جاري الاكتشاف';
    case 'verifying':
      return 'جاري التحقق';
    case 'selected':
      return 'تم اختيار المصدر';
    default:
      return 'غير موثق';
  }
}

function statusColor(status: ProviderSourceStatusType['status'] | undefined) {
  if (status === 'verified') return 'text-emerald-600';
  if (status === 'failed') return 'text-destructive';
  return 'text-muted-foreground';
}

function StatusIcon({ status }: { status: ProviderSourceStatusType['status'] | undefined }) {
  if (status === 'verified') return <ShieldCheck size={24} color="#22c55e" />;
  if (status === 'failed') return <ShieldAlert size={24} color="#ef4444" />;
  return <Shield size={24} color="#6b7280" />;
}

export default function PaymentSourceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const providerId = (PROVIDER_IDS.includes(id as ProviderName) ? (id as ProviderName) : 'unknown') as ProviderName;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<ProviderSourceStatusType | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);

  const load = useCallback(async () => {
    const s = await getProviderSourceStatus(providerId);
    setStatus(s);
    setLoading(false);
  }, [providerId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleRevoke = async () => {
    setRevokeBusy(true);
    await revokeAndResetProviderSource(providerId);
    setRevokeOpen(false);
    await load();
    setRevokeBusy(false);
  };

  const verified = status?.status === 'verified';

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
            <Text className="text-2xl font-bold text-foreground">
              توثيق مصدر رسائل {providerLabels[providerId]}
            </Text>
            <Text className="text-xs text-muted-foreground">
              المصدر الموثق هو الوحيد المسموح له بتأكيد المدفوعات.
            </Text>
          </View>
          <Pressable
            onPress={() => router.back()}
            className="w-10 h-10 items-center justify-center border border-border rounded-full active:opacity-70"
          >
            <ArrowRight size={20} color="#6b7280" />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator className="mt-12" />
        ) : (
          <View className="gap-5 pb-10">
            <Card className="p-5 border border-border rounded-2xl">
              <View className="flex-row items-center gap-4">
                <View className="w-14 h-14 rounded-full bg-muted items-center justify-center">
                  <Smartphone size={28} color="#6b7280" />
                </View>
                <View className="flex-1 gap-1">
                  <Text className="text-xl font-semibold text-foreground">{providerLabels[providerId]}</Text>
                  <View className="flex-row items-center gap-2">
                    <StatusIcon status={status?.status} />
                    <Text className={`text-sm font-medium ${statusColor(status?.status)}`}>
                      {statusLabel(status?.status)}
                    </Text>
                  </View>
                </View>
              </View>
            </Card>

            <LiveStatusCard status={status} />

            <Card className="p-5 border border-border rounded-2xl gap-3">
              <Text className="text-base font-semibold text-foreground">معلومات المصدر</Text>
              <View className="gap-2">
                <InfoRow label="المصدر" value={status?.source?.sourceId ?? '—'} />
                <InfoRow label="نوع المصدر" value={status?.source?.sourceType ?? '—'} />
                <InfoRow label="آخر توثيق" value={status?.lastVerificationAt ? formatDate(status.lastVerificationAt) : '—'} />
                <InfoRow label="آخر رسالة" value={status?.lastMessageAt ? formatDate(status.lastMessageAt) : '—'} />
                <InfoRow label="ملخص الرسالة" value={status?.lastMessageSummary ?? '—'} />
                <InfoRow label="نتيجة التحقق" value={status?.lastVerificationResult ?? '—'} />
              </View>
            </Card>

            {!verified ? (
              <View className="gap-3">
                <Button onPress={() => router.push(`/(app)/payment-source/discover?provider=${providerId}` as any)}>
                  <View className="flex-row items-center gap-2">
                    <MessageSquare size={18} color="#ffffff" />
                    <Text className="text-primary-foreground font-medium">إضافة مصدر رسائل</Text>
                  </View>
                </Button>
                <Button onPress={load} variant="outline">
                  <View className="flex-row items-center gap-2">
                    <RefreshCw size={18} color="#6b7280" />
                    <Text className="text-foreground">إعادة فحص المصادر</Text>
                  </View>
                </Button>
              </View>
            ) : (
              <View className="gap-3">
                <Button onPress={() => router.push(`/(app)/payment-source/discover?provider=${providerId}` as any)} variant="outline">
                  <View className="flex-row items-center gap-2">
                    <RefreshCw size={18} color="#6b7280" />
                    <Text className="text-foreground">إعادة فحص المصدر</Text>
                  </View>
                </Button>
                <Button onPress={() => setRevokeOpen(true)} variant="destructive">
                  <View className="flex-row items-center gap-2">
                    <XCircle size={18} color="#ffffff" />
                    <Text className="text-destructive-foreground font-medium">إلغاء توثيق المصدر</Text>
                  </View>
                </Button>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء التوثيق</AlertDialogTitle>
            <AlertDialogDescription>
              سيتوقف التطبيق عن قبول رسائل {providerLabels[providerId]} من هذا المصدر. لن يتم حذف المعاملات السابقة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onPress={() => setRevokeOpen(false)} variant="outline">
              <Text className="text-foreground">تراجع</Text>
            </Button>
            <Button onPress={handleRevoke} variant="destructive" disabled={revokeBusy}>
              <Text className="text-destructive-foreground">إلغاء التوثيق</Text>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}

function LiveStatusCard({ status }: { status: ProviderSourceStatusType | null }) {
  if (!status) return null;

  const rows = [
    { icon: ShieldCheck, label: 'المصدر موثق', ok: status.status === 'verified' },
    { icon: Smartphone, label: 'SMS Reader يعمل', ok: status.smsReady },
    { icon: CheckCircle2, label: 'Parser جاهز', ok: status.parserReady },
    { icon: MessageSquare, label: 'آخر رسالة تم فحصها', ok: Boolean(status.lastMessageAt) },
    { icon: X, label: 'Live Monitoring', ok: status.status === 'verified' },
  ];

  return (
    <Card className="p-5 border border-border rounded-2xl gap-3">
      <Text className="text-base font-semibold text-foreground">Live Status</Text>
      <View className="gap-2">
        {rows.map((row, idx) => {
          const Icon = row.icon;
          return (
            <View key={idx} className="flex-row items-center justify-between py-1">
              <View className="flex-row items-center gap-2">
                <Icon size={18} color={row.ok ? '#22c55e' : '#6b7280'} />
                <Text className="text-sm text-foreground">{row.label}</Text>
              </View>
              <Text className={`text-sm font-medium ${row.ok ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                {row.ok ? '✓' : '✕'}
              </Text>
            </View>
          );
        })}
      </View>
      {status.error && (
        <View className="mt-2 p-3 rounded-lg bg-destructive/10">
          <Text className="text-sm text-destructive">{status.error}</Text>
        </View>
      )}
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-2">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm text-foreground flex-1 text-right" numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
