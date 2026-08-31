import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowRight,
  Battery,
  Bell,
  RefreshCw,
  Server,
  Smartphone,
  Wifi,
  MessageSquare,
  Activity,
  AlertCircle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Globe,
  Radio,
  Database,
  HardDrive,
  ShieldCheck,
  Loader2,
  CloudOff,
  CloudCog,
  CloudCheck,
} from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import { getActiveServerProfile } from '@/services/serverProfileManager';
import { getLastBackendRequestMeta } from '@/services/backendConnector';
import {
  getDatabaseStatus,
  getSyncStatus,
  getBackgroundStatus,
  computeSyncStatus,
} from '@/services/diagnosticsEngine';
import { getOfflineQueueCount } from '@/lib/database';
import type { ServerProfile } from '@/types/backend';

type DiagnosticState = 'ok' | 'warning' | 'error' | 'checking';

type StatusItem = {
  key: string;
  icon: React.ElementType;
  label: string;
  value: string;
  state: DiagnosticState;
  reason?: string;
  solution?: string;
};

export default function DiagnosticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, deviceState, runDiagnostics, triggerSync, scanSmsNow } = useAgent();
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [activeProfile, setActiveProfile] = useState<ServerProfile | null>(null);
  const [lastMeta, setLastMeta] = useState<ReturnType<typeof getLastBackendRequestMeta>>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // حالات حقيقية من diagnosticsEngine — لا fake
  const [dbStatus, setDbStatus] = useState<ReturnType<typeof getDatabaseStatus>>('READY');
  const [syncStatus, setSyncStatus] = useState<ReturnType<typeof getSyncStatus>>('SYNCED');
  const [bgStatus, setBgStatus] = useState<ReturnType<typeof getBackgroundStatus>>('STOPPED');
  const [pendingCount, setPendingCount] = useState(0);

  const d = state.diagnostics;

  useFocusEffect(
    useCallback(() => {
      runDiagnostics();
      (async () => {
        setActiveProfile(await getActiveServerProfile());
        setLastMeta(getLastBackendRequestMeta());
        // قراءة الحالات الحقيقية من diagnosticsEngine
        setDbStatus(getDatabaseStatus());
        const pending = await getOfflineQueueCount();
        setPendingCount(pending);
        const syncSt = computeSyncStatus(
          pending,
          state.connectionStatus === 'SYNCING',
          state.connectionStatus === 'ERROR'
        );
        setSyncStatus(syncSt);
        const bg = getBackgroundStatus();
        setBgStatus(d.backgroundAgent ? (bg === 'RESTRICTED' ? 'RESTRICTED' : 'RUNNING') : 'STOPPED');
      })();
    }, [runDiagnostics, state.connectionStatus, d.backgroundAgent])
  );

  const handleTestSync = async () => {
    setSyncing(true);
    try {
      await triggerSync();
    } finally {
      setSyncing(false);
    }
  };

  const handleTestScan = async () => {
    setScanning(true);
    try {
      await scanSmsNow();
    } finally {
      setScanning(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setTesting(true);
    try {
      await runDiagnostics();
      setActiveProfile(await getActiveServerProfile());
      setLastMeta(getLastBackendRequestMeta());
    } finally {
      setTesting(false);
    }
  };

  const systemItems: StatusItem[] = [
    {
      key: 'agent',
      icon: Activity,
      label: 'حالة الوكيل',
      value: (() => {
        const rt = d.runtimeStatus;
        if (!rt || rt === 'DISABLED') return 'معطل';
        if (rt === 'RUNNING') return 'يعمل';
        if (rt === 'DEGRADED') return 'يعمل (مخفض)';
        if (rt === 'STARTING') return 'جاري التشغيل';
        if (rt === 'RECONNECTING') return 'إعادة اتصال';
        if (rt === 'OFFLINE') return 'غير متصل';
        if (rt === 'ERROR') return 'خطأ';
        return d.agentRunning ? 'يعمل' : 'متوقف';
      })(),
      state: (() => {
        const rt = d.runtimeStatus;
        if (rt === 'RUNNING') return 'ok';
        if (rt === 'DEGRADED' || rt === 'RECONNECTING' || rt === 'STARTING') return 'warning';
        if (rt === 'ERROR' || rt === 'DISABLED') return 'error';
        if (rt === 'OFFLINE') return 'warning';
        return d.agentRunning ? 'ok' : 'error';
      })() as DiagnosticState,
      reason: d.runtimeReason ?? 'يتحكم في جلب الطلبات ومطابقة SMS.',
      solution: (() => {
        const rt = d.runtimeStatus;
        if (rt === 'RUNNING') return 'الوكيل يعمل بشكل طبيعي.';
        if (rt === 'DEGRADED') return 'يعمل بـ Polling — Realtime غير متصل. هذا طبيعي إذا انقطع الاتصال.';
        if (rt === 'RECONNECTING') return 'يحاول إعادة الاتصال تلقائياً...';
        if (rt === 'OFFLINE') return 'لا يوجد اتصال. سيستأنف تلقائياً عند العودة.';
        if (rt === 'ERROR') return `خطأ: ${d.runtimeReason ?? 'غير محدد'} — تحقق من Backend وإعدادات الخادم.`;
        if (rt === 'DISABLED') return 'انتقل إلى الشاشة الرئيسية وفعّل الوكيل.';
        return d.agentRunning ? 'الوكيل يعمل.' : 'انتقل إلى الإعدادات وفعّل الوكيل.';
      })(),
    },
    {
      key: 'network',
      icon: Wifi,
      label: 'الشبكة',
      value: d.network === 'ONLINE' ? 'متصل' : 'غير متصل',
      state: d.network === 'ONLINE' ? 'ok' : 'error',
      reason: 'الاتصال بالإنترنت مطلوب للمزامنة مع الخادم.',
      solution: d.network === 'ONLINE' ? 'الاتصال متوفر.' : 'تحقق من WiFi أو بيانات الجوال.',
    },
    {
      key: 'sms',
      icon: MessageSquare,
      label: 'قراءة SMS',
      value: d.smsReady ? 'جاهز' : 'لا يوجد إذن',
      state: d.smsReady ? 'ok' : 'error',
      reason: 'يحتاج الوكيل إذن قراءة الرسائل للعثور على إثبات الدفع.',
      solution: d.smsReady ? 'الإذن ممنوح.' : 'انتقل إلى الإعدادات > الأذونات واسمح بالرسائل.',
    },
    {
      key: 'notifications',
      icon: Bell,
      label: 'الإشعارات',
      value: d.notifications ? 'مفعلة' : 'معطلة',
      state: d.notifications ? 'ok' : 'warning',
      reason: 'تُستخدم لتنبيهك عند تطابق أو خطأ.',
      solution: d.notifications ? 'الإشعارات مفعلة.' : 'فعّل الإشعارات من إعدادات النظام للتطبيق.',
    },
    {
      key: 'background',
      icon: Server,
      label: 'المزامنة في الخلفية',
      value: bgStatus === 'RUNNING' ? 'تعمل ✓' : bgStatus === 'RESTRICTED' ? 'مقيدة' : 'متوقفة',
      state: bgStatus === 'RUNNING' ? 'ok' : bgStatus === 'RESTRICTED' ? 'error' : 'warning',
      reason: 'تجعل المزامنة تستمر عندما لا يكون التطبيق في المقدمة.',
      solution: bgStatus === 'RUNNING'
        ? 'مهمة الخلفية تعمل بشكل طبيعي.'
        : bgStatus === 'RESTRICTED'
        ? 'النظام يقيد التطبيق في الخلفية — أضفه لقائمة استثناءات البطارية.'
        : 'فعّل المزامنة في الخلفية من إعدادات الوكيل.',
    },
    {
      key: 'device',
      icon: Smartphone,
      label: 'تسجيل الجهاز',
      value: d.deviceRegistered ? 'مسجل' : 'غير مسجل',
      state: d.deviceRegistered ? 'ok' : 'error',
      reason: 'يتعرف الخادم على الجهاز لإرسال الطلبات.',
      solution: d.deviceRegistered ? 'الجهاز مسجل.' : 'تأكد من وجود خادم نشط ثم اضغط تسجيل الجهاز.',
    },
    {
      key: 'battery',
      icon: Battery,
      label: 'تحسين البطارية',
      value: d.batteryOptimization === 'restricted' ? 'مقيد' : 'غير مقيد',
      state: d.batteryOptimization === 'restricted' ? 'error' : 'ok',
      reason: 'التحسين المقيد يقتل التطبيق في الخلفية.',
      solution: d.batteryOptimization !== 'restricted' ? 'لا توجد قيود.' : 'أضف التطبيق إلى قائمة “عدم التحسين” في إعدادات النظام.',
    },
    {
      key: 'database',
      icon: Database,
      label: 'قاعدة البيانات',
      value: (() => {
        if (dbStatus === 'READY') return 'جاهزة ✓';
        if (dbStatus === 'MIGRATION_REQUIRED') return 'تحديث مطلوب';
        return 'خطأ';
      })(),
      state: dbStatus === 'READY' ? 'ok' : dbStatus === 'MIGRATION_REQUIRED' ? 'warning' : 'error',
      reason: 'تخزن الطلبات والرسائل المفهرسة محليًا.',
      solution: dbStatus === 'READY'
        ? 'قاعدة البيانات تعمل بشكل طبيعي.'
        : dbStatus === 'MIGRATION_REQUIRED'
        ? 'تحديث مطلوب — سيتم تلقائياً عند إعادة التشغيل.'
        : 'أعد تشغيل التطبيق. إذا استمرت المشكلة أبلغ الفريق.',
    },
    {
      key: 'sync_status',
      icon: CloudCog,
      label: 'حالة المزامنة',
      value: (() => {
        if (syncStatus === 'SYNCED') return 'متزامن ✓';
        if (syncStatus === 'SYNCING') return 'جارٍ المزامنة...';
        if (syncStatus === 'PENDING') return `${pendingCount} معلق`;
        return 'فشلت المزامنة';
      })(),
      state: syncStatus === 'SYNCED' ? 'ok'
        : syncStatus === 'SYNCING' ? 'checking'
        : syncStatus === 'PENDING' ? 'warning'
        : 'error',
      reason: 'تعكس حالة مزامنة العمليات المحلية مع الخادم.',
      solution: syncStatus === 'SYNCED'
        ? 'جميع العمليات متزامنة مع الخادم.'
        : syncStatus === 'SYNCING'
        ? 'جارٍ المزامنة الآن...'
        : syncStatus === 'PENDING'
        ? `${pendingCount} عملية بانتظار الاتصال — ستُزامَن تلقائياً.`
        : 'فشلت المزامنة — اضغط "اختبار المزامنة" أو تحقق من الخادم.',
    },
    {
      key: 'sources',
      icon: ShieldCheck,
      label: 'مصادر الدفع الموثقة',
      value: String(d.verifiedProviderSources ?? 0),
      state: (d.verifiedProviderSources ?? 0) > 0 ? 'ok' : 'warning',
      reason: 'رسائل SMS من مصادر غير موثقة لن تُعالج.',
      solution: (d.verifiedProviderSources ?? 0) > 0
        ? `${d.verifiedProviderSources} مصدر موثق — الوكيل يعمل بشكل طبيعي.`
        : 'انتقل إلى مصادر الدفع وأضف مصدر SMS موثق.',
    },
  ];

  const backendItems: StatusItem[] = [
    {
      key: 'backend',
      icon: Globe,
      label: 'Backend',
      value: (() => {
        switch (d.backendStatus) {
          case 'online': return 'Online ✓';
          case 'path_restricted': return 'متصل (مقيد)';
          case 'offline': return 'Offline';
          case 'unauthorized': return 'غير مصرح (401)';
          case 'forbidden': return 'محظور (403)';
          case 'timeout': return 'Timeout';
          case 'server_error': return 'خطأ خادم (5xx)';
          case 'invalid_config': return 'إعداد خاطئ (400)';
          case 'error': return 'خطأ';
          default: return d.backendStatus ?? 'Unknown';
        }
      })(),
      state: (d.backendStatus === 'online' || d.backendStatus === 'path_restricted') ? 'ok'
        : (d.backendStatus === 'offline' || d.backendStatus === 'error' || d.backendStatus === 'server_error') ? 'error'
        : 'warning',
      reason: 'الاتصال بالخادم المُعدّ ضروري للحصول على الطلبات وإرسال التأكيد.',
      solution: (d.backendStatus === 'online' || d.backendStatus === 'path_restricted')
        ? 'الخادم متاح.'
        : 'تحقق من عنوان URL والشهادات والبيانات في إعدادات الخادم.',
    },
    {
      key: 'realtime',
      icon: Radio,
      label: 'Realtime / Sync',
      // ✅ polling ≠ connected — نعرضهما بشكل مختلف
      value: (() => {
        switch (d.realtimeStatus) {
          case 'connected': return 'Realtime متصل ✓';
          case 'polling': return 'Polling (Fallback)';
          case 'disconnected': return 'غير متصل';
          case 'error': return 'خطأ في الاتصال';
          default: return d.realtimeStatus ?? '—';
        }
      })(),
      state: d.realtimeStatus === 'connected' ? 'ok'
        : d.realtimeStatus === 'polling' ? 'warning'
        : d.realtimeStatus === 'error' ? 'error'
        : 'warning',
      reason: 'Realtime = استقبال فوري للطلبات. Polling = احتياطي كل 60 ث.',
      solution: d.realtimeStatus === 'connected'
        ? 'القناة الحية متصلة — الأداء الأمثل.'
        : d.realtimeStatus === 'polling'
        ? 'يعمل بـ Polling الاحتياطي — سيحاول Realtime تلقائياً.'
        : 'تحقق من إعداد Supabase وتسجيل الجهاز.',
    },
  ];

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <ScrollView className="flex-1 px-5" contentInsetAdjustmentBehavior="automatic">
        <View className="flex-row items-center py-6 gap-3">
          <Pressable onPress={() => router.back()} className="p-2 border border-border rounded-full active:opacity-70">
            <ArrowRight size={20} color="#374151" />
          </Pressable>
          <Text className="text-xl font-bold text-foreground">تشخيص الوكيل</Text>
        </View>

        <View className="mb-6 px-4 py-5 border border-border rounded-2xl bg-card gap-1">
          <Text className="text-sm font-semibold text-foreground mb-4">حالة النظام</Text>
          {systemItems.map((item) => (
            <StatusRow
              key={item.key}
              item={item}
              expanded={expanded === item.key}
              onToggle={() => setExpanded(expanded === item.key ? null : item.key)}
            />
          ))}
        </View>

        <View className="mb-6 px-4 py-5 border border-border rounded-2xl bg-card gap-1">
          <Text className="text-sm font-semibold text-foreground mb-4">Backend</Text>
          {backendItems.map((item) => (
            <StatusRow
              key={item.key}
              item={item}
              expanded={expanded === item.key}
              onToggle={() => setExpanded(expanded === item.key ? null : item.key)}
            />
          ))}
          <InfoRow label="Active Server" value={d.activeServerProfile || '—'} />
          <InfoRow label="Base URL" value={activeProfile?.baseUrl || '—'} />
          <InfoRow label="Auth Type" value={activeProfile?.apiContract?.auth?.type || activeProfile?.authType || '—'} />
        </View>

        <View className="mb-6 px-4 py-5 border border-border rounded-2xl bg-card gap-4">
          <Text className="text-sm font-semibold text-foreground">البيانات والمزامنة</Text>
          <InfoRow label="قيد المزامنة" value={String(d.pendingSyncCount)} />
          <InfoRow label="طلبات نشطة" value={String(d.activeOrders)} />
          <InfoRow label="آخر رسالة SMS" value={d.lastSmsAt ? formatTime(d.lastSmsAt) : '—'} />
          <InfoRow label="آخر مسح" value={d.lastScanAt ? formatTime(d.lastScanAt) : '—'} />
          <InfoRow label="آخر مزامنة" value={state.lastSyncAt ? formatTime(state.lastSyncAt) : '—'} />
          {d.lastError && (
            <View className="flex-row items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10">
              <AlertCircle size={16} color="#ef4444" />
              <Text className="flex-1 text-xs text-destructive">{d.lastError}</Text>
            </View>
          )}
        </View>

        <View className="mb-6 px-4 py-5 border border-border rounded-2xl bg-card gap-4">
          <Text className="text-sm font-semibold text-foreground">آخر طلب للخادم</Text>
          <InfoRow label="Last Method" value={d.lastBackendMethod || '—'} />
          <InfoRow label="Last Endpoint" value={d.lastBackendEndpoint || '—'} />
          <InfoRow label="Last Status" value={d.lastBackendStatus ? String(d.lastBackendStatus) : '—'} />
          <InfoRow label="Request ID" value={d.lastBackendRequestId || '—'} />
          {lastMeta?.finishedAt && (
            <InfoRow label="Finished At" value={formatTime(lastMeta.finishedAt)} />
          )}
          {d.lastBackendError && (
            <InfoRow label="Error" value={d.lastBackendError} />
          )}
          {d.lastBackendResponse && (
            <Text className="text-xs text-muted-foreground" numberOfLines={6}>
              {d.lastBackendResponse}
            </Text>
          )}
        </View>

        <View className="gap-3 mb-8">
          <ActionButton
            label="تحديث التشخيص"
            onPress={handleRunDiagnostics}
            loading={testing}
            icon={RefreshCw}
          />
          <ActionButton
            label="اختبار المزامنة"
            onPress={handleTestSync}
            loading={syncing}
            icon={Server}
          />
          <ActionButton
            label="اختبار مسح SMS"
            onPress={handleTestScan}
            loading={scanning}
            icon={MessageSquare}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function StatusRow({
  item,
  expanded,
  onToggle,
}: {
  item: StatusItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = item.icon;
  const config = {
    ok: { icon: CheckCircle2, color: '#22c55e', label: 'OK' },
    warning: { icon: AlertCircle, color: '#f59e0b', label: 'Warning' },
    error: { icon: XCircle, color: '#ef4444', label: 'Error' },
    checking: { icon: Loader2, color: '#3b82f6', label: 'Checking' },
  }[item.state];
  const StatusIcon = config.icon;
  return (
    <Pressable onPress={onToggle} className="py-3 border-b border-border last:border-b-0 active:opacity-70">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <Icon size={18} color="#6b7280" />
          <Text className="text-sm text-foreground">{item.label}</Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-medium" style={{ color: config.color }}>
            {item.value}
          </Text>
          <StatusIcon size={16} color={config.color} />
          {expanded ? <ChevronUp size={16} color="#9ca3af" /> : <ChevronDown size={16} color="#9ca3af" />}
        </View>
      </View>
      {expanded && (
        <View className="mt-3 px-3 py-3 rounded-xl bg-muted gap-2">
          <View className="flex-row items-start gap-2">
            <HelpCircle size={16} color="#6b7280" />
            <Text className="flex-1 text-xs text-muted-foreground leading-5">{item.reason}</Text>
          </View>
          <View className="flex-row items-start gap-2">
            <Activity size={16} color="#3b82f6" />
            <Text className="flex-1 text-xs text-foreground leading-5">{item.solution}</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-1">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  loading,
  icon: Icon,
}: {
  label: string;
  onPress: () => void;
  loading: boolean;
  icon: React.ElementType;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      className="flex-row items-center justify-center gap-2 py-3.5 rounded-2xl border border-border active:opacity-70"
    >
      {loading ? <ActivityIndicator size="small" className="text-muted-foreground" /> : <Icon size={18} color="#6b7280" />}
      <Text className="text-sm font-medium text-foreground">{label}</Text>
    </Pressable>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
