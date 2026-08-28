import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  Suspense,
  lazy,
} from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { useSession } from '@/ctx';
import { createNaderAiClient } from '@/services/naderAiClient';
import { loadSettings, saveSettings, loadDeviceState, saveDeviceState } from '@/services/agentSettings';
import {
  registerDevice as registerDeviceWithServer,
  fetchProfile,
  sendHeartbeat,
  sendEvidenceEvent,
  sendRejectEvent,
} from '@/services/deviceRegistration';
import { parseVodafoneCashSms, createMessageHash } from '@/services/smsParser';
import { findBestMatch } from '@/services/matchingEngine';
import { requestSmsPermission, checkSmsPermission, readExistingVodafoneCashMessages } from '@/services/smsReader';
import {
  cacheOrders,
  getCachedOrders,
  logEvent,
  isTransactionProcessed,
  upsertProcessedTransaction,
  getOrderById,
  updateOrderLocal,
  enqueueOffline,
  getPendingOfflineQueue,
  getOfflineQueueCount,
  updateOfflineQueueStatus,
  deleteOfflineQueueItem,
  logVerification,
} from '@/lib/database';
import { setupNotifications, showAgentNotification, checkNotificationPermission } from '@/services/notifications';
import type { AgentSettings, DeviceState, AgentState, Order, SmsMessage, MatchResult, AgentOrderStatus } from '@/types/agent';

const AgentSmsListener = lazy(() => import('@/components/AgentSmsListener'));

const DEFAULT_SETTINGS: AgentSettings = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
  pollingIntervalMs: 30_000,
  maxAmountTolerance: 0.01,
  autoConfirm: true,
  enabled: false,
  maxSearchWindowHours: 24,
  autoRejectPolicy: 'on_expiry',
  retryPolicy: 'exponential',
  retryMaxAttempts: 5,
  retryBaseDelayMs: 2000,
  notificationsEnabled: true,
  backgroundSyncEnabled: true,
};

const DEFAULT_STATE: AgentState = {
  isReady: false,
  isPolling: false,
  isSmsPermissionGranted: null,
  connectionStatus: 'CONNECTING',
  listenerStatus: 'stopped',
  lastPollAt: null,
  lastSyncAt: null,
  lastError: null,
  pendingOrders: [],
  recentMatches: [],
  pendingSyncCount: 0,
  stats: {
    active: 0,
    confirmed: 0,
    rejected: 0,
    waiting: 0,
    syncPending: 0,
    total: 0,
  },
};

const STATUS_MAP: Record<string, AgentOrderStatus> = {
  CREATED: 'new',
  WAITING_PAYMENT: 'scanning',
  MESSAGE_DETECTED: 'scanning',
  PARSING: 'scanning',
  VERIFYING: 'matched',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  REVIEW_REQUIRED: 'matched',
  EXPIRED: 'expired',
  CANCELLED: 'rejected',
  DEVICE_OFFLINE: 'error',
  DUPLICATE: 'error',
};

interface AgentContextType {
  settings: AgentSettings;
  deviceState: DeviceState;
  state: AgentState;
  registerDevice: () => Promise<void>;
  refreshOrders: () => Promise<void>;
  processMessage: (message: SmsMessage) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  saveAgentSettings: (settings: AgentSettings) => Promise<void>;
  reloadSettings: () => Promise<void>;
  requestSmsAccess: () => Promise<boolean>;
  confirmOrder: (orderId: string) => Promise<{ ok: boolean; error?: string }>;
  rejectOrder: (orderId: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
  rescanOrder: (orderId: string) => Promise<void>;
}

const AgentContext = createContext<AgentContextType | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const { session, isLoading: isSessionLoading } = useSession();
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [deviceState, setDeviceState] = useState<DeviceState>({
    deviceId: null,
    deviceName: null,
    deviceToken: null,
    registeredAt: null,
    accountId: null,
  });
  const [state, setState] = useState<AgentState>(DEFAULT_STATE);
  const [initDone, setInitDone] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const networkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const appActive = useRef(true);
  const isProcessing = useRef(false);
  const orderLocks = useRef<Set<string>>(new Set());
  const knownOrderIds = useRef<Set<string>>(new Set());
  const client = useMemo(
    () => createNaderAiClient(settings.supabaseUrl, settings.supabaseAnonKey),
    [settings.supabaseUrl, settings.supabaseAnonKey]
  );

