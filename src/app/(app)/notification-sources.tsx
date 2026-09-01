/**
 * notification-sources.tsx — اكتشاف تطبيقات الإشعارات وتوثيقها
 * ═══════════════════════════════════════════════════════════════════
 * نطاق هذه الشاشة: تطبيقات الإشعارات فقط.
 * لا تحتوي على أي SMS — ذلك في شاشة discovery.tsx المستقلة.
 *
 * السيناريو:
 * 1. فحص حالة Notification Listener Permission
 * 2. قراءة التطبيقات المثبتة من PackageManager (كل التطبيقات — ليس financial filter فقط)
 * 3. عرض كل تطبيق مع: displayName + packageId + installStatus + listenerStatus
 * 4. اختيار التطبيق → dialog اختيار Provider → حفظ packageId كمصدر موثوق
 * 5. إضافة يدوية للتطبيقات التي لا يعرفها PackageManager
 * ═══════════════════════════════════════════════════════════════════
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Bell,
  BellOff,
  CheckCircle2,
  Info,
  PlusCircle,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  XCircle,
} from 'lucide-react-native';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  discoverInstalledPaymentApps,
  diagnosePackageManager,
  getAllNotificationSources,
  getNotificationListenerState,
  openNotificationListenerSettings,
  revokeNotificationSource,
  saveNotificationSource,
  type InstalledApp,
  type NotificationListenerState,
  type NotificationSource,
  type NotificationSourceStatus,
  type PackageManagerDiagnostic,
} from '@/services/notificationSourceService';
import type { ProviderName } from '@/types/agent';

// ─── Types ─────────────────────────────────────────────────────────────────────

type AppRow = InstalledApp & {
  savedSource: NotificationSource | undefined;
  isActive: boolean;
};

const PROVIDERS: { key: ProviderName; label: string }[] = [
  { key: 'vodafone_cash', label: 'Vodafone Cash' },
  { key: 'orange_cash',   label: 'Orange Cash' },
  { key: 'insta_pay',     label: 'InstaPay' },
  { key: 'bank_transfer', label: 'تحويل بنكي' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationSourcesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [listenerState, setListenerState] = useState<NotificationListenerState>('unknown');
  const [installedApps, setInstalledApps] = useState<AppRow[]>([]);
  const [savedSources, setSavedSources] = useState<NotificationSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingPkg, setSavingPkg] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<NotificationSource | null>(null);
  const [pkgDiagnostic, setPkgDiagnostic] = useState<PackageManagerDiagnostic | null>(null);

  // Provider selection dialog
  const [providerDialogRow, setProviderDialogRow] = useState<AppRow | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('insta_pay');

  // Manual add dialog
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [manualPackage, setManualPackage] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualProvider, setManualProvider] = useState<ProviderName>('insta_pay');

  // ─── Load ────────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setFeedback(null);
    try {
      const [state, apps, sources, diag] = await Promise.all([
        getNotificationListenerState(),
        discoverInstalledPaymentApps(),
        getAllNotificationSources(),
        diagnosePackageManager(),
      ]);

      setListenerState(state);
      setSavedSources(sources);
      setPkgDiagnostic(diag);

      // دمج التطبيقات المثبتة مع المصادر المحفوظة
      const rows: AppRow[] = apps.map((app) => {
        const saved = sources.find((s) => s.packageId === app.packageName);
        return {
          ...app,
          savedSource: saved,
          isActive: saved !== undefined &&
            ['verified', 'selected', 'permission_required'].includes(saved.status),
        };
      });

      // إضافة المصادر المحفوظة التي لم تُوجَد في التطبيقات المثبتة
      const pkgsInRows = new Set(rows.map((r) => r.packageName));
      for (const src of sources) {
        if (!pkgsInRows.has(src.packageId)) {
          rows.push({
            packageName: src.packageId,
            displayName: src.displayName,
            savedSource: src,
            isActive: ['verified', 'selected'].includes(src.status),
          });
        }
      }

      rows.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return a.displayName.localeCompare(b.displayName, 'ar');
      });

      setInstalledApps(rows);
    } catch (err) {
      setFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'فشل تحميل التطبيقات المثبتة',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAll(false);
  }, [loadAll]);

  // ─── Actions ──────────────────────────────────────────────────────────────────

  const handleToggle = useCallback((row: AppRow) => {
    if (row.isActive && row.savedSource) {
      setRevokeTarget(row.savedSource);
      return;
    }
    // فتح dialog اختيار Provider
    setSelectedProvider('insta_pay');
    setProviderDialogRow(row);
  }, []);

  const confirmSaveWithProvider = useCallback(async () => {
    const row = providerDialogRow;
    if (!row) return;
    setProviderDialogRow(null);
    setSavingPkg(row.packageName);
    setFeedback(null);
    try {
      const now = new Date().toISOString();
      const currentState = await getNotificationListenerState();
      const status: NotificationSourceStatus =
        currentState === 'enabled' ? 'verified' : 'permission_required';

      await saveNotificationSource({
        providerId: selectedProvider,
        packageId: row.packageName,
        displayName: row.displayName,
        sourceType: 'notification',
        status,
        notificationListenerEnabled: currentState === 'enabled',
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      setFeedback({
        ok: true,
        message: currentState === 'enabled'
          ? `✓ تم توثيق ${row.displayName} كمصدر إشعارات موثوق (${PROVIDERS.find(p => p.key === selectedProvider)?.label}).`
          : `تم حفظ ${row.displayName}. فعّل Notification Listener للاستقبال الفعلي.`,
      });
      await loadAll(false);
    } catch (err) {
      setFeedback({
        ok: false,
        message: err instanceof Error ? err.message : `فشل توثيق ${row.displayName}`,
      });
    } finally {
      setSavingPkg(null);
    }
  }, [providerDialogRow, selectedProvider, loadAll]);

  const confirmRevoke = useCallback(async () => {
    if (!revokeTarget) return;
    setSavingPkg(revokeTarget.packageId);
    setRevokeTarget(null);
    try {
      await revokeNotificationSource(revokeTarget.id);
      setFeedback({ ok: true, message: `تم إلغاء توثيق ${revokeTarget.displayName}.` });
      await loadAll(false);
    } catch {
      setFeedback({ ok: false, message: 'فشل إلغاء التوثيق. حاول مجدداً.' });
    } finally {
      setSavingPkg(null);
    }
  }, [revokeTarget, loadAll]);

  const handleOpenSettings = useCallback(async () => {
    await openNotificationListenerSettings();
    setTimeout(() => loadAll(false), 600);
  }, [loadAll]);

  const handleManualAdd = useCallback(async () => {
    const pkg = manualPackage.trim();
    const name = manualName.trim() || pkg;
    if (!pkg) return;
    setManualAddOpen(false);
    setSavingPkg(pkg);
    setFeedback(null);
    try {
      const now = new Date().toISOString();
      const currentState = await getNotificationListenerState();
      const status: NotificationSourceStatus =
        currentState === 'enabled' ? 'verified' : 'permission_required';

      await saveNotificationSource({
        providerId: manualProvider,
        packageId: pkg,
        displayName: name,
        sourceType: 'notification',
        status,
        notificationListenerEnabled: currentState === 'enabled',
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      setManualPackage('');
      setManualName('');
      setFeedback({ ok: true, message: `✓ تم إضافة ${name} يدوياً كمصدر إشعارات.` });
      await loadAll(false);
    } catch (err) {
      setFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'فشل الإضافة اليدوية.',
      });
    } finally {
      setSavingPkg(null);
    }
  }, [manualPackage, manualName, manualProvider, loadAll]);

  // ─── Render Item ──────────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item: row }: { item: AppRow }) => {
    const isBusy = savingPkg === row.packageName;
    const statusLabel = getStatusLabel(row, listenerState);

    return (
      <View
        className={cn(
          'border rounded-2xl bg-card overflow-hidden',
          row.isActive ? 'border-primary/30' : 'border-border',
        )}
        style={{ borderCurve: 'continuous' } as object}
      >
        <View className="p-4 gap-3">
          <View className="flex-row items-center gap-3">
            <View
              className="w-10 h-10 rounded-full items-center justify-center shrink-0"
              style={{ backgroundColor: row.isActive ? '#f0fdf4' : '#f3f4f6' }}
            >
              {row.isActive
                ? <ShieldCheck size={20} color="#16a34a" />
                : <Smartphone size={20} color="#9ca3af" />}
            </View>
            <View className="flex-1 min-w-0 gap-0.5">
              <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                {row.displayName}
              </Text>
              <Text className="text-xs text-muted-foreground font-mono" numberOfLines={1}>
                {row.packageName}
              </Text>
              {row.savedSource && (
                <Text className="text-xs text-muted-foreground">
                  {PROVIDERS.find(p => p.key === row.savedSource?.providerId)?.label ?? row.savedSource.providerId}
                </Text>
              )}
            </View>

            <Pressable
              onPress={() => handleToggle(row)}
              disabled={isBusy}
              className={cn(
                'flex-row items-center gap-1.5 px-3 py-2 rounded-xl active:opacity-70 disabled:opacity-50',
                row.isActive ? 'bg-destructive/10 border border-destructive/20' : 'bg-primary'
              )}
            >
              {isBusy
                ? <ActivityIndicator size="small" color={row.isActive ? '#ef4444' : '#ffffff'} />
                : row.isActive
                  ? <Trash2 size={14} color="#ef4444" />
                  : <Bell size={14} color="#ffffff" />}
              <Text className={cn(
                'text-xs font-semibold',
                row.isActive ? 'text-destructive' : 'text-primary-foreground'
              )}>
                {row.isActive ? 'إلغاء' : 'توثيق'}
              </Text>
            </Pressable>
          </View>

          <View className="flex-row items-center gap-2">
            <View className="w-2 h-2 rounded-full" style={{ backgroundColor: statusLabel.color }} />
            <Text className="text-xs text-muted-foreground flex-1">{statusLabel.text}</Text>
          </View>
        </View>
      </View>
    );
  }, [savingPkg, listenerState, handleToggle]);

  // ─── Empty State ──────────────────────────────────────────────────────────────

  const emptyDiagnosticText = (): string => {
    if (process.env.EXPO_OS === 'web') return 'الاكتشاف يعمل على Android فقط.';
    if (pkgDiagnostic === 'NO_NATIVE_MODULE')
      return 'NativeModule غير متاح — لا يستطيع التطبيق قراءة التطبيقات المثبتة. استخدم "إضافة يدوي" لإضافة تطبيق بـ Package ID.';
    if (pkgDiagnostic === 'PERMISSION_ERROR')
      return 'خطأ صلاحية عند قراءة PackageManager. تأكد من إعدادات التطبيق.';
    if (pkgDiagnostic === 'EMPTY_RESULT')
      return 'PackageManager أعاد 0 تطبيقات — قد يكون التصفية تمنع ظهور التطبيقات. استخدم "إضافة يدوي".';
    return 'لا توجد تطبيقات مكتشفة. استخدم "إضافة يدوي" لإضافة تطبيق بـ Package ID.';
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  const activeCount = installedApps.filter((r) => r.isActive).length;

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
            <Text className="text-2xl font-bold text-foreground">مصادر الإشعارات</Text>
            <Text className="text-xs text-muted-foreground">
              {activeCount > 0
                ? `${activeCount} تطبيق موثَّق`
                : 'اختر تطبيقات الدفع التي تستقبل منها إشعارات'}
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            {/* زر إضافة يدوي */}
            <Pressable
              onPress={() => { setManualPackage(''); setManualName(''); setManualProvider('insta_pay'); setManualAddOpen(true); }}
              className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-card active:opacity-70"
            >
              <PlusCircle size={15} color="#6b7280" />
              <Text className="text-xs text-foreground">إضافة</Text>
            </Pressable>
            <Pressable
              onPress={() => loadAll(false)}
              disabled={loading || refreshing}
              className="w-10 h-10 items-center justify-center border border-border rounded-full active:opacity-70 disabled:opacity-40"
            >
              <RefreshCw size={18} color="#6b7280" />
            </Pressable>
          </View>
        </View>

        {/* بطاقة حالة Notification Listener */}
        {listenerState === 'disabled' && (
          <View
            className="flex-row items-center gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200 mb-4"
            style={{ borderCurve: 'continuous' } as object}
          >
            <BellOff size={20} color="#d97706" />
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-semibold text-amber-900">
                Notification Listener غير مفعّل
              </Text>
              <Text className="text-xs text-amber-700 leading-4">
                التطبيقات الموثَّقة لن ترسل إشعارات حتى تُفعّله.
              </Text>
            </View>
            <Pressable
              onPress={handleOpenSettings}
              className="flex-row items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 active:opacity-70"
            >
              <Settings size={14} color="#ffffff" />
              <Text className="text-xs font-semibold text-white">تفعيل</Text>
            </Pressable>
          </View>
        )}

        {listenerState === 'enabled' && activeCount > 0 && (
          <View
            className="flex-row items-center gap-3 p-4 rounded-2xl bg-green-50 border border-green-200 mb-4"
            style={{ borderCurve: 'continuous' } as object}
          >
            <ShieldCheck size={20} color="#16a34a" />
            <Text className="text-sm text-green-800 flex-1 leading-4">
              Notification Listener مفعّل ويستقبل إشعارات التطبيقات الموثَّقة.
            </Text>
          </View>
        )}

        {/* ملاحظة Web */}
        {process.env.EXPO_OS === 'web' && (
          <Alert icon={ShieldAlert} variant="destructive" className="mb-4">
            <AlertTitle>يتطلب Android</AlertTitle>
            <AlertDescription>
              اكتشاف تطبيقات الإشعارات يعمل على أجهزة Android فقط.
            </AlertDescription>
          </Alert>
        )}

        {/* نتيجة العملية */}
        {feedback && (
          <Alert
            icon={feedback.ok ? CheckCircle2 : XCircle}
            variant={feedback.ok ? 'default' : 'destructive'}
            className="mb-4"
          >
            <AlertTitle>{feedback.ok ? 'تم بنجاح' : 'خطأ'}</AlertTitle>
            <AlertDescription>{feedback.message}</AlertDescription>
          </Alert>
        )}

        {/* المحتوى الرئيسي */}
        {loading ? (
          <View className="flex-1 items-center justify-center gap-3">
            <ActivityIndicator size="large" />
            <Text className="text-sm text-muted-foreground">
              جاري قراءة التطبيقات المثبتة...
            </Text>
          </View>
        ) : (
          <FlatList
            data={installedApps}
            keyExtractor={(item) => item.packageName}
            renderItem={renderItem}
            contentContainerClassName="gap-3 pb-8"
            contentInsetAdjustmentBehavior="automatic"
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            ListEmptyComponent={
              <View className="items-center py-12 gap-4">
                <View className="w-16 h-16 rounded-full bg-muted items-center justify-center">
                  <Bell size={32} color="#d1d5db" />
                </View>
                <View className="items-center gap-2">
                  <Text className="text-base font-medium text-foreground">
                    لم يُعثر على تطبيقات
                  </Text>
                  <Text className="text-sm text-muted-foreground text-center leading-6 px-4">
                    {emptyDiagnosticText()}
                  </Text>
                </View>
                {/* زر إضافة يدوي في empty state */}
                <Pressable
                  onPress={() => { setManualPackage(''); setManualName(''); setManualProvider('insta_pay'); setManualAddOpen(true); }}
                  className="flex-row items-center gap-2 px-4 py-2.5 rounded-xl bg-primary active:opacity-70"
                >
                  <PlusCircle size={16} color="#ffffff" />
                  <Text className="text-sm font-semibold text-primary-foreground">إضافة تطبيق يدوياً</Text>
                </Pressable>
                {/* تشخيص PackageManager */}
                {pkgDiagnostic && pkgDiagnostic !== 'OK' && (
                  <View className="flex-row items-center gap-2 px-4 py-3 rounded-xl bg-muted mt-1 mx-2">
                    <Info size={14} color="#6b7280" />
                    <Text className="text-xs text-muted-foreground flex-1 leading-4">
                      تشخيص PackageManager: {pkgDiagnostic}
                    </Text>
                  </View>
                )}
              </View>
            }
            ListHeaderComponent={
              installedApps.length > 0 ? (
                <View className="flex-row items-center justify-between pb-1">
                  <Text className="text-sm text-muted-foreground">
                    {installedApps.length} تطبيق مكتشف
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {activeCount} موثَّق
                  </Text>
                </View>
              ) : null
            }
          />
        )}
      </View>

      {/* Dialog اختيار Provider عند التوثيق */}
      <Dialog open={providerDialogRow !== null} onOpenChange={(open) => !open && setProviderDialogRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ربط بطريقة الدفع</DialogTitle>
            <DialogDescription>
              اختر طريقة الدفع التي ترتبط بإشعارات هذا التطبيق.
            </DialogDescription>
          </DialogHeader>
          {providerDialogRow && (
            <View className="gap-3">
              <View className="p-3 border border-border rounded-xl bg-muted gap-1">
                <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                  {providerDialogRow.displayName}
                </Text>
                <Text className="text-xs font-mono text-muted-foreground" numberOfLines={1}>
                  {providerDialogRow.packageName}
                </Text>
              </View>
              <Text className="text-sm font-medium text-foreground">طريقة الدفع</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                {PROVIDERS.map((p) => (
                  <Pressable
                    key={p.key}
                    onPress={() => setSelectedProvider(p.key)}
                    className={cn(
                      'px-3 py-2 rounded-full border active:opacity-70',
                      selectedProvider === p.key ? 'bg-primary border-primary' : 'bg-card border-border'
                    )}
                  >
                    <Text className={cn(
                      'text-xs font-medium',
                      selectedProvider === p.key ? 'text-primary-foreground' : 'text-foreground'
                    )}>
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
          <DialogFooter>
            <Pressable
              onPress={() => setProviderDialogRow(null)}
              className="px-4 py-2.5 rounded-xl border border-border active:opacity-70"
            >
              <Text className="text-sm font-medium text-foreground">إلغاء</Text>
            </Pressable>
            <Pressable
              onPress={confirmSaveWithProvider}
              className="px-4 py-2.5 rounded-xl bg-primary active:opacity-70"
            >
              <Text className="text-sm font-semibold text-primary-foreground">توثيق</Text>
            </Pressable>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog إضافة يدوي */}
      <Dialog open={manualAddOpen} onOpenChange={(open) => !open && setManualAddOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إضافة تطبيق يدوياً</DialogTitle>
            <DialogDescription>
              أدخل Package ID للتطبيق الذي تريد ربط إشعاراته بطريقة دفع.
            </DialogDescription>
          </DialogHeader>
          <View className="gap-3">
            <View className="gap-1.5">
              <Text className="text-sm font-medium text-foreground">Package ID *</Text>
              <TextInput
                value={manualPackage}
                onChangeText={setManualPackage}
                placeholder="com.example.app"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                autoCorrect={false}
                className="border border-border rounded-xl px-3 py-2.5 text-sm text-foreground bg-background"
              />
            </View>
            <View className="gap-1.5">
              <Text className="text-sm font-medium text-foreground">اسم التطبيق (اختياري)</Text>
              <TextInput
                value={manualName}
                onChangeText={setManualName}
                placeholder="اسم التطبيق للعرض"
                placeholderTextColor="#9ca3af"
                className="border border-border rounded-xl px-3 py-2.5 text-sm text-foreground bg-background"
              />
            </View>
            <View className="gap-1.5">
              <Text className="text-sm font-medium text-foreground">طريقة الدفع</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                {PROVIDERS.map((p) => (
                  <Pressable
                    key={p.key}
                    onPress={() => setManualProvider(p.key)}
                    className={cn(
                      'px-3 py-2 rounded-full border active:opacity-70',
                      manualProvider === p.key ? 'bg-primary border-primary' : 'bg-card border-border'
                    )}
                  >
                    <Text className={cn(
                      'text-xs font-medium',
                      manualProvider === p.key ? 'text-primary-foreground' : 'text-foreground'
                    )}>
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
          <DialogFooter>
            <Pressable
              onPress={() => setManualAddOpen(false)}
              className="px-4 py-2.5 rounded-xl border border-border active:opacity-70"
            >
              <Text className="text-sm font-medium text-foreground">إلغاء</Text>
            </Pressable>
            <Pressable
              onPress={handleManualAdd}
              disabled={!manualPackage.trim()}
              className="px-4 py-2.5 rounded-xl bg-primary active:opacity-70 disabled:opacity-50"
            >
              <Text className="text-sm font-semibold text-primary-foreground">إضافة</Text>
            </Pressable>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog تأكيد إلغاء التوثيق */}
      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إلغاء توثيق التطبيق</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من إلغاء توثيق {revokeTarget?.displayName ?? ''}?{'\n'}
              لن يُستقبَل منه أي إشعار دفع بعد الإلغاء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onPress={() => setRevokeTarget(null)}>
              <Text>تراجع</Text>
            </AlertDialogCancel>
            <AlertDialogAction onPress={confirmRevoke} className="bg-destructive">
              <Text className="text-destructive-foreground">إلغاء التوثيق</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatusLabel(
  row: AppRow,
  listenerState: NotificationListenerState
): { text: string; color: string } {
  if (!row.isActive) {
    return { text: 'غير موثَّق — اضغط "توثيق" لإضافته', color: '#d1d5db' };
  }
  const status = row.savedSource?.status as NotificationSourceStatus | undefined;
  if (status === 'permission_required') {
    return { text: 'موثَّق — يحتاج تفعيل Notification Listener', color: '#f59e0b' };
  }
  if (listenerState === 'disabled') {
    return { text: 'موثَّق — Notification Listener غير مفعّل', color: '#f59e0b' };
  }
  if (status === 'verified') {
    return { text: 'موثَّق ويستقبل الإشعارات بنشاط', color: '#22c55e' };
  }
  return { text: 'محفوظ — في انتظار التحقق', color: '#94a3b8' };
}
