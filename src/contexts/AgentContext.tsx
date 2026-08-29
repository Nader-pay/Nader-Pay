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
import { loadSettings, saveSettings, loadDeviceState, saveDeviceState } from '@/services/agentSettings';
import { sendHeartbeat, sendEvidenceEvent, sendRejectEvent } from '@/services/deviceRegistration';
import { parseAnySms, createMessageHash } from '@/services/smsParser';
import { findBestMatch } from '@/services/matchingEngine';
import { requestSmsPermission, checkSmsPermission, readExistingVodafoneCashMessages, readExistingPaymentMessages, incrementalScan } from '@/services/smsReader';
import { indexSmsMessage, findMatchingSmsInIndex, getLastIndexedSmsAt } from '@/services/localSmsIndex';
import { runSyncEngine } from '@/services/syncEngine';
import { startRealtimeSync, stopRealtimeSync } from '@/services/realtimeSync';
import { verifyMessageSource } from '@/services/sourceVerification';
import { registerBackgroundSync, unregisterBackgroundSync } from '@/services/backgroundAgent';
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
  addTimelineStage,
} from '@/lib/database';
import { setupNotifications, showAgentNotification, checkNotificationPermission } from '@/services/notifications';
import type { AgentSettings, DeviceState, AgentState, Order, SmsMessage, MatchResult, AgentOrderStatus } from '@/types/agent';

const AgentSmsListener = lazy(() => import('@/components/AgentSmsListener'));

const DEFAULT_SETTINGS: AgentSettings = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
  activeServerProfileId: null,
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
  requireSourceVerification: true,
  minMatchScore: 70,
  providers: {
    vodafone_cash: {
      enabled: true,
      recipientAccount: null,
      sourceRules: [],
      messagePatterns: [],
      parserVersion: '1.0.0',
      validationRules: [
        { field: 'amount', required: true, policy: 'exact' },
        { field: 'sender', required: false, policy: 'fuzzy' },
        { field: 'recipient', required: false, policy: 'fuzzy' },
        { field: 'transaction_id', required: true, policy: 'exact' },
      ],
    },
    orange_cash: {
      enabled: true,
      recipientAccount: null,
      sourceRules: [],
      messagePatterns: [],
      parserVersion: '1.0.0',
      validationRules: [
        { field: 'amount', required: true, policy: 'exact' },
        { field: 'sender', required: false, policy: 'fuzzy' },
        { field: 'recipient', required: false, policy: 'fuzzy' },
        { field: 'transaction_id', required: true, policy: 'exact' },
      ],
    },
    insta_pay: {
      enabled: true,
      recipientAccount: null,
      sourceRules: [],
      messagePatterns: [],
      parserVersion: '1.0.0',
      validationRules: [
        { field: 'amount', required: true, policy: 'exact' },
        { field: 'sender', required: false, policy: 'fuzzy' },
        { field: 'recipient', required: false, policy: 'fuzzy' },
        { field: 'transaction_id', required: true, policy: 'exact' },
      ],
    },
    bank_transfer: {
      enabled: true,
      recipientAccount: null,
      sourceRules: [],
      messagePatterns: [],
      parserVersion: '1.0.0',
      validationRules: [
        { field: 'amount', required: true, policy: 'exact' },
        { field: 'sender', required: false, policy: 'fuzzy' },
        { field: 'recipient', required: false, policy: 'fuzzy' },
        { field: 'transaction_id', required: true, policy: 'exact' },
      ],
    },
    unknown: {
      enabled: false,
      recipientAccount: null,
      sourceRules: [],
      messagePatterns: [],
      parserVersion: '1.0.0',
      validationRules: [],
    },
  },
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
  diagnostics: {
    agentRunning: false,
    network: 'ONLINE',
    smsReady: false,
    notifications: false,
    backgroundAgent: false,
    batteryOptimization: 'unknown',
    deviceRegistered: false,
    databaseReady: false,
    pendingSyncCount: 0,
    activeOrders: 0,
    lastSmsAt: null,
    lastScanAt: null,
    lastSyncAt: null,
    lastError: null,
  },
  stats: {
    active: 0,
    confirmed: 0,
    rejected: 0,
    waiting: 0,
    syncPending: 0,
    duplicate: 0,
    review: 0,
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
  REVIEW_REQUIRED: 'review_required',
  EXPIRED: 'expired',
  CANCELLED: 'rejected',
  DEVICE_OFFLINE: 'error',
  DUPLICATE: 'duplicate',
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
  confirmOrder: (orderId: string, reviewedBy?: string, reason?: string) => Promise<{ ok: boolean; error?: string; offline?: boolean }>;
  rejectOrder: (orderId: string, reason: string, reviewedBy?: string) => Promise<{ ok: boolean; error?: string; offline?: boolean }>;
  rescanOrder: (orderId: string) => Promise<void>;
  runDiagnostics: () => Promise<void>;
  triggerSync: () => Promise<void>;
  scanSmsNow: () => Promise<void>;
  toggleBackgroundSync: (enabled: boolean) => Promise<void>;
}