  const updateStats = useCallback((orders: Order[]) => {
    const total = orders.length;
    const active = orders.filter((o) => ['new', 'scanning', 'matched'].includes(o.localStatus ?? 'new')).length;
    const waiting = orders.filter((o) => o.localStatus === 'scanning').length;
    const confirmed = orders.filter((o) => o.localStatus === 'confirmed').length;
    const rejected = orders.filter((o) => o.localStatus === 'rejected' || o.localStatus === 'expired').length;
    const syncPending = orders.filter((o) => o.localStatus === 'sync_pending').length;
    setState((s) => ({ ...s, stats: { active, confirmed, rejected, waiting, syncPending, total } }));
  }, []);

  const setConnectionStatus = useCallback((status: AgentState['connectionStatus']) => {
    setState((s) => ({ ...s, connectionStatus: status }));
  }, []);

  const checkOnline = useCallback(async () => {
    try {
      const network = await Network.getNetworkStateAsync();
      return !!network.isConnected;
    } catch {
      return false;
    }
  }, []);

  const monitorNetwork = useCallback(async () => {
    const online = await checkOnline();
    setState((s) => {
      if (online && s.connectionStatus === 'OFFLINE') {
        return { ...s, connectionStatus: 'ONLINE' };
      }
      if (!online && s.connectionStatus !== 'OFFLINE') {
        return { ...s, connectionStatus: 'OFFLINE' };
      }
      return s;
    });
  }, [checkOnline]);

  const loadAccount = useCallback(async () => {
    if (!session?.user?.id) return;
    if (deviceState.accountId) return;
    const profile = await fetchProfile(client, session.user.id);
    if (profile.account_id) {
      const next = { ...deviceState, accountId: profile.account_id };
      setDeviceState(next);
      await saveDeviceState(next);
    }
  }, [session, client, deviceState]);

  const emitNotification = useCallback(async (title: string, body: string, data?: Record<string, unknown>) => {
    if (!settings.notificationsEnabled) return;
    await showAgentNotification(title, body, data);
  }, [settings.notificationsEnabled]);

  const syncOfflineQueue = useCallback(async () => {
    if (isProcessing.current) return;
    isProcessing.current = true;
    try {
      setConnectionStatus('SYNCING');
      const online = await checkOnline();
      if (!online) {
        setConnectionStatus('OFFLINE');
        return;
      }

      const pending = await getPendingOfflineQueue();
      for (const item of pending) {
        if (item.attempts >= settings.retryMaxAttempts) {
          await updateOrderLocal(item.order_id, { localStatus: 'error', syncStatus: 'failed' });
          await deleteOfflineQueueItem(item.id);
          await logVerification(item.order_id, 'sync_failed', 'error', 'تجاوزت عدد المحاولات');
          continue;
        }

        await updateOfflineQueueStatus(item.id, 'syncing', item.attempts + 1);
        const payload = JSON.parse(item.payload) as {
          action: 'confirm' | 'reject';
          transaction?: Record<string, unknown>;
          reason?: string;
        };

        let result: { ok: boolean; error?: string } = { ok: false, error: 'إجراء غير معروف' };
        if (payload.action === 'confirm' && payload.transaction) {
          result = await sendEvidenceEvent(deviceState, payload.transaction as any, settings);
        } else if (payload.action === 'reject') {
          result = await sendRejectEvent(deviceState, item.order_id, payload.reason || 'manual_reject', settings);
        }

        if (result.ok) {
          await deleteOfflineQueueItem(item.id);
          await updateOrderLocal(item.order_id, {
            localStatus: payload.action === 'confirm' ? 'confirmed' : 'rejected',
            syncStatus: 'synced',
          });
          await logVerification(
            item.order_id,
            payload.action,
            payload.action === 'confirm' ? 'confirmed' : 'rejected',
            'تمت المزامنة من قائمة الانتظار',
            payload.transaction,
            payload.transaction ? (payload.transaction as any).transactionId : null
          );
        } else {
          await updateOfflineQueueStatus(item.id, 'pending', item.attempts + 1);
          await logVerification(item.order_id, payload.action, 'sync_failed', result.error || 'فشل المزامنة', payload.transaction);
        }
      }

      const remaining = await getOfflineQueueCount();
      setState((s) => ({ ...s, pendingSyncCount: remaining }));
      setConnectionStatus(remaining > 0 ? 'ERROR' : 'ONLINE');
      if (remaining === 0) {
        setState((s) => ({ ...s, lastSyncAt: new Date().toISOString() }));
      }
    } catch (err) {
      setConnectionStatus('ERROR');
      await logEvent('offline_sync_error', err instanceof Error ? err.message : 'فشل مزامنة قائمة الانتظال');
    } finally {
      isProcessing.current = false;
    }
  }, [checkOnline, setConnectionStatus, deviceState, settings]);

