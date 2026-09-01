/**
 * discovery.tsx — اكتشاف مصادر SMS وتوثيقها
 * ═══════════════════════════════════════════════════════════════════
 * نطاق هذه الشاشة: SMS فقط.
 * لا تحتوي على أي إشعارات تطبيقات — تلك شاشة منفصلة.
 *
 * السيناريو:
 * 1. قراءة جميع المرسلين الفريدين من Android SMS Content Provider
 * 2. عرضهم كمصادر (sender identity) — لا محتوى الرسائل
 * 3. اختيار المصدر الصحيح → ضغط "توثيق" → حفظ raw sender + normalized identity
 * ═══════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openSettings } from 'expo-linking';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  MessageSquare,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  XCircle,
} from 'lucide-react-native';

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { createHash } from '@/lib/hash';
import { checkSmsPermission, requestSmsPermission } from '@/services/smsReader';
import {
  discoverSmsSources,
  type SmsSource,
  type SmsSourceVerificationResult,
  verifySourceWithParser,
} from '@/services/sourceDiscovery';
import { upsertProviderSource, type ProviderSource } from '@/services/providerSourceService';
import type { ProviderName } from '@/types/agent';

const PROVIDERS: {
  key: ProviderName | 'all';
  label: string;
}[] = [
  { key: 'all', label: 'كل المصادر' },
  { key: 'vodafone_cash', label: 'Vodafone Cash' },
  { key: 'orange_cash', label: 'Orange Cash' },
  { key: 'insta_pay', label: 'InstaPay' },
  { key: 'bank_transfer', label: 'تحويل بنكي' },
];

const PROVIDER_LABELS: Record<ProviderName, string> = {
  vodafone_cash: 'Vodafone Cash',
  orange_cash: 'Orange Cash',
  insta_pay: 'InstaPay',
  bank_transfer: 'تحويل بنكي',
  unknown: 'غير معروف',
};

const LIKELIHOOD_LABELS: Record<string, { label: string; color: string }> = {
  high: { label: 'مرتفع', color: '#22c55e' },
  medium: { label: 'متوسط', color: '#f59e0b' },
  low: { label: 'منخفض', color: '#6b7280' },
};

export default function SourceDiscoveryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ provider?: string }>();
  const initialProvider = parseProviderParam(params.provider);

  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [permissionRequested, setPermissionRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sources, setSources] = useState<SmsSource[]>([]);
  const [filter, setFilter] = useState<ProviderName | 'all'>(initialProvider);
  const [selectedSource, setSelectedSource] = useState<SmsSource | null>(null);
  const [selectedSourceProvider, setSelectedSourceProvider] = useState<ProviderName | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [detailedResult, setDetailedResult] = useState<SmsSourceVerificationResult | null>(null);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);

  const checkPermission = useCallback(async () => {
    if (process.env.EXPO_OS === 'web') { setPermissionGranted(false); return; }
    const granted = await checkSmsPermission();
    setPermissionGranted(granted);
  }, []);

  const loadSources = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const discovered = await discoverSmsSources();
      setSources(discovered);
      setVerifyResult(null);
      setDetailedResult(null);
    } catch (err) {
      setVerifyResult({ ok: false, message: err instanceof Error ? err.message : 'فشل قراءة رسائل الجهاز' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { checkPermission(); }, [checkPermission]));

  useEffect(() => {
    if (permissionGranted === true) { loadSources(); }
  }, [permissionGranted, loadSources]);

  const requestAccess = async () => {
    if (process.env.EXPO_OS === 'web') { setPermissionRequested(true); setPermissionGranted(false); return; }
    setPermissionRequested(true);
    const granted = await requestSmsPermission();
    await checkPermission();
    if (granted) await loadSources();
  };

  const openAppSettings = async () => {
    if (process.env.EXPO_OS !== 'web') await openSettings();
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSources(false);
  }, [loadSources]);

  const filteredSources = useMemo(() => {
    const filtered = filter === 'all' ? sources : sources.filter((s) => s.providerHint === filter);
    return filtered.map((s) => ({ ...s, score: scoreSource(s, filter) })).sort((a, b) => b.score - a.score);
  }, [sources, filter]);

  const confirmSelect = (source: SmsSource) => {
    setSelectedSourceProvider(source.providerHint === 'unknown' ? 'vodafone_cash' : source.providerHint);
    setSelectedSource(source);
  };

  const verifyAndSave = async (source: SmsSource, provider: ProviderName) => {
    setVerifying(true);
    const result = await verifySourceWithParser(source, provider);
    const now = new Date().toISOString();
    const id = createHash(`${provider}:${source.sourceId}`);
    const newSource: ProviderSource = {
      id,
      providerId: provider,
      providerName: PROVIDER_LABELS[provider],
      sourceId: source.sourceId,
      sourceType: 'sms',
      sourceMetadata: {
        messageCount: source.messageCount,
        displayName: source.displayName,
        rawSender: source.sourceId,
        samples: source.rawMessages.map((m) => m.body.slice(0, 120)),
        // تفاصيل التوثيق المفصّل
        identityStatus: result.identityStatus,
        messageAccessStatus: result.messageAccessStatus,
        classificationSummary: result.classificationSummary,
        transactionSampleStatus: result.transactionSampleStatus,
        parserStatus: result.parserStatus,
      },
      parserVersion: '2',
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
    setVerifying(false);
    setSelectedSource(null);
    setDetailedResult(result);
  };

  const renderItem = ({ item: source }: { item: SmsSource & { score: number } }) => {
    const likelihood = getLikelihood(source.score, source.providerHint);
    const provider = source.providerHint === 'unknown' ? null : source.providerHint;
    const isExpanded = expandedSourceId === source.sourceId;
    return (
      <View className="border border-border rounded-2xl bg-card overflow-hidden">
        <Pressable
          onPress={() => confirmSelect(source)}
          className="p-4 active:opacity-70 gap-2"
          android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
        >
          <View className="flex-row items-start justify-between">
            <View className="flex-row items-center gap-2 flex-1 min-w-0">
              <View className="w-9 h-9 rounded-full bg-muted items-center justify-center shrink-0">
                <Smartphone size={18} color="#6b7280" />
              </View>
              <View className="flex-1 min-w-0">
                <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                  {source.displayName}
                </Text>
                <Text className="text-xs text-muted-foreground font-mono" numberOfLines={1}>
                  {source.sourceId}
                </Text>
                {provider && (
                  <Text className="text-xs text-muted-foreground">{PROVIDER_LABELS[provider]}</Text>
                )}
              </View>
            </View>
            <View className="flex-row items-center gap-1 shrink-0">
              <View className="w-2 h-2 rounded-full" style={{ backgroundColor: LIKELIHOOD_LABELS[likelihood].color }} />
              <Text className="text-xs text-muted-foreground">{LIKELIHOOD_LABELS[likelihood].label}</Text>
            </View>
          </View>

          <View className="flex-row items-center justify-between mt-1">
            <View className="flex-row items-center gap-3">
              <Text className="text-xs text-muted-foreground">{source.messageCount} رسالة</Text>
              <Text className="text-xs text-muted-foreground">{formatDate(source.lastMessageAt)}</Text>
            </View>
            <Pressable
              onPress={() => setExpandedSourceId(isExpanded ? null : source.sourceId)}
              className="flex-row items-center gap-1 px-2.5 py-1 rounded-full bg-muted active:opacity-70"
              hitSlop={8}
            >
              <MessageSquare size={12} color="#6b7280" />
              <Text className="text-xs text-muted-foreground">{isExpanded ? 'إخفاء' : 'معاينة'}</Text>
              {isExpanded ? <ChevronUp size={11} color="#6b7280" /> : <ChevronDown size={11} color="#6b7280" />}
            </Pressable>
          </View>
        </Pressable>

        {isExpanded && source.rawMessages.length > 0 && (
          <View className="border-t border-border px-4 pb-4 gap-2 pt-3">
            <Text className="text-xs font-semibold text-muted-foreground mb-1">
              عينة من آخر {source.rawMessages.length} رسالة
            </Text>
            {source.rawMessages.map((msg, idx) => (
              <View key={idx} className="bg-muted rounded-xl p-3 gap-1">
                <View className="flex-row items-center justify-between mb-0.5">
                  <Text className="text-xs font-medium text-foreground">{source.sourceId}</Text>
                  <Text className="text-xs text-muted-foreground">{formatDate(msg.date)}</Text>
                </View>
                <Text className="text-xs text-foreground leading-5">{msg.body}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <View className="flex-1 px-5">
        {/* Header */}
        <View className="flex-row items-center gap-2 py-5">
          <Pressable
            onPress={() => router.back()}
            className="w-10 h-10 items-center justify-center border border-border rounded-full active:opacity-70"
          >
            <ArrowLeft size={20} color="#6b7280" />
          </Pressable>
          <View className="flex-1">
            <Text className="text-2xl font-bold text-foreground">اكتشاف مصادر SMS</Text>
            <Text className="text-xs text-muted-foreground">
              اختر المُرسِل الصحيح كمصدر رسائل موثوق
            </Text>
          </View>
        </View>

        {/* حالة الصلاحية */}
        {permissionGranted === false && (
          <Alert icon={ShieldAlert} variant="destructive" className="mb-4">
            <AlertTitle>صلاحية قراءة SMS مطلوبة</AlertTitle>
            <AlertDescription>
              {permissionRequested
                ? 'تم رفض الصلاحية. يرجى تفعيل صلاحية SMS من إعدادات التطبيق لمواصلة الاكتشاف.'
                : 'يحتاج التطبيق إلى صلاحية قراءة SMS لاستعراض مصادر الرسائل المالية.'
              }
            </AlertDescription>
            <View className="flex-row gap-2 mt-3 pl-6">
              <Pressable
                onPress={permissionRequested ? openAppSettings : requestAccess}
                className="flex-row items-center gap-2 px-3 py-2 rounded-lg bg-primary active:opacity-70"
              >
                {permissionRequested
                  ? <Settings size={16} color="#ffffff" />
                  : <Smartphone size={16} color="#ffffff" />}
                <Text className="text-sm font-semibold text-primary-foreground">
                  {permissionRequested
                    ? process.env.EXPO_OS === 'web' ? 'يتطلب Android' : 'فتح الإعدادات'
                    : 'منح الصلاحية'}
                </Text>
              </Pressable>
            </View>
          </Alert>
        )}

        {permissionGranted === true && (
          <>
            {/* تصفية حسب المزود */}
            <View className="mb-3">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 py-1">
                {PROVIDERS.map((p) => {
                  const active = filter === p.key;
                  return (
                    <Pressable
                      key={p.key}
                      onPress={() => setFilter(p.key)}
                      className={cn(
                        'px-3 py-2 rounded-full border border-border active:opacity-70',
                        active ? 'bg-primary border-primary' : 'bg-card'
                      )}
                    >
                      <Text className={cn('text-sm font-medium', active ? 'text-primary-foreground' : 'text-foreground')}>
                        {p.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-sm text-muted-foreground">
                {filteredSources.length} مُرسِل • {sources.length} إجمالي
              </Text>
              <Pressable
                onPress={onRefresh}
                disabled={refreshing || loading}
                className="flex-row items-center gap-1 px-3 py-1.5 rounded-lg border border-border active:opacity-70"
              >
                <RefreshCw size={14} color="#6b7280" />
                <Text className="text-xs text-foreground">إعادة فحص</Text>
              </Pressable>
            </View>

            {loading ? (
              <View className="flex-1 items-center justify-center gap-2">
                <ActivityIndicator />
                <Text className="text-sm text-muted-foreground">جاري قراءة مصادر الرسائل...</Text>
              </View>
            ) : (
              <FlatList
                data={filteredSources}
                keyExtractor={(item) => item.sourceId}
                renderItem={renderItem}
                contentContainerClassName="gap-3 pb-8"
                contentInsetAdjustmentBehavior="automatic"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                refreshing={refreshing}
                onRefresh={onRefresh}
                ListEmptyComponent={
                  <View className="items-center py-16 gap-3">
                    <Search size={40} color="#d1d5db" />
                    <Text className="text-base font-medium text-foreground">لم يُعثر على مصادر SMS</Text>
                    <Text className="text-sm text-muted-foreground text-center leading-6">
                      {filter === 'all'
                        ? 'لا توجد رسائل على الجهاز أو لم تُمنح الصلاحية بعد.'
                        : `لا توجد رسائل من ${PROVIDERS.find((p) => p.key === filter)?.label ?? ''} على هذا الجهاز.`}
                    </Text>
                  </View>
                }
              />
            )}
          </>
        )}

        {/* نتيجة التوثيق العامة */}
        {verifyResult && !detailedResult && (
          <Alert
            icon={verifyResult.ok ? CheckCircle2 : XCircle}
            variant={verifyResult.ok ? 'default' : 'destructive'}
            className="mb-4"
          >
            <AlertTitle>{verifyResult.ok ? 'تم التوثيق بنجاح' : 'تنبيه'}</AlertTitle>
            <AlertDescription>{verifyResult.message}</AlertDescription>
          </Alert>
        )}

        {/* نتيجة التوثيق المفصّلة — 4 حالات مستقلة */}
        {detailedResult && (
          <View className="mb-4 border border-border rounded-2xl bg-card overflow-hidden">
            <View className="px-4 pt-4 pb-3 border-b border-border">
              <View className="flex-row items-center gap-2">
                {detailedResult.passed
                  ? <ShieldCheck size={18} color="#16a34a" />
                  : <ShieldAlert size={18} color="#ef4444" />}
                <Text className="text-sm font-bold text-foreground">
                  {detailedResult.passed ? 'تم التوثيق بنجاح' : 'فشل التوثيق'}
                </Text>
              </View>
              <Text className="text-xs text-muted-foreground mt-1 leading-5">
                {detailedResult.reason}
              </Text>
            </View>
            {/* الحالات الأربع */}
            <View className="px-4 py-3 gap-2">
              <VerifRow
                label="هوية المصدر"
                status={detailedResult.identityStatus === 'VERIFIED' ? 'ok' : 'fail'}
                value={detailedResult.identityStatus === 'VERIFIED' ? 'مؤكدة' : 'غير محددة'}
              />
              <VerifRow
                label="قراءة الرسائل"
                status={detailedResult.messageAccessStatus === 'AVAILABLE' ? 'ok' : 'fail'}
                value={detailedResult.messageAccessStatus === 'AVAILABLE'
                  ? `متاحة (${detailedResult.messageCount} رسالة)`
                  : 'غير متاحة'}
              />
              <VerifRow
                label="رسالة Transaction"
                status={detailedResult.transactionSampleStatus === 'FOUND' ? 'ok' : 'warn'}
                value={detailedResult.transactionSampleStatus === 'FOUND'
                  ? 'موجودة'
                  : 'غير موجودة حالياً'}
              />
              <VerifRow
                label="Parser"
                status={
                  detailedResult.parserStatus === 'PASSED' ? 'ok'
                  : detailedResult.parserStatus === 'NOT_TESTED' ? 'warn'
                  : 'fail'
                }
                value={
                  detailedResult.parserStatus === 'PASSED' ? 'ناجح'
                  : detailedResult.parserStatus === 'NOT_TESTED' ? 'لم يُختبر'
                  : 'فشل'
                }
              />
              {/* ملخص تصنيف الرسائل */}
              <View className="mt-1 pt-2 border-t border-border">
                <Text className="text-xs text-muted-foreground">
                  تصنيف الرسائل: {detailedResult.classificationSummary.transaction} معاملات •{' '}
                  {detailedResult.classificationSummary.balance} رصيد •{' '}
                  {detailedResult.classificationSummary.otherFinancial} مالية أخرى •{' '}
                  {detailedResult.classificationSummary.nonFinancial} غير مالية
                </Text>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Dialog تأكيد الاختيار */}
      <Dialog open={selectedSource !== null} onOpenChange={(open) => !open && setSelectedSource(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تأكيد توثيق المصدر</DialogTitle>
            <DialogDescription>
              اختر طريقة الدفع المرتبطة بهذا المُرسِل.
            </DialogDescription>
          </DialogHeader>
          {selectedSource && (
            <View className="gap-3">
              {/* معلومات المصدر */}
              <View className="p-3 border border-border rounded-xl bg-muted gap-2">
                <View className="flex-row items-center gap-2">
                  <Smartphone size={16} color="#6b7280" />
                  <Text className="text-sm font-semibold text-foreground flex-1" numberOfLines={1}>
                    {selectedSource.displayName}
                  </Text>
                </View>
                <Text className="text-xs font-mono text-muted-foreground">
                  هوية تقنية: {selectedSource.sourceId}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {selectedSource.messageCount} رسالة • آخر رسالة: {formatDate(selectedSource.lastMessageAt)}
                </Text>
              </View>

              <Text className="text-sm font-medium text-foreground">طريقة الدفع المرتبطة</Text>
              <View className="flex-row flex-wrap gap-2">
                {PROVIDERS.filter((p) => p.key !== 'all').map((p) => (
                  <Pressable
                    key={p.key}
                    onPress={() => setSelectedSourceProvider(p.key as ProviderName)}
                    className={cn(
                      'px-3 py-1.5 rounded-full border border-border active:opacity-70',
                      selectedSourceProvider === p.key ? 'bg-primary border-primary' : 'bg-card'
                    )}
                  >
                    <Text className={cn('text-xs', selectedSourceProvider === p.key ? 'text-primary-foreground' : 'text-foreground')}>
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {selectedSource.providerHint !== 'unknown' &&
                selectedSourceProvider !== selectedSource.providerHint && (
                  <Alert icon={HelpCircle} variant="destructive">
                    <AlertTitle>تنبيه</AlertTitle>
                    <AlertDescription>
                      المزود المكتشف تلقائياً هو {PROVIDER_LABELS[selectedSource.providerHint]}.
                      تأكد من اختيار المزود الصحيح.
                    </AlertDescription>
                  </Alert>
                )}
            </View>
          )}
          <DialogFooter>
            <Pressable
              onPress={() => setSelectedSource(null)}
              className="px-4 py-2.5 rounded-xl border border-border active:opacity-70"
            >
              <Text className="text-sm font-medium text-foreground">إلغاء</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                selectedSource && selectedSourceProvider &&
                verifyAndSave(selectedSource, selectedSourceProvider)
              }
              disabled={verifying || !selectedSourceProvider}
              className="px-4 py-2.5 rounded-xl bg-primary active:opacity-70 disabled:opacity-50"
            >
              {verifying
                ? <ActivityIndicator size="small" color="#ffffff" />
                : <Text className="text-sm font-semibold text-primary-foreground">توثيق</Text>}
            </Pressable>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </View>
  );
}

// ─── VerifRow Component ───────────────────────────────────────────────────────

function VerifRow({ label, status, value }: { label: string; status: 'ok' | 'warn' | 'fail'; value: string }) {
  const colors = { ok: '#16a34a', warn: '#d97706', fail: '#ef4444' };
  const icons = { ok: '✓', warn: '⚠', fail: '✗' };
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <View className="flex-row items-center gap-1">
        <Text style={{ color: colors[status], fontSize: 11, fontWeight: '700' }}>{icons[status]}</Text>
        <Text style={{ color: colors[status] }} className="text-xs font-medium">{value}</Text>
      </View>
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseProviderParam(value?: string): ProviderName | 'all' {
  const allowed: (ProviderName | 'all')[] = ['all', 'vodafone_cash', 'orange_cash', 'insta_pay', 'bank_transfer'];
  if (value && allowed.includes(value as ProviderName | 'all')) return value as ProviderName | 'all';
  return 'all';
}

function scoreSource(source: SmsSource, filter: ProviderName | 'all'): number {
  let score = 0;
  if (source.providerHint !== 'unknown') score += 50;
  if (filter !== 'all' && source.providerHint === filter) score += 40;
  score += Math.min(source.messageCount, 20);
  const body = source.lastMessageSummary.toLowerCase();
  const kws = ['مبلغ', 'محفظة', 'رصيد', 'عملية', 'تحويل', 'تم استلام', 'فودافون', 'أورانج', 'instapay', 'bank'];
  for (const kw of kws) { if (body.includes(kw)) score += 3; }
  return score;
}

function getLikelihood(score: number, hint: ProviderName): 'high' | 'medium' | 'low' {
  if (hint !== 'unknown' && score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
