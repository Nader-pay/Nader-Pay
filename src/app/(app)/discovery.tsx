import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openSettings } from 'expo-linking';
import {
  ArrowLeft,
  Bell,
  BellOff,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
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
  verifySourceWithParser,
} from '@/services/sourceDiscovery';
import { upsertProviderSource, type ProviderSource } from '@/services/providerSourceService';
import type { ProviderName } from '@/types/agent';
import {
  KNOWN_PAYMENT_APPS,
  saveNotificationSource,
  getNotificationSourcesForProvider,
  revokeNotificationSource,
  type NotificationSource,
} from '@/services/notificationSourceService';

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
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const [manualSourceId, setManualSourceId] = useState('');
  const [manualProvider, setManualProvider] = useState<ProviderName>('vodafone_cash');
  const [manualLoading, setManualLoading] = useState(false);

  // ── Source Messages Viewer ────────────────────────────────────────────────
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);

  // ── Notification Source state ─────────────────────────────────────────────
  const [notifSources, setNotifSources] = useState<NotificationSource[]>([]);
  const [notifSaving, setNotifSaving] = useState<string | null>(null); // packageId جاري الحفظ

  const loadNotifSources = useCallback(async () => {
    try {
      const all: NotificationSource[] = [];
      for (const prov of ['vodafone_cash', 'insta_pay', 'orange_cash', 'bank_transfer']) {
        const rows = await getNotificationSourcesForProvider(prov);
        all.push(...rows);
      }
      setNotifSources(all);
    } catch {
      /* silent */
    }
  }, []);

  const toggleNotifSource = useCallback(async (
    packageId: string,
    displayName: string,
    provider: string,
    existing: NotificationSource | undefined
  ) => {
    setNotifSaving(packageId);
    try {
      if (existing) {
        await revokeNotificationSource(existing.id);
      } else {
        const now = new Date().toISOString();
        await saveNotificationSource({
          providerId: provider,
          packageId,
          displayName,
          sourceType: 'notification',
          status: 'verified',
          verifiedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      await loadNotifSources();
    } finally {
      setNotifSaving(null);
    }
  }, [loadNotifSources]);

  const checkPermission = useCallback(async () => {
    if (process.env.EXPO_OS === 'web') {
      setPermissionGranted(false);
      return;
    }
    const granted = await checkSmsPermission();
    setPermissionGranted(granted);
  }, []);

  const loadSources = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const discovered = await discoverSmsSources();
      setSources(discovered);
      setVerifyResult(null);
    } catch (err) {
      setVerifyResult({
        ok: false,
        message: err instanceof Error ? err.message : 'فشل قراءة رسائل الجهاز',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      checkPermission();
      loadNotifSources();
    }, [checkPermission, loadNotifSources])
  );

  useEffect(() => {
    if (permissionGranted === true) {
      loadSources();
    }
  }, [permissionGranted, loadSources]);

  const requestAccess = async () => {
    if (process.env.EXPO_OS === 'web') {
      setPermissionRequested(true);
      setPermissionGranted(false);
      return;
    }
    setPermissionRequested(true);
    const granted = await requestSmsPermission();
    await checkPermission();
    if (granted) {
      await loadSources();
    }
  };

  const openAppSettings = async () => {
    if (process.env.EXPO_OS === 'web') return;
    await openSettings();
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSources(false);
  }, [loadSources]);

  const filteredSources = useMemo(() => {
    const filtered = filter === 'all' ? sources : sources.filter((s) => s.providerHint === filter);
    return filtered
      .map((s) => ({ ...s, score: scoreSource(s, filter) }))
      .sort((a, b) => b.score - a.score);
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
    setVerifying(false);
    setSelectedSource(null);
    setVerifyResult({ ok: result.passed, message: result.reason });
  };

  const handleManualAdd = async () => {
    const sourceId = manualSourceId.trim();
    if (!sourceId) return;
    setManualLoading(true);
    try {
      const normalized = sourceId.toLowerCase().replace(/\s+/g, '');
      const matching = sources.find((s) => s.sourceId.toLowerCase().replace(/\s+/g, '') === normalized);
      if (matching) {
        await verifyAndSave(matching, manualProvider);
      } else {
        const now = new Date().toISOString();
        const id = createHash(`${manualProvider}:${sourceId}`);
        const newSource: ProviderSource = {
          id,
          providerId: manualProvider,
          providerName: PROVIDER_LABELS[manualProvider],
          sourceId,
          sourceType: 'sms',
          sourceMetadata: { manuallyAdded: true },
          parserVersion: '1',
          receivingAccount: null,
          approvedSenderIdentifiers: [sourceId],
          messagePatterns: [],
          verified: false,
          enabled: true,
          status: 'selected',
          lastMessageAt: null,
          lastMessageSummary: null,
          lastVerificationAt: null,
          lastVerificationResult: 'لم تُعثر على رسائل مطابقة لهذا المصدر. عند استلام رسائل سيتم إعادة التوثيق.',
          createdAt: now,
          updatedAt: now,
        };
        await upsertProviderSource(newSource);
        setVerifyResult({
          ok: true,
          message: 'تم إضافة المصدر يدوياً بحالة «مختار». سيتم التوثيق تلقائياً عند استلام رسائل منه.',
        });
      }
      setManualSourceId('');
    } catch (err) {
      setVerifyResult({
        ok: false,
        message: err instanceof Error ? err.message : 'فشل إضافة المصدر',
      });
    } finally {
      setManualLoading(false);
    }
  };

  const renderItem = ({ item: source }: { item: SmsSource & { score: number } }) => {
    const likelihood = getLikelihood(source.score, source.providerHint);
    const provider = source.providerHint === 'unknown' ? null : source.providerHint;
    const isExpanded = expandedSourceId === source.sourceId;
    return (
      <View className="border border-border rounded-2xl bg-card overflow-hidden gap-0">
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
                {provider && (
                  <Text className="text-xs text-muted-foreground">{PROVIDER_LABELS[provider]}</Text>
                )}
              </View>
            </View>
            <View className="flex-row items-center gap-1 shrink-0">
              <View
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: LIKELIHOOD_LABELS[likelihood].color }}
              />
              <Text className="text-xs text-muted-foreground">{LIKELIHOOD_LABELS[likelihood].label}</Text>
            </View>
          </View>
          <Text className="text-sm text-foreground leading-5" numberOfLines={2}>
            {source.lastMessageSummary}
          </Text>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <Text className="text-xs text-muted-foreground">{source.messageCount} رسالة</Text>
              <Text className="text-xs text-muted-foreground">{formatDate(source.lastMessageAt)}</Text>
            </View>
            {/* زر عرض عينة الرسائل */}
            <Pressable
              onPress={() => setExpandedSourceId(isExpanded ? null : source.sourceId)}
              className="flex-row items-center gap-1 px-2.5 py-1 rounded-full bg-muted active:opacity-70"
              hitSlop={8}
            >
              <MessageSquare size={12} color="#6b7280" />
              <Text className="text-xs text-muted-foreground">
                {isExpanded ? 'إخفاء' : 'الرسائل'}
              </Text>
              {isExpanded
                ? <ChevronUp size={11} color="#6b7280" />
                : <ChevronDown size={11} color="#6b7280" />}
            </Pressable>
          </View>
        </Pressable>

        {/* عرض عينة الرسائل */}
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
        keyboardVerticalOffset={0}
      >
        <View className="flex-1 px-5">
          <View className="flex-row items-center gap-2 py-5">
            <Pressable
              onPress={() => router.back()}
              className="w-10 h-10 items-center justify-center border border-border rounded-full active:opacity-70"
            >
              <ArrowLeft size={20} color="#6b7280" />
            </Pressable>
            <View className="flex-1">
              <Text className="text-2xl font-bold text-foreground">اكتشاف مصادر SMS</Text>
              <Text className="text-xs text-muted-foreground">استعرض واختر مصادر الرسائل المالية الموثوقة</Text>
            </View>
          </View>

          {permissionGranted === false && (
            <Alert icon={ShieldAlert} variant="destructive" className="mb-4">
              <AlertTitle>صلاحية قراءة SMS مطلوبة</AlertTitle>
              <AlertDescription>
                {permissionRequested
                  ? 'تم رفض الصلاحية. يرجى تفعيل صلاحية SMS من إعدادات التطبيق لمواصلة الاكتشاف.'
                  : 'يحتاج التطبيق إلى صلاحية قراءة SMS لاستعراض مصادر الرسائل المالية واختيارها.'}
              </AlertDescription>
              <View className="flex-row gap-2 mt-3 pl-6">
                <Pressable
                  onPress={permissionRequested ? openAppSettings : requestAccess}
                  className="flex-row items-center gap-2 px-3 py-2 rounded-lg bg-primary active:opacity-70"
                >
                  {permissionRequested ? <Settings size={16} color="#ffffff" /> : <Smartphone size={16} color="#ffffff" />}
                  <Text className="text-sm font-semibold text-primary-foreground">
                    {permissionRequested
                      ? process.env.EXPO_OS === 'web'
                        ? 'يتطلب Android'
                        : 'فتح الإعدادات'
                      : 'منح الصلاحية'}
                  </Text>
                </Pressable>
              </View>
            </Alert>
          )}

          {permissionGranted === true && (
            <>
              <View className="mb-4">
                <Text className="text-sm font-medium text-foreground mb-2">تصفية حسب المزود</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
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
                  {filteredSources.length} مصدر • {sources.length} إجمالي
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
                  <Text className="text-sm text-muted-foreground">جاري قراءة رسائل الجهاز...</Text>
                </View>
              ) : (
                <FlatList
                  data={filteredSources}
                  keyExtractor={(item) => item.sourceId}
                  renderItem={renderItem}
                  contentContainerClassName="gap-3 pb-4"
                  contentInsetAdjustmentBehavior="automatic"
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  ListEmptyComponent={
                    <View className="items-center py-12 gap-3">
                      <Search size={40} color="#d1d5db" />
                      <Text className="text-base font-medium text-foreground">لم يُعثر على مصادر</Text>
                      <Text className="text-sm text-muted-foreground text-center">
                        {filter === 'all'
                          ? 'لا توجد رسائل مالية مكتشفة في الجهاز. حاول إضافة مصدر يدويًا.'
                          : `لا توجد رسائل مطابقة لـ ${PROVIDERS.find((p) => p.key === filter)?.label}.`}
                      </Text>
                    </View>
                  }
                />
              )}

              <View className="py-4 border-t border-border gap-3">
                <Text className="text-sm font-medium text-foreground">إضافة مصدر يدويًا</Text>
                <View className="flex-row gap-2">
                  <TextInput
                    value={manualSourceId}
                    onChangeText={setManualSourceId}
                    placeholder="رقم أو معرّف المرسل"
                    placeholderTextColor="#9ca3af"
                    className="flex-1 px-4 py-3 border border-border rounded-xl bg-card text-foreground text-sm"
                    textAlign="right"
                    returnKeyType="done"
                    onSubmitEditing={handleManualAdd}
                  />
                  <Pressable
                    onPress={handleManualAdd}
                    disabled={manualLoading || !manualSourceId.trim()}
                    className="px-4 items-center justify-center rounded-xl bg-primary active:opacity-70 disabled:opacity-50"
                  >
                    {manualLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <Plus size={20} color="#ffffff" />}
                  </Pressable>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                  {PROVIDERS.filter((p) => p.key !== 'all').map((p) => (
                    <Pressable
                      key={p.key}
                      onPress={() => setManualProvider(p.key as ProviderName)}
                      className={cn(
                        'px-3 py-1.5 rounded-full border border-border active:opacity-70',
                        manualProvider === p.key ? 'bg-primary border-primary' : 'bg-card'
                      )}
                    >
                      <Text className={cn('text-xs', manualProvider === p.key ? 'text-primary-foreground' : 'text-foreground')}>
                        {p.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            </>
          )}

          {verifyResult && (
            <Alert
              icon={verifyResult.ok ? CheckCircle2 : XCircle}
              variant={verifyResult.ok ? 'default' : 'destructive'}
              className="mb-4"
            >
              <AlertTitle>{verifyResult.ok ? 'تم بنجاح' : 'تنبيه'}</AlertTitle>
              <AlertDescription>{verifyResult.message}</AlertDescription>
            </Alert>
          )}

          {/* ── قسم مصادر الإشعارات ─────────────────────────────────────── */}
          {process.env.EXPO_OS !== 'web' && (
            <View className="py-4 border-t border-border gap-3 mb-4">
              <View className="flex-row items-center gap-2">
                <Bell size={16} color="#6b7280" />
                <Text className="text-sm font-semibold text-foreground">
                  مصادر الإشعارات (InstaPay / تطبيقات الدفع)
                </Text>
              </View>
              <Text className="text-xs text-muted-foreground leading-5">
                اختر التطبيقات التي ستستقبل منها إشعارات الدفع. يُحفظ الـ Package ID الحقيقي
                ولا يُستخدم اسم التطبيق الظاهر فقط.
              </Text>

              <View className="gap-2">
                {KNOWN_PAYMENT_APPS.map((app) => {
                  const existing = notifSources.find((s) => s.packageId === app.packageId);
                  const isActive = existing?.status === 'verified';
                  const isBusy   = notifSaving === app.packageId;

                  return (
                    <View
                      key={app.packageId}
                      className="flex-row items-center justify-between px-4 py-3 rounded-xl border border-border bg-card"
                    >
                      <View className="flex-row items-center gap-3 flex-1 min-w-0">
                        <View
                          className="w-8 h-8 rounded-full items-center justify-center"
                          style={{ backgroundColor: isActive ? '#f0fdf4' : '#f3f4f6' }}
                        >
                          {isActive
                            ? <ShieldCheck size={16} color="#16a34a" />
                            : <BellOff    size={16} color="#9ca3af" />
                          }
                        </View>
                        <View className="flex-1 min-w-0">
                          <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                            {app.displayName}
                          </Text>
                          <Text className="text-xs text-muted-foreground font-mono" numberOfLines={1}>
                            {app.packageId}
                          </Text>
                        </View>
                      </View>

                      <Pressable
                        onPress={() => toggleNotifSource(app.packageId, app.displayName, app.provider, existing)}
                        disabled={isBusy}
                        className={cn(
                          'flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg border active:opacity-70 disabled:opacity-40',
                          isActive
                            ? 'border-red-200 bg-red-50'
                            : 'border-primary bg-primary'
                        )}
                      >
                        {isBusy ? (
                          <ActivityIndicator size={13} color={isActive ? '#dc2626' : '#ffffff'} />
                        ) : isActive ? (
                          <Trash2 size={13} color="#dc2626" />
                        ) : (
                          <Plus size={13} color="#ffffff" />
                        )}
                        <Text
                          className="text-xs font-semibold"
                          style={{ color: isActive ? '#dc2626' : '#ffffff' }}
                        >
                          {isActive ? 'إلغاء التوثيق' : 'توثيق'}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>

              {notifSources.filter((s) => s.status === 'verified').length > 0 && (
                <View className="flex-row items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
                  <CheckCircle2 size={14} color="#16a34a" />
                  <Text className="text-xs text-green-700">
                    {notifSources.filter((s) => s.status === 'verified').length} مصدر إشعار موثوق نشط
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      <Dialog open={selectedSource !== null} onOpenChange={(open) => !open && setSelectedSource(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تأكيد اختيار المصدر</DialogTitle>
            <DialogDescription>راجع المصدر قبل بدء التوثيق التلقائي.</DialogDescription>
          </DialogHeader>
          {selectedSource && (
            <View className="gap-3">
              <View className="p-3 border border-border rounded-xl bg-muted gap-2">
                <Text className="text-sm font-medium text-foreground">{selectedSource.displayName}</Text>
                <Text className="text-xs text-muted-foreground">{selectedSource.lastMessageSummary}</Text>
                <Text className="text-xs text-muted-foreground">
                  {selectedSource.messageCount} رسالة • آخر رسالة: {formatDate(selectedSource.lastMessageAt)}
                </Text>
              </View>
              <Text className="text-sm font-medium text-foreground">المزود المرتبط</Text>
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
                    <Text
                      className={cn(
                        'text-xs',
                        selectedSourceProvider === p.key ? 'text-primary-foreground' : 'text-foreground'
                      )}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {selectedSource.providerHint !== 'unknown' && selectedSourceProvider !== selectedSource.providerHint && (
                <Alert icon={HelpCircle} variant="destructive">
                  <AlertTitle>تنبيه</AlertTitle>
                  <AlertDescription>
                    المزود المكتشف تلقائياً هو {PROVIDER_LABELS[selectedSource.providerHint]}. اختر المزود الصحيح لتجنب
                    الرفض لاحقًا.
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
              onPress={() => selectedSource && selectedSourceProvider && verifyAndSave(selectedSource, selectedSourceProvider)}
              disabled={verifying || !selectedSourceProvider}
              className="px-4 py-2.5 rounded-xl bg-primary active:opacity-70 disabled:opacity-50"
            >
              {verifying ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text className="text-sm font-semibold text-primary-foreground">تأكيد وتوثيق</Text>
              )}
            </Pressable>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </View>
  );
}

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
  const financialKeywords = ['مبلغ', 'محفظة', 'رصيد', 'عملية', 'تحويل', 'تم استلام', 'فودافون', 'أورانج', 'instapay', 'bank'];
  for (const kw of financialKeywords) {
    if (body.includes(kw.toLowerCase())) score += 3;
  }
  return score;
}

function getLikelihood(score: number, providerHint: ProviderName): 'high' | 'medium' | 'low' {
  if (providerHint !== 'unknown' || score > 40) return 'high';
  if (score > 15) return 'medium';
  return 'low';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