  const sendEvidence = useCallback(async (order: Order, transaction: any) => {
    const online = await checkOnline();
    if (!online) {
      await updateOrderLocal(order.id, { localStatus: 'sync_pending', syncStatus: 'pending' });
      await enqueueOffline(order.id, 'confirm', { action: 'confirm', transaction });
      await logVerification(order.id, 'confirm', 'sync_pending', 'لا يوجد اتصال بالإنترنت', transaction, transaction.transactionId);
      await emitNotification('Nader Pay', 'تم حفظ النتيجة محليًا، سيتم المزامنة عند العودة للاتصال', { orderId: order.id });
      setConnectionStatus('OFFLINE');
      return { ok: true, offline: true };
    }

    setConnectionStatus('SYNCING');
    const result = await sendEvidenceEvent(deviceState, transaction, settings);
    if (result.ok) {
      await upsertProcessedTransaction(transaction.transactionId, 'vodafone_cash', order.id, 'confirmed');
      await updateOrderLocal(order.id, {
        localStatus: 'confirmed',
        matchScore: 100,
        syncStatus: 'synced',
      });
      await logVerification(order.id, 'confirm', 'confirmed', 'تم التأكيد', transaction, transaction.transactionId);
      await emitNotification('Nader Pay', 'تم تأكيد الدفع بنجاح', { orderId: order.id });
      setConnectionStatus('ONLINE');
      return { ok: true, offline: false };
    }

    await updateOrderLocal(order.id, { localStatus: 'sync_pending', syncStatus: 'pending' });
    await enqueueOffline(order.id, 'confirm', { action: 'confirm', transaction });
    await logVerification(order.id, 'confirm', 'sync_failed', result.error || 'فشل الإرسال', transaction, transaction.transactionId);
    setConnectionStatus('ERROR');
    return { ok: false, offline: false, error: result.error };
  }, [checkOnline, deviceState, settings, emitNotification, setConnectionStatus]);

  const handleMessage = useCallback(
    async (message: SmsMessage, currentSettings = settings, currentDevice = deviceState) => {
      const transaction = parseVodafoneCashSms(message.body);
      if (!transaction) return;

      if (await isTransactionProcessed(transaction.transactionId)) {
        await logVerification('', 'sms_duplicate', 'duplicate', 'تمت معالجة الرسالة من قبل', undefined, transaction.transactionId);
        return;
      }

      // نافذة 24 ساعة: نتجاهل المعاملات الأقدم من 24 ساعة
      const txDate = new Date(transaction.occurredAt).getTime();
      const now = Date.now();
      if (Number.isNaN(txDate) || now - txDate > currentSettings.maxSearchWindowHours * 60 * 60 * 1000) {
        await upsertProcessedTransaction(transaction.transactionId, 'vodafone_cash', null, 'expired');
        await logVerification('', 'sms_expired', 'rejected', 'خارج نافذة البحث', undefined, transaction.transactionId);
        return;
      }

      const pending = state.pendingOrders.filter((o) =>
        ['new', 'scanning', 'matched'].includes(o.localStatus ?? 'new')
      );

      const best = findBestMatch(transaction, pending, currentSettings.maxAmountTolerance, currentSettings.maxSearchWindowHours);
      if (!best) {
        await upsertProcessedTransaction(transaction.transactionId, 'vodafone_cash', null, 'no_match');
        await logVerification('', 'sms_no_match', 'no_match', 'لا يوجد طلب مطابق', undefined, transaction.transactionId);
        return;
      }

      if (!best.confirmed) {
        await upsertProcessedTransaction(transaction.transactionId, 'vodafone_cash', best.order.id, 'pending');
        await updateOrderLocal(best.order.id, {
          localStatus: 'matched',
          matchScore: best.score,
          rawSms: transaction.rawMessage,
          matchedTransaction: JSON.stringify(transaction),
          syncStatus: 'pending',
        });
        await logVerification(best.order.id, 'partial_match', 'matched', `تطابق جزئي: ${best.score}`, transaction, transaction.transactionId);
        await emitNotification('Nader Pay', 'تطابق جزئي، يحتاج مراجعة', { orderId: best.order.id });
        return;
      }

      await upsertProcessedTransaction(transaction.transactionId, 'vodafone_cash', best.order.id, 'pending');
      await updateOrderLocal(best.order.id, {
        localStatus: 'matched',
        matchScore: best.score,
        rawSms: transaction.rawMessage,
        matchedTransaction: JSON.stringify(transaction),
      });
      await logVerification(best.order.id, 'match', 'matched', `تطابق: ${best.score}`, transaction, transaction.transactionId);
      await emitNotification('Nader Pay', 'تم العثور على تطابق', { orderId: best.order.id });

      setState((s) => ({
        ...s,
        recentMatches: [best, ...s.recentMatches].slice(0, 50),
      }));

      if (!currentSettings.autoConfirm) {
        await logVerification(best.order.id, 'confirm_skipped', 'pending', 'التحقق التلقائي معطل', transaction, transaction.transactionId);
        return;
      }

      await sendEvidence(best.order, transaction);
    },
    [settings, deviceState, state.pendingOrders, emitNotification, sendEvidence]
  );

