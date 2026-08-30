import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell,
  CircleCheck,
  CircleX,
  Clock,
  MessageSquareWarning,
  RefreshCw,
  Server,
  ShieldAlert,
  Smartphone,
  Activity,
  Globe,
  Radio,
  Settings,
  Play,
  Square,
  Zap,
  CheckCircle2,
} from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import type { AgentState } from '@/types/agent';
import { getUnreadNotificationCount, markNotificationsAsRead } from '@/services/notifications';

export default function HomeScreen() {
  const router = useRouter();
  const { state, deviceState, refreshOrders, runDiagnostics, triggerSync, scanSmsNow, setEnabled } = useAgent();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifMarked, setNotifMarked] = useState(false);

  // حالات تحميل الأزرار
  const [agentToggleLoading, setAgentToggleLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  // آخر فعل ناجح لإظهار إشعار لحظي
  const [lastAction, setLastAction] = useState<string | null>(null);
  const lastActionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showActionFeedback = (msg: string) => {
    if (lastActionTimer.current) clearTimeout(lastActionTimer.current);
    setLastAction(msg);
    lastActionTimer.current = setTimeout(() => setLastAction(null), 3000);
  };

  useFocusEffect(
    useCallback(() => {
      refreshOrders();
      runDiagnostics();
    }, [refreshOrders, runDiagnostics])
  );

  const loadUnread = useCallback(async () => {
    const count = await getUnreadNotificationCount();
    setUnread(count);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      loadUnread().catch(() => undefined);
    }, 2000);
    loadUnread().catch(() => undefined);
    return () => clearInterval(interval);
  }, [loadUnread]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshOrders();
      await runDiagnostics();
      await loadUnread();
    } finally {
      setRefreshing(false);
    }
  }, [refreshOrders, runDiagnostics, loadUnread]);

  const handleBellPress = async () => {
    await markNotificationsAsRead();
    setUnread(0);
    setNotifMarked(true);
    router.push('/(app)/notifications' as any);
  };

  const isReady = Boolean(deviceState.deviceId && state.isReady && state.diagnostics.activeServerProfile);
  const statusInfo = getStatusInfo(
    state.connectionStatus,
    isReady,
    state.lastError,
    state.diagnostics.backendStatus
  );

  const agentRunning = state.diagnostics.agentRunning;

  const handleToggleAgent = async () => {
    if (agentToggleLoading) return;
    setAgentToggleLoading(true);
    try {
      if (agentRunning) {
        await setEnabled(false);
        showActionFeedback('تم إيقاف الوكيل');
      } else {
        await setEnabled(true);
        showActionFeedback('تم تشغيل الوكيل');
      }
    } finally {
      setAgentToggleLoading(false);
    }
  };

  const handleScanSms = async () => {
    if (scanLoading) return;
    setScanLoading(true);
    try {
      await scanSmsNow();
      showActionFeedback('اكتمل مسح SMS');
    } finally {
      setScanLoading(false);
    }
  };

  const handleSync = async () => {
    if (syncLoading) return;
    setSyncLoading(true);
    try {
      await triggerSync();
      showActionFeedback('اكتملت المزامنة');
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <ScrollView
        className="flex-1 px-5"
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between py-6">
          <View className="gap-1">
            <View className="flex-row items-center gap-2">
              <View className="w-8 h-8 rounded-xl bg-primary items-center justify-center">
                <Activity size={18} color="#ffffff" />
              </View>
              <Text className="text-2xl font-bold text-foreground tracking-tight">Nader Pay Agent</Text>
            </View>
            <Text className="text-sm text-muted-foreground">وكيل التحقق الآلي للمدفوعات</Text>
          </View>
          <View className="flex-row gap-2">
            <Pressable
              onPress={handleBellPress}
              className="relative w-10 h-10 items-center justify-center border border-border rounded-full active:opacity-70"
            >
              <Bell size={20} color="#6b7280" />
              {unread > 0 && (
                <View className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-destructive items-center justify-center px-1">
                  <Text className="text-[10px] font-bold text-primary-foreground">{unread > 99 ? '99+' : unread}</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={() => router.push('/(app)/settings' as any)}
              className="w-10 h-10 items-center justify-center border border-border rounded-full active:opacity-70"
            >
              <Settings size={20} color="#6b7280" />
            </Pressable>
          </View>
        </View>

        {notifMarked && (
          <View className="mb-4 px-4 py-3 border border-primary/20 rounded-2xl bg-primary/5">
            <Text className="text-sm text-primary">تم تحديد الإشعارات كمقروءة</Text>
          </View>
        )}

        {/* Smart summary */}
        <SmartSummary diagnostics={state.diagnostics} stats={state.stats} isReady={isReady} />

        {/* Status card */}
        <View className="px-5 py-5 border border-border rounded-2xl bg-card mb-6 gap-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <View className="w-3 h-3 rounded-full" style={{ backgroundColor: statusInfo.color }} />
              <Text className="text-base font-semibold text-foreground">{statusInfo.label}</Text>
            </View>
            {state.isPolling && <ActivityIndicator size="small" className="text-muted-foreground" />}
          </View>

          <View className="flex-row flex-wrap gap-3">
            <MiniStatus icon={Globe} label="Backend" active={state.diagnostics.backendStatus === 'online'} />
            <MiniStatus icon={Radio} label="Realtime" value={state.diagnostics.realtimeStatus === 'connected' ? 'متصل' : 'Polling'} active={state.diagnostics.realtimeStatus === 'connected'} />
            <MiniStatus icon={Smartphone} label="SMS" active={state.diagnostics.smsReady} />
            <MiniStatus icon={Bell} label="إشعارات" active={state.diagnostics.notifications} />
          </View>

          {state.lastError ? (
            <View className="px-3 py-2 rounded-lg bg-destructive/10">
              <Text className="text-xs text-destructive" numberOfLines={2}>
                {state.lastError}
              </Text>
            </View>
          ) : (
            <Text className="text-xs text-muted-foreground">
              آخر تحديث: {state.lastPollAt ? formatTime(state.lastPollAt) : '—'}
            </Text>
          )}
        </View>

        {/* Stats */}
        <View className="mb-2">
          <Text className="text-base font-semibold text-foreground mb-3">إحصائيات الطلبات</Text>
        </View>
        <View className="flex-row flex-wrap gap-3 mb-6">
          <StatCard icon={Clock} label="نشط" value={state.stats.active} color="#3b82f6" filter="scanning" />
          <StatCard icon={CircleCheck} label="مؤكد" value={state.stats.confirmed} color="#22c55e" filter="confirmed" />
          <StatCard icon={CircleX} label="مرفوض" value={state.stats.rejected} color="#ef4444" filter="rejected" />
          <StatCard icon={MessageSquareWarning} label="مراجعة" value={state.stats.review} color="#f59e0b" filter="review_required" />
          <StatCard icon={Server} label="إجمالي" value={state.stats.total} color="#6b7280" filter="all" />
          <StatCard icon={ShieldAlert} label="معلّق" value={state.stats.syncPending} color="#8b5cf6" filter="offline" />
        </View>

        {/* Service controls */}
        <View className="mb-6 border border-border rounded-2xl bg-card overflow-hidden">
          {/* رأس القسم مع مؤشر حالة الوكيل */}
          <View className="px-5 pt-5 pb-4 flex-row items-center justify-between border-b border-border">
            <View className="gap-0.5">
              <Text className="text-sm font-semibold text-foreground">خدمات الوكيل</Text>
              <View className="flex-row items-center gap-1.5 mt-1">
                {agentRunning ? (
                  <>
                    <View className="w-2 h-2 rounded-full bg-green-500" />
                    <Text className="text-xs text-green-600 font-medium">يعمل الآن</Text>
                  </>
                ) : (
                  <>
                    <View className="w-2 h-2 rounded-full bg-muted-foreground/40" />
                    <Text className="text-xs text-muted-foreground">متوقف</Text>
                  </>
                )}
              </View>
            </View>
            {agentRunning && (
              <View className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 border border-green-200">
                <ActivityIndicator size={10} color="#16a34a" />
                <Text className="text-xs text-green-700 font-medium">مراقبة SMS</Text>
              </View>
            )}
          </View>

          <View className="px-5 py-4 gap-3">
            {/* الزر الرئيسي: تشغيل / إيقاف */}
            <Pressable
              onPress={handleToggleAgent}
              disabled={agentToggleLoading}
              className={`flex-row items-center justify-center gap-2 py-3.5 rounded-xl active:opacity-70 ${
                agentRunning
                  ? 'bg-destructive/10 border border-destructive/30'
                  : 'bg-primary'
              }`}
            >
              {agentToggleLoading ? (
                <ActivityIndicator size={18} color={agentRunning ? '#ef4444' : '#ffffff'} />
              ) : agentRunning ? (
                <Square size={18} color="#ef4444" />
              ) : (
                <Play size={18} color="#ffffff" />
              )}
              <Text
                className={`text-sm font-semibold ${
                  agentRunning ? 'text-destructive' : 'text-primary-foreground'
                }`}
              >
                {agentToggleLoading
                  ? agentRunning ? 'جاري الإيقاف...' : 'جاري التشغيل...'
                  : agentRunning ? 'إيقاف الوكيل' : 'تشغيل الوكيل'}
              </Text>
            </Pressable>

            {/* صف الأزرار الثانوية */}
            <View className="flex-row gap-3">
              <Pressable
                onPress={handleScanSms}
                disabled={scanLoading}
                className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border border-border active:opacity-70"
              >
                {scanLoading ? (
                  <ActivityIndicator size={16} color="#6b7280" />
                ) : (
                  <Smartphone size={16} color="#6b7280" />
                )}
                <Text className="text-sm font-medium text-foreground">
                  {scanLoading ? 'جاري المسح...' : 'مسح SMS'}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleSync}
                disabled={syncLoading}
                className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border border-border active:opacity-70"
              >
                {syncLoading ? (
                  <ActivityIndicator size={16} color="#6b7280" />
                ) : (
                  <RefreshCw size={16} color="#6b7280" />
                )}
                <Text className="text-sm font-medium text-foreground">
                  {syncLoading ? 'جاري المزامنة...' : 'مزامنة'}
                </Text>
              </Pressable>
            </View>

            {/* صف تحديث الحالة والتشخيص */}
            <View className="flex-row gap-3">
              <Pressable
                onPress={onRefresh}
                className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border border-border active:opacity-70"
              >
                <RefreshCw size={16} color="#6b7280" />
                <Text className="text-sm font-medium text-muted-foreground">تحديث الحالة</Text>
              </Pressable>
              <Pressable
                onPress={() => router.push('/(app)/diagnostics' as any)}
                className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border border-border active:opacity-70"
              >
                <Activity size={16} color="#6b7280" />
                <Text className="text-sm font-medium text-muted-foreground">تشخيص مفصّل</Text>
              </Pressable>
            </View>

            {/* إشعار الفعل اللحظي */}
            {lastAction && (
              <View className="flex-row items-center gap-2 px-3 py-2.5 rounded-xl bg-green-50 border border-green-200">
                <CheckCircle2 size={15} color="#16a34a" />
                <Text className="text-xs text-green-700 font-medium">{lastAction}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Recent matches */}
        <View className="mb-8">
          <Text className="text-base font-semibold text-foreground mb-4">آخر التطابقات</Text>
          {state.recentMatches.length === 0 ? (
            <View className="items-center py-12 gap-3 border border-dashed border-border rounded-2xl">
              <ShieldAlert size={32} color="#9ca3af" />
              <Text className="text-sm text-muted-foreground">لم يتم التعرف على أي دليل دفع بعد</Text>
            </View>
          ) : (
            <View className="gap-3">
              {state.recentMatches.slice(0, 5).map((m, index) => (
                <View
                  key={index}
                  className="px-4 py-4 border border-border rounded-2xl bg-card"
                >
                  <View className="flex-row justify-between items-center mb-2">
                    <Text className="text-sm font-medium text-foreground">
                      {m.order.external_reference}
                    </Text>
                    <Text className="text-xs font-medium" style={{ color: m.confirmed ? '#22c55e' : '#f59e0b' }}>
                      {m.confirmed ? 'مؤكد' : 'مراجعة'}
                    </Text>
                  </View>
                  <Text className="text-xs text-muted-foreground">
                    مبلغ {m.transaction.amount} {m.transaction.currency} — نقاط التطابق: {m.score}
                  </Text>
                  <Text className="text-xs text-muted-foreground mt-1" numberOfLines={2}>
                    {m.reasons.join(' • ')}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function SmartSummary({
  diagnostics,
  stats,
  isReady,
}: {
  diagnostics: AgentState['diagnostics'];
  stats: AgentState['stats'];
  isReady: boolean;
}) {
  const verified = diagnostics.verifiedProviderSources ?? 0;
  const active = stats.active ?? 0;
  const pendingSync = stats.syncPending ?? 0;
  const backend = diagnostics.backendStatus === 'online';
  const sms = diagnostics.smsReady;
  const notifications = diagnostics.notifications;

  let overall: 'ready' | 'attention' | 'stopped' = 'stopped';
  let summary = 'الوكيل متوقف — يرجى ضبط الخادم والتسجيل';
  let color = '#ef4444';

  if (isReady) {
    if (backend && sms) {
      overall = 'ready';
      color = '#22c55e';
      summary = `الوكيل يعمل بشكل طبيعي — ${verified} مزود موثق — ${active} طلب نشط`;
      if (pendingSync > 0) {
        summary += ` — ${pendingSync} عملية بانتظار المزامنة`;
      }
    } else {
      overall = 'attention';
      color = '#f59e0b';
      const issues: string[] = [];
      if (!backend) issues.push('الخادم غير متصل');
      if (!sms) issues.push('صلاحية SMS غير ممنوحة');
      if (!notifications) issues.push('الإشعارات غير مفعلة');
      summary = `تحذير: ${issues.join(' — ')}`;
    }
  }

  return (
    <View className="px-4 py-4 border border-border rounded-2xl bg-card mb-4 gap-2">
      <View className="flex-row items-center gap-2">
        <Zap size={18} color={color} />
        <Text className="text-base font-semibold text-foreground">ملخص الوكيل الذكي</Text>
      </View>
      <Text className="text-sm text-muted-foreground leading-5">{summary}</Text>
      <View className="flex-row flex-wrap gap-3 mt-1">
        <View className="flex-row items-center gap-1">
          <View className="w-2 h-2 rounded-full" style={{ backgroundColor: backend ? '#22c55e' : '#ef4444' }} />
          <Text className="text-xs text-muted-foreground">خادم</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <View className="w-2 h-2 rounded-full" style={{ backgroundColor: sms ? '#22c55e' : '#ef4444' }} />
          <Text className="text-xs text-muted-foreground">SMS</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <View className="w-2 h-2 rounded-full" style={{ backgroundColor: verified > 0 ? '#22c55e' : '#f59e0b' }} />
          <Text className="text-xs text-muted-foreground">{verified} مصدر موثق</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <View className="w-2 h-2 rounded-full" style={{ backgroundColor: pendingSync > 0 ? '#f59e0b' : '#22c55e' }} />
          <Text className="text-xs text-muted-foreground">{pendingSync} مزامنة معلّقة</Text>
        </View>
      </View>
    </View>
  );
}

function getStatusInfo(
  connection: string,
  isReady: boolean,
  lastError: string | null,
  backendStatus?:
    | 'online'
    | 'offline'
    | 'error'
    | 'unknown'
    | 'unauthorized'
    | 'invalid_config'
    | 'timeout'
    | 'server_error'
) {
  if (!isReady) return { label: 'الخادم غير مضبوط', color: '#ef4444' };
  if (backendStatus === 'error') {
    return { label: lastError || 'خطأ في الاتصال بالخادم', color: '#ef4444' };
  }
  switch (connection) {
    case 'ONLINE':
      return { label: 'متصل مع الخادم', color: '#22c55e' };
    case 'OFFLINE':
      return { label: 'غير متصل — وضع عدم الاتصال', color: '#ef4444' };
    case 'CONNECTING':
      return { label: 'جاري الاتصال...', color: '#f59e0b' };
    case 'SYNCING':
      return { label: 'جاري المزامنة...', color: '#3b82f6' };
    case 'ERROR':
      return { label: lastError || 'خطأ في المزامنة', color: '#ef4444' };
    default:
      return { label: '—', color: '#6b7280' };
  }
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  filter,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
  filter: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() =>
        router.push(`/(app)/(tabs)/orders?status=${encodeURIComponent(filter)}` as any)
      }
      className="flex-1 min-w-[30%] px-4 py-4 border border-border rounded-2xl bg-card items-center gap-2 active:opacity-70"
      accessibilityLabel={`عرض طلبات ${label}`}
    >
      <Icon size={20} color={color} />
      <Text className="text-xl font-bold text-foreground">{value}</Text>
      <Text className="text-xs text-muted-foreground">{label}</Text>
    </Pressable>
  );
}

function MiniStatus({
  icon: Icon,
  label,
  value,
  active,
}: {
  icon: React.ElementType;
  label: string;
  value?: string;
  active: boolean;
}) {
  return (
    <View className="flex-row items-center gap-2 px-3 py-2 rounded-xl bg-muted">
      <Icon size={16} color={active ? '#22c55e' : '#ef4444'} />
      <View>
        <Text className="text-[10px] text-muted-foreground">{label}</Text>
        <Text className="text-xs font-medium text-foreground">{value ?? (active ? 'يعمل' : 'متوقف')}</Text>
      </View>
    </View>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