const AgentContext = createContext<AgentContextType | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
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
  const hasActiveProfile = Boolean(settings.activeServerProfileId);

  const updateStats = useCallback((orders: Order[]) => {
    const total = orders.length;
    const active = orders.filter((o) => ['new', 'scanning', 'matched', 'review_required'].includes(o.localStatus ?? 'new')).length;
    const waiting = orders.filter((o) => o.localStatus === 'scanning').length;
    const confirmed = orders.filter((o) => ['confirmed', 'confirmed_local'].includes(o.localStatus ?? '')).length;
    const rejected = orders.filter((o) => ['rejected', 'rejected_local', 'expired'].includes(o.localStatus ?? '')).length;
    const syncPending = orders.filter((o) => ['sync_pending', 'syncing', 'confirmed_local', 'rejected_local'].includes(o.localStatus ?? '')).length;
    const duplicate = orders.filter((o) => o.localStatus === 'duplicate').length;
    const review = orders.filter((o) => o.localStatus === 'review_required').length;
    setState((s) => ({
      ...s,
      stats: { active, confirmed, rejected, waiting, syncPending, duplicate, review, total },
      diagnostics: { ...s.diagnostics, activeOrders: active, pendingSyncCount: syncPending },
    }));
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

  const runDiagnostics = useCallback(async () => {
    try {
      const [permission, notifications, online, activeProfile, backendMeta] = await Promise.all([
        checkSmsPermission(),
        checkNotificationPermission(),
        checkOnline(),
        import('@/services/serverProfileManager').then((m) => m.getActiveServerProfile()),
        import('@/services/backendConnector').then((m) => m.getLastBackendRequestMeta()),
      ]);
      const lastSms = await getLastIndexedSmsAt();
      const pending = await getOfflineQueueCount();
      const background = settings.backgroundSyncEnabled;
      setState((s) => ({
        ...s,
        diagnostics: {
          ...s.diagnostics,
          agentRunning: settings.enabled && Boolean(deviceState.deviceId),
          network: online ? 'ONLINE' : 'OFFLINE',
          smsReady: permission,
          notifications,
          backgroundAgent: background,
          deviceRegistered: Boolean(deviceState.deviceId && deviceState.deviceToken),
          databaseReady: true,
          pendingSyncCount: pending,
          lastSmsAt: lastSms,
          activeServerProfile: activeProfile?.name || null,
          backendStatus: activeProfile
            ? backendMeta?.responseStatus
              ? backendMeta.responseStatus >= 200 && backendMeta.responseStatus < 300
                ? 'online'
                : backendMeta.responseStatus >= 500
                  ? 'error'
                  : 'offline'
              : 'unknown'
            : 'unknown',
          lastBackendStatus: backendMeta?.responseStatus ?? null,
          lastBackendEndpoint: backendMeta?.endpoint || null,
          lastBackendMethod: backendMeta?.method || null,
          lastBackendRequestId: backendMeta?.requestId || null,
          lastBackendResponse: backendMeta?.responseBody ? JSON.stringify(backendMeta.responseBody) : null,
          lastBackendError: backendMeta?.error || null,
          realtimeStatus: activeProfile?.apiContract?.realtime
            ? activeProfile.apiContract.realtime.type === 'none'
              ? 'polling'
              : 'connected'
            : 'polling',
        },
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        diagnostics: {
          ...s.diagnostics,
          lastError: err instanceof Error ? err.message : 'diagnostics_failed',
        },
      }));
    }
  }, [settings, deviceState, checkOnline]);

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



  const emitNotification = useCallback(async (title: string, body: string, data?: Record<string, unknown>) => {
    if (!settings.notificationsEnabled) return;
    const eventId = data?.orderId
      ? `${title}:${body}:${data.orderId}`
      : `${title}:${body}:${Date.now()}`;
    await showAgentNotification(title, body, data, eventId as string);
  }, [settings.notificationsEnabled]);

  const syncOfflineQueue = useCallback(async () => {
    if (isProcessing.current) return;
    isProcessing.current = true;
    try {
      setConnectionStatus('SYNCING');
      const result = await runSyncEngine(deviceState);
      const remaining = result.remaining;
      setState((s) => ({ ...s, pendingSyncCount: remaining }));
      setConnectionStatus(remaining > 0 ? 'ERROR' : 'ONLINE');
      if (remaining === 0) {
        setState((s) => ({ ...s, lastSyncAt: new Date().toISOString() }));
      }
      await runDiagnostics();
    } catch (err) {
      setConnectionStatus('ERROR');
      await logEvent('offline_sync_error', err instanceof Error ? err.message : 'فشل مزامنة قائمة الانتظار');
    } finally {
      isProcessing.current = false;
    }
  }, [deviceState, setConnectionStatus, runDiagnostics]);

  const sendEvidence = useCallback(async (order: Order, transaction: any) => {
    await addTimelineStage(order.id, 'VERIFICATION_COMPLETE', 'completed', 'اكتمال التحقق');
    await updateOrderLocal(order.id, {
      matchScore: 100,
      matchedTransaction: JSON.stringify(transaction),
      rawSms: transaction.rawMessage,
      syncStatus: 'syncing',
    });
    const online = await checkOnline();
    if (!online) {
      await updateOrderLocal(order.id, { localStatus: 'confirmed_local', syncStatus: 'pending' });
      await enqueueOffline(order.id, 'confirm', { action: 'confirm', transaction, orderId: order.id });
      await addTimelineStage(order.id, 'CONFIRMED_LOCAL', 'completed', 'تم التأكيد محليًا - بانتظار المزامنة');
      await logVerification(order.id, 'confirm', 'sync_pending', 'لا يوجد اتصال بالإنترنت', transaction, transaction.transactionId);
      await emitNotification('Nader Pay', 'تم حفظ التأكيد محليًا، سيتم المزامنة عند العودة للاتصال', { orderId: order.id });
      setConnectionStatus('OFFLINE');
      return { ok: true, offline: true };
    }

    setConnectionStatus('SYNCING');
    const result = await sendEvidenceEvent(deviceState, transaction);
    if (result.ok) {
      await upsertProcessedTransaction(transaction.transactionId, transaction.provider ?? 'vodafone_cash', order.id, 'confirmed');
      await updateOrderLocal(order.id, {
        localStatus: 'confirmed',
        syncStatus: 'synced',
      });
      await addTimelineStage(order.id, 'SYNCED', 'completed', 'تمت المزامنة مع الخادم');
      await logVerification(order.id, 'confirm', 'confirmed', 'تم التأكيد', transaction, transaction.transactionId);
      await emitNotification('Nader Pay', 'تم تأكيد الدفع بنجاح', { orderId: order.id });
      setConnectionStatus('ONLINE');
      return { ok: true, offline: false };
    }

    await updateOrderLocal(order.id, { localStatus: 'confirmed_local', syncStatus: 'pending' });
    await enqueueOffline(order.id, 'confirm', { action: 'confirm', transaction, orderId: order.id });
    await addTimelineStage(order.id, 'SYNC_PENDING', 'current', result.error || 'فشل المزامنة');
    await logVerification(order.id, 'confirm', 'sync_failed', result.error || 'فشل الإرسال', transaction, transaction.transactionId);
    setConnectionStatus('ERROR');
    return { ok: false, offline: false, error: result.error };
  }, [checkOnline, deviceState, emitNotification, setConnectionStatus]);

  const handleMessage = useCallback(
    async (message: SmsMessage, currentSettings = settings, currentDevice = deviceState) => {
      await indexSmsMessage(message);
      await addTimelineStage('', 'SMS_INDEXED', 'completed', 'تم فهرسة الرسالة محليًا');
      setState((s) => ({ ...s, diagnostics: { ...s.diagnostics, lastSmsAt: message.date } }));

      // التحقق من مصدر الرسالة قبل المعالجة
      if (currentSettings.requireSourceVerification) {
        const sourceCheck = verifyMessageSource(message, currentSettings);
        if (!sourceCheck.ok) {
          await logVerification('', 'source_untrusted', 'rejected', sourceCheck.reason, undefined, message.id);
          return;
        }
      }

      const transaction = parseAnySms(message.body);
      if (!transaction) return;

      if (await isTransactionProcessed(transaction.transactionId)) {
        await logVerification('', 'sms_duplicate', 'duplicate', 'تمت معالجة الرسالة من قبل', undefined, transaction.transactionId);
        return;
      }

      const txDate = new Date(transaction.occurredAt).getTime();
      const now = Date.now();
      if (Number.isNaN(txDate) || now - txDate > currentSettings.maxSearchWindowHours * 60 * 60 * 1000) {
        await upsertProcessedTransaction(transaction.transactionId, transaction.provider ?? 'vodafone_cash', null, 'expired');
        await logVerification('', 'sms_expired', 'rejected', 'خارج نافذة البحث', undefined, transaction.transactionId);
        return;
      }

      const pending = state.pendingOrders.filter((o) =>
        ['new', 'scanning', 'matched', 'review_required'].includes(o.localStatus ?? 'new')
      );

      const best = findBestMatch(transaction, pending, {
        maxAmountTolerance: currentSettings.maxAmountTolerance,
        searchWindowHours: currentSettings.maxSearchWindowHours,
        minMatchScore: currentSettings.minMatchScore,
        requireSourceVerification: currentSettings.requireSourceVerification,
      });
      if (!best) {
        await upsertProcessedTransaction(transaction.transactionId, transaction.provider ?? 'vodafone_cash', null, 'no_match');
        await logVerification('', 'sms_no_match', 'no_match', 'لا يوجد طلب مطابق', undefined, transaction.transactionId);
        return;
      }

      await addTimelineStage(best.order.id, 'PARSING', 'completed', transaction.provider);
      await addTimelineStage(best.order.id, 'VALIDATING', 'completed', `درجة التطابق: ${best.score}`);
      await addTimelineStage(best.order.id, 'DUPLICATE_CHECK', 'completed', 'لم يتم العثور على تكرار');

      if (!best.confirmed) {
        await upsertProcessedTransaction(transaction.transactionId, transaction.provider ?? 'vodafone_cash', best.order.id, 'pending');
        await updateOrderLocal(best.order.id, {
          localStatus: 'review_required',
          matchScore: best.score,
          rawSms: transaction.rawMessage,
          matchedTransaction: JSON.stringify(transaction),
          syncStatus: 'pending',
        });
        await addTimelineStage(best.order.id, 'REVIEW_REQUIRED', 'current', `تطابق غامض: ${best.reasons.join(' • ')}`);
        await logVerification(best.order.id, 'partial_match', 'matched', `تطابق جزئي: ${best.score}`, transaction, transaction.transactionId);
        await emitNotification('Nader Pay', 'تطابق جزئي، يحتاج مراجعة', { orderId: best.order.id });
        return;
      }

      await upsertProcessedTransaction(transaction.transactionId, transaction.provider ?? 'vodafone_cash', best.order.id, 'pending');
      await updateOrderLocal(best.order.id, {
        localStatus: 'matched',
        matchScore: best.score,
        rawSms: transaction.rawMessage,
        matchedTransaction: JSON.stringify(transaction),
        syncStatus: 'pending',
      });
      await addTimelineStage(best.order.id, 'VERIFICATION_COMPLETE', 'completed', `تطابق: ${best.score}`);
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

  const mapCachedRowToOrder = useCallback((row: any): Order => {
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
    let localStatus: AgentOrderStatus = (row.local_status as AgentOrderStatus) || STATUS_MAP[row.status] || 'new';
    if (row.status !== 'EXPIRED' && expiresAt && expiresAt < new Date()) {
      localStatus = 'expired';
    }
    return {
      id: row.id,
      order_id: row.order_id,
      account_id: row.account_id,
      external_reference: row.external_reference,
      order_reference: row.order_reference,
      payment_type: row.payment_type,
      provider: (row.provider || row.payment_type || 'unknown') as import('@/types/agent').ProviderName,
      amount: row.amount,
      currency: row.currency,
      expected_sender_phone: row.expected_sender_phone,
      expected_sender_name: row.expected_sender_name,
      expected_recipient_wallet: row.expected_recipient_wallet,
      sender_phone: row.sender_phone,
      receiver_phone: row.receiver_phone,
      sender_name: row.sender_name,
      transaction_id: row.transaction_id,
      transaction_reference: row.transaction_reference,
      message_received_at: row.message_received_at,
      service: row.service,
      type: row.type,
      status: row.status,
      expires_at: row.expires_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      localStatus,
      matchScore: row.match_score ?? undefined,
      evidenceId: row.evidence_id ?? undefined,
      syncStatus: row.sync_status,
      rawSms: row.raw_sms ?? undefined,
      rawOrder: row.raw_order ?? undefined,
      matchedTransaction: row.matched_transaction ?? undefined,
      verificationPayload: row.verification_payload ?? undefined,
      reviewedBy: row.reviewed_by ?? undefined,
      reviewedAt: row.reviewed_at ?? undefined,
      reviewReason: row.review_reason ?? undefined,
    };
  }, []);

  const refreshOrders = useCallback(async () => {
    if (!deviceState.deviceId) return;

    setState((s) => ({ ...s, isPolling: true, lastError: null }));
    try {
      setConnectionStatus('CONNECTING');
      const online = await checkOnline();
      if (!online) {
        throw new Error('لا يوجد اتصال بالإنترنت');
      }

      const { fetchPendingOrders } = await import('@/services/syncEngine');
      await fetchPendingOrders();

      const cached = await getCachedOrders();
      for (const row of cached) {
        if (['new', 'scanning'].includes(row.local_status ?? 'new')) {
          const matches = await findMatchingSmsInIndex({
            id: row.id,
            amount: row.amount,
            provider: row.provider as any,
            expected_sender_phone: row.expected_sender_phone ?? undefined,
            expected_recipient_wallet: row.expected_recipient_wallet ?? undefined,
          });
          for (const match of matches) {
            const message: SmsMessage = {
              id: match.transactionId || row.id,
              originatingAddress: match.senderPhone || 'unknown',
              body: match.rawMessage || '',
              date: match.occurredAt || new Date().toISOString(),
              readState: 1,
            };
            await handleMessage(message, settings, deviceState);
          }
        }
      }

      const orders = cached.map(mapCachedRowToOrder);
      const newOrderIds = orders.filter((o) => !knownOrderIds.current.has(o.id)).map((o) => o.id);
      if (newOrderIds.length > 0) {
        for (const id of newOrderIds) {
          await addTimelineStage(id, 'ORDER_RECEIVED', 'completed', 'تم استلام الطلب من الخادم');
        }
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

      await sendHeartbeat(deviceState, state.listenerStatus, state.pendingSyncCount);
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
  }, [deviceState, settings, state.listenerStatus, state.pendingSyncCount, updateStats, setConnectionStatus, checkOnline, syncOfflineQueue, emitNotification, handleMessage, mapCachedRowToOrder]);

  const registerDevice = useCallback(async () => {
    if (!hasActiveProfile) {
      setState((s) => ({ ...s, lastError: 'يرجى إعداد خادم نشط أولاً' }));
      return;
    }
    setState((s) => ({ ...s, isPolling: true, lastError: null }));
    try {
      const { registerDevice } = await import('@/services/deviceRegistration');
      const result = await registerDevice();
      if (!result.success) {
        throw new Error(result.error || 'فشل التسجيل');
      }
      const newState: DeviceState = {
        deviceId: result.deviceId ?? null,
        deviceToken: result.deviceToken ?? null,
        deviceName: 'NaderPay Agent',
        registeredAt: new Date().toISOString(),
        accountId: null,
      };
      setDeviceState(newState);
      await saveDeviceState(newState);
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
  }, [hasActiveProfile, emitNotification]);

  const confirmOrder = useCallback(async (orderId: string, reviewedBy?: string, reason?: string) => {
    if (orderLocks.current.has(orderId)) return { ok: false, error: 'الطلب قيد المعالجة' };
    orderLocks.current.add(orderId);
    try {
      const row = await getOrderById(orderId);
      if (!row) return { ok: false, error: 'الطلب غير موجود' };
      if (row.local_status === 'confirmed') return { ok: true };

      const tx = row.matched_transaction ? (JSON.parse(row.matched_transaction) as any) : null;
      const order: Order = {
        id: row.id,
        account_id: row.account_id,
        external_reference: row.external_reference,
        order_reference: row.order_reference,
        payment_type: row.payment_type,
        provider: row.provider as any,
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
        syncStatus: row.sync_status as any,
        rawSms: row.raw_sms ?? undefined,
        matchedTransaction: row.matched_transaction ?? undefined,
        verificationPayload: row.verification_payload ?? undefined,
        reviewedBy: row.reviewed_by ?? undefined,
        reviewedAt: row.reviewed_at ?? undefined,
        reviewReason: row.review_reason ?? undefined,
      };

      await updateOrderLocal(orderId, {
        localStatus: 'matched',
        reviewedBy: reviewedBy || 'manual',
        reviewedAt: new Date().toISOString(),
        reviewReason: reason || 'manual_approve',
      });
      await addTimelineStage(orderId, 'MANUAL_REVIEW', 'completed', 'تمت الموافقة اليدوية');

      if (!tx) {
        await updateOrderLocal(orderId, {
          localStatus: 'confirmed_local',
          syncStatus: 'pending',
        });
        await enqueueOffline(orderId, 'confirm', { action: 'confirm', orderId, reason: 'manual_approve' });
        await addTimelineStage(orderId, 'CONFIRMED_LOCAL', 'completed', 'تأكيد يدوي بلا رسالة - بانتظار المزامنة');
        return { ok: true, offline: true };
      }

      const result = await sendEvidence(order, tx);
      return { ok: result.ok, error: result.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'خطأ غير متوقع' };
    } finally {
      orderLocks.current.delete(orderId);
    }
  }, [sendEvidence]);

  const rejectOrder = useCallback(async (orderId: string, reason: string, reviewedBy?: string) => {
    if (orderLocks.current.has(orderId)) return { ok: false, error: 'الطلب قيد المعالجة' };
    orderLocks.current.add(orderId);
    try {
      await updateOrderLocal(orderId, {
        localStatus: 'rejected_local',
        syncStatus: 'pending',
        reviewedBy: reviewedBy || 'manual',
        reviewedAt: new Date().toISOString(),
        reviewReason: reason || 'manual_reject',
      });
      await addTimelineStage(orderId, 'MANUAL_REVIEW', 'completed', `رفض يدوي: ${reason || 'manual_reject'}`);
      await addTimelineStage(orderId, 'REJECTED_LOCAL', 'completed', 'تم الرفض محليًا - بانتظار المزامنة');

      const online = await checkOnline();
      if (!online) {
        await enqueueOffline(orderId, 'reject', { action: 'reject', reason: reason || 'manual_reject', orderId });
        await logVerification(orderId, 'reject', 'sync_pending', 'لا يوجد اتصال بالإنترنت');
        setConnectionStatus('OFFLINE');
        return { ok: true, offline: true };
      }

      setConnectionStatus('SYNCING');
      const result = await sendRejectEvent(deviceState, orderId, reason || 'manual_reject');
      if (result.ok) {
        await updateOrderLocal(orderId, { localStatus: 'rejected', syncStatus: 'synced' });
        await logVerification(orderId, 'reject', 'rejected', reason);
        await addTimelineStage(orderId, 'SYNCED', 'completed', 'تم رفض الطلب وتمت المزامنة');
        await emitNotification('Nader Pay', 'تم رفض الطلب', { orderId });
        setConnectionStatus('ONLINE');
        return { ok: true };
      }

      await updateOrderLocal(orderId, { localStatus: 'rejected_local', syncStatus: 'pending' });
      await enqueueOffline(orderId, 'reject', { action: 'reject', reason: reason || 'manual_reject', orderId });
      await logVerification(orderId, 'reject', 'sync_failed', result.error || 'فشل الإرسال');
      setConnectionStatus('ERROR');
      return { ok: false, error: result.error };
    } catch (err) {
      setConnectionStatus('ERROR');
      return { ok: false, error: err instanceof Error ? err.message : 'خطأ غير متوقع' };
    } finally {
      orderLocks.current.delete(orderId);
    }
  }, [checkOnline, deviceState, emitNotification, setConnectionStatus]);

  const rescanOrder = useCallback(async (orderId: string) => {
    await updateOrderLocal(orderId, {
      localStatus: 'scanning',
      matchScore: null,
      evidenceId: null,
      rawSms: null,
      matchedTransaction: null,
      syncStatus: 'pending',
    });
    await addTimelineStage(orderId, 'SCANNING', 'current', 'إعادة المسح');
    await logVerification(orderId, 'rescan', 'scanning', 'إعادة المسح');
    try {
      const last = await getLastIndexedSmsAt();
      const messages = await incrementalScan(last);
      for (const message of messages) {
        await indexSmsMessage(message);
      }
      await setState((s) => ({ ...s, diagnostics: { ...s.diagnostics, lastScanAt: new Date().toISOString() } }));
      const allMessages = await readExistingPaymentMessages();
      for (const message of allMessages) {
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

  const triggerSync = useCallback(async () => {
    setConnectionStatus('SYNCING');
    await syncOfflineQueue();
  }, [syncOfflineQueue, setConnectionStatus]);

  const scanSmsNow = useCallback(async () => {
    try {
      const last = await getLastIndexedSmsAt();
      const messages = await incrementalScan(last);
      for (const m of messages) {
        await indexSmsMessage(m);
      }
      const allMessages = await readExistingPaymentMessages();
      for (const m of allMessages) {
        await processMessage(m);
      }
      setState((s) => ({ ...s, diagnostics: { ...s.diagnostics, lastScanAt: new Date().toISOString() } }));
      await runDiagnostics();
    } catch (err) {
      await logEvent('manual_scan_error', err instanceof Error ? err.message : 'unknown');
    }
  }, [processMessage, runDiagnostics]);

  const toggleBackgroundSync = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const ok = await registerBackgroundSync();
      setState((s) => ({ ...s, diagnostics: { ...s.diagnostics, backgroundAgent: ok } }));
    } else {
      await unregisterBackgroundSync();
      setState((s) => ({ ...s, diagnostics: { ...s.diagnostics, backgroundAgent: false } }));
    }
  }, []);

  const requestSmsAccess = useCallback(async () => {
    const granted = await requestSmsPermission();
    setState((s) => ({ ...s, isSmsPermissionGranted: granted, listenerStatus: granted ? 'running' : 'stopped', diagnostics: { ...s.diagnostics, smsReady: granted } }));
    if (granted) {
      await setupNotifications();
      await scanSmsNow();
    }
    await runDiagnostics();
    return granted;
  }, [scanSmsNow, runDiagnostics]);

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
      const online = await checkOnline();
      const deviceRegistered = Boolean(loadedDevice.deviceId && loadedDevice.deviceToken);
      setState((s) => ({
        ...s,
        isReady: true,
        isSmsPermissionGranted: permission,
        listenerStatus: permission ? 'running' : 'stopped',
        diagnostics: {
          ...s.diagnostics,
          agentRunning: loadedSettings.enabled && deviceRegistered,
          network: online ? 'ONLINE' : 'OFFLINE',
          smsReady: permission,
          notifications,
          backgroundAgent: loadedSettings.backgroundSyncEnabled,
          deviceRegistered,
          databaseReady: true,
        },
      }));
      if (notifications && loadedSettings.notificationsEnabled) {
        await setupNotifications();
      }
      if (loadedSettings.backgroundSyncEnabled) {
        await registerBackgroundSync();
      }
      setInitDone(true);
    })();

    return () => {
      active = false;
    };
  }, []);

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

  // بدء/إيقاف polling + realtime sync
  useEffect(() => {
    if (!initDone || !settings.enabled || !deviceState.deviceId || !settings.activeServerProfileId) {
      stopRealtimeSync();
      if (pollTimer.current) {
        clearInterval(pollTimer.current as unknown as number);
        pollTimer.current = null;
      }
      setState((s) => ({
        ...s,
        isPolling: false,
        diagnostics: { ...s.diagnostics, realtimeStatus: 'disconnected' },
      }));
      return;
    }

    setState((s) => ({ ...s, isPolling: true }));
    startRealtimeSync(
      (status) => {
        setState((s) => ({
          ...s,
          diagnostics: { ...s.diagnostics, realtimeStatus: status },
        }));
      },
      async () => {
        await refreshOrders();
      }
    );
    refreshOrders();
    pollTimer.current = setInterval(() => {
      refreshOrders();
    }, settings.pollingIntervalMs);

    return () => {
      stopRealtimeSync();
      if (pollTimer.current) {
        clearInterval(pollTimer.current as unknown as number);
        pollTimer.current = null;
      }
    };
  }, [initDone, settings.enabled, settings.activeServerProfileId, deviceState.deviceId, settings.pollingIntervalMs, refreshOrders]);

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
      runDiagnostics,
      triggerSync,
      scanSmsNow,
      toggleBackgroundSync,
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
      runDiagnostics,
      triggerSync,
      scanSmsNow,
      toggleBackgroundSync,
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