  const processMessage = useCallback(
    async (message: SmsMessage) => {
      if (isProcessing.current) return;
      isProcessing.current = true;
      try {
        await handleMessage(message);
      } finally {
        isProcessing.current = false;
      }
    },
    [handleMessage]
  );

  const refreshOrders = useCallback(async () => {
    if (!session || !deviceState.accountId || !deviceState.deviceId) return;

    setState((s) => ({ ...s, isPolling: true, lastError: null }));
    try {
      setConnectionStatus('CONNECTING');
      const online = await checkOnline();
      if (!online) {
        throw new Error('لا يوجد اتصال بالإنترنت');
      }

      const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { data, error } = await client
        .from('payment_requests')
        .select('*')
        .eq('payment_type', 'wallet')
        .eq('account_id', deviceState.accountId)
        .in('status', [
          'CREATED',
          'WAITING_PAYMENT',
          'MESSAGE_DETECTED',
          'PARSING',
          'VERIFYING',
          'CONFIRMED',
          'REJECTED',
          'REVIEW_REQUIRED',
          'EXPIRED',
          'CANCELLED',
          'DEVICE_OFFLINE',
          'DUPLICATE',
        ])
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      const mapped = (data as Order[] ?? []).map((o) => {
        const localStatus = STATUS_MAP[o.status] ?? 'new';
        const expiresAt = o.expires_at ? new Date(o.expires_at) : null;
        if (o.status !== 'EXPIRED' && expiresAt && expiresAt < new Date()) {
          return { ...o, localStatus: 'expired' as AgentOrderStatus };
        }
        return { ...o, localStatus };
      });

      await cacheOrders(mapped);
      const cached = await getCachedOrders();
      const orders = cached.map((row) => ({
        id: row.id,
        account_id: row.account_id,
        external_reference: row.external_reference,
        order_reference: row.order_reference,
        payment_type: row.payment_type,
        amount: row.amount,
        currency: row.currency,
        expected_sender_phone: row.expected_sender_phone,
        expected_sender_name: row.expected_sender_name,
        expected_recipient_wallet: row.expected_recipient_wallet,
        status: row.status,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        localStatus: (row.local_status as AgentOrderStatus) || STATUS_MAP[row.status] || 'new',
        matchScore: row.match_score ?? undefined,
        evidenceId: row.evidence_id ?? undefined,
      }));

      const newOrderIds = orders.filter((o) => !knownOrderIds.current.has(o.id)).map((o) => o.id);
      if (newOrderIds.length > 0) {
        await emitNotification('Nader Pay', `تم استلام ${newOrderIds.length} طلب جديد`, { orderIds: newOrderIds });
      }
      orders.forEach((o) => knownOrderIds.current.add(o.id));

      updateStats(orders);
      setState((s) => ({
        ...s,
        pendingOrders: orders,
        isPolling: false,
        lastPollAt: new Date().toISOString(),
        lastError: null,
      }));

      await sendHeartbeat(deviceState, state.listenerStatus, state.pendingSyncCount, settings);
      await syncOfflineQueue();
      setConnectionStatus('ONLINE');
    } catch (err) {
      setConnectionStatus('ERROR');
      setState((s) => ({
        ...s,
        isPolling: false,
        lastError: err instanceof Error ? err.message : 'خطأ في التحديث',
      }));
      await logEvent('poll_error', err instanceof Error ? err.message : 'خطأ في التحديث');
    }
  }, [session, deviceState, client, settings, state.listenerStatus, state.pendingSyncCount, updateStats, setConnectionStatus, checkOnline, syncOfflineQueue, emitNotification]);

  const registerDevice = useCallback(async () => {
    if (!session) {
      setState((s) => ({ ...s, lastError: 'يجب تسجيل الدخول أولاً' }));
      return;
    }
    setState((s) => ({ ...s, isPolling: true, lastError: null }));
    try {
      const accessToken = session.access_token;
      const result = await registerDeviceWithServer(accessToken, settings, session.user?.id);
      if (!result.success) {
        throw new Error(result.error || 'فشل التسجيل');
      }
      const newState: DeviceState = {
        deviceId: result.deviceId ?? null,
        deviceToken: result.deviceToken ?? null,
        deviceName: 'NaderPay Agent',
        registeredAt: new Date().toISOString(),
        accountId: result.accountId ?? null,
      };
      setDeviceState(newState);
      await saveDeviceState(newState);
      await loadAccount();
      await logEvent('device_registered', 'تم تسجيل الجهاز بنجاح', { deviceId: result.deviceId });
      await emitNotification('Nader Pay', 'تم تسجيل الجهاز بنجاح');
    } catch (err) {
      setState((s) => ({
        ...s,
        lastError: err instanceof Error ? err.message : 'فشل تسجيل الجهاز',
      }));
      await logEvent('device_register_error', err instanceof Error ? err.message : 'فشل التسجيل');
    } finally {
      setState((s) => ({ ...s, isPolling: false }));
    }
  }, [session, settings, loadAccount, emitNotification]);

  const confirmOrder = useCallback(async (orderId: string) => {
    if (orderLocks.current.has(orderId)) return { ok: false, error: 'الطلب قيد المعالجة' };
    orderLocks.current.add(orderId);
    try {
      const row = await getOrderById(orderId);
      if (!row) return { ok: false, error: 'الطلب غير موجود' };
      if (row.local_status === 'confirmed') return { ok: true };

      const tx = row.matched_transaction ? (JSON.parse(row.matched_transaction) as any) : null;
      if (!tx) {
        return { ok: false, error: 'لا يوجد رسالة مطابقة' };
      }

      const order: Order = {
        id: row.id,
        account_id: row.account_id,
        external_reference: row.external_reference,
        order_reference: row.order_reference,
        payment_type: row.payment_type,
        amount: row.amount,
        currency: row.currency,
        expected_sender_phone: row.expected_sender_phone,
        expected_sender_name: row.expected_sender_name,
        expected_recipient_wallet: row.expected_recipient_wallet,
        status: row.status,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        localStatus: (row.local_status as AgentOrderStatus) || 'matched',
        matchScore: row.match_score ?? undefined,
        evidenceId: row.evidence_id ?? undefined,
      };

      const result = await sendEvidence(order, tx);
      return { ok: result.ok, error: result.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'خطأ غير متوقع' };
    } finally {
      orderLocks.current.delete(orderId);
    }
  }, [sendEvidence]);

  const rejectOrder = useCallback(async (orderId: string, reason: string) => {
    if (orderLocks.current.has(orderId)) return { ok: false, error: 'الطلب قيد المعالجة' };
    orderLocks.current.add(orderId);
    try {
      const online = await checkOnline();
      if (!online) {
        await updateOrderLocal(orderId, { localStatus: 'sync_pending', syncStatus: 'pending' });
        await enqueueOffline(orderId, 'reject', { action: 'reject', reason });
        await logVerification(orderId, 'reject', 'sync_pending', 'لا يوجد اتصال بالإنترنت');
        setConnectionStatus('OFFLINE');
        return { ok: true, offline: true };
      }

      setConnectionStatus('SYNCING');
      const result = await sendRejectEvent(deviceState, orderId, reason, settings);
      if (result.ok) {
        await updateOrderLocal(orderId, { localStatus: 'rejected', syncStatus: 'synced' });
        await logVerification(orderId, 'reject', 'rejected', reason);
        await emitNotification('Nader Pay', 'تم رفض الطلب', { orderId });
        setConnectionStatus('ONLINE');
        return { ok: true };
      }

      await updateOrderLocal(orderId, { localStatus: 'sync_pending', syncStatus: 'pending' });
      await enqueueOffline(orderId, 'reject', { action: 'reject', reason });
      await logVerification(orderId, 'reject', 'sync_failed', result.error || 'فشل الإرسال');
      setConnectionStatus('ERROR');
      return { ok: false, error: result.error };
    } catch (err) {
      setConnectionStatus('ERROR');
      return { ok: false, error: err instanceof Error ? err.message : 'خطأ غير متوقع' };
    } finally {
      orderLocks.current.delete(orderId);
    }
  }, [checkOnline, deviceState, settings, emitNotification, setConnectionStatus]);

  const rescanOrder = useCallback(async (orderId: string) => {
    await updateOrderLocal(orderId, {
      localStatus: 'scanning',
      matchScore: null,
      evidenceId: null,
      rawSms: null,
      matchedTransaction: null,
      syncStatus: 'pending',
    });
    await logVerification(orderId, 'rescan', 'scanning', 'إعادة المسح');
    try {
      const messages = await readExistingVodafoneCashMessages();
      for (const message of messages) {
        await processMessage(message);
      }
    } catch {
      // تجاهل أخطاء قراءة الأرشيف
    }
  }, [processMessage]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    const next = { ...settings, enabled };
    setSettings(next);
    await saveSettings(next);
  }, [settings]);

  const saveAgentSettings = useCallback(async (next: AgentSettings) => {
    setSettings(next);
    await saveSettings(next);
  }, []);

  const reloadSettings = useCallback(async () => {
    const loaded = await loadSettings();
    setSettings(loaded);
  }, []);

  const requestSmsAccess = useCallback(async () => {
    const granted = await requestSmsPermission();
    setState((s) => ({ ...s, isSmsPermissionGranted: granted, listenerStatus: granted ? 'running' : 'stopped' }));
    if (granted) {
      await setupNotifications();
      try {
        const messages = await readExistingVodafoneCashMessages();
        for (const message of messages) {
          await processMessage(message);
        }
      } catch {
        // تجاهل أخطاء قراءة الأرشيف
      }
    }
    return granted;
  }, [processMessage]);

  // تحميل الإعدادات وحالة الجهاز عند البدء
  useEffect(() => {
    let active = true;

    (async () => {
      const [loadedSettings, loadedDevice] = await Promise.all([
        loadSettings(),
        loadDeviceState(),
      ]);

      if (!active) return;

      setSettings(loadedSettings);
      setDeviceState(loadedDevice);
      const permission = await checkSmsPermission();
      const notifications = await checkNotificationPermission();
      setState((s) => ({
        ...s,
        isReady: true,
        isSmsPermissionGranted: permission,
        listenerStatus: permission ? 'running' : 'stopped',
      }));
      if (notifications && loadedSettings.notificationsEnabled) {
        await setupNotifications();
      }
      setInitDone(true);
    })();

    return () => {
      active = false;
    };
  }, []);

  // تحميل account_id عند توفر الجلسة
  useEffect(() => {
    if (!session?.user?.id) return;
    loadAccount();
  }, [session, loadAccount]);

  // مراقبة حالة التطبيق والشبكة
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      appActive.current = nextState === 'active';
    });
    networkTimer.current = setInterval(() => {
      monitorNetwork();
    }, 5000);
    return () => {
      subscription.remove();
      if (networkTimer.current) {
        clearInterval(networkTimer.current);
        networkTimer.current = null;
      }
    };
  }, [monitorNetwork]);

  // بدء/إيقاف polling
  useEffect(() => {
    if (!initDone || isSessionLoading || !session || !settings.enabled || !deviceState.deviceId || !deviceState.accountId) {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }

    refreshOrders();
    pollTimer.current = setInterval(() => {
      refreshOrders();
    }, settings.pollingIntervalMs);

    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [initDone, isSessionLoading, session, settings.enabled, deviceState.deviceId, deviceState.accountId, settings.pollingIntervalMs, refreshOrders]);

  const value = useMemo(
    () => ({
      settings,
      deviceState,
      state,
      registerDevice,
      refreshOrders,
      processMessage,
      setEnabled,
      saveAgentSettings,
      reloadSettings,
      requestSmsAccess,
      confirmOrder,
      rejectOrder,
      rescanOrder,
    }),
    [
      settings,
      deviceState,
      state,
      registerDevice,
      refreshOrders,
      processMessage,
      setEnabled,
      saveAgentSettings,
      reloadSettings,
      requestSmsAccess,
      confirmOrder,
      rejectOrder,
      rescanOrder,
    ]
  );

  return (
    <AgentContext.Provider value={value}>
      {children}
      {process.env.EXPO_OS === 'android' && (
        <Suspense fallback={null}>
          <AgentSmsListener onMessage={processMessage} />
        </Suspense>
      )}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) {
    throw new Error('useAgent must be used inside AgentProvider');
  }
  return ctx;
}
