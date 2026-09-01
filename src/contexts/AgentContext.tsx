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
import { parseAnySms } from '@/services/smsParser';
import { findBestMatch, tryMatchStoredSmsForOrder } from '@/services/matchingEngine';
import { readExistingPaymentMessages, incrementalScan } from '@/services/smsReader';
import { indexSmsMessage, findMatchingSmsInIndex, getLastIndexedSmsAt } from '@/services/localSmsIndex';
import { runSyncEngine, reconcileLocalEvents } from '@/services/syncEngine';
import {
  startRealtimeSync,
  stopRealtimeSync,
  reconnectRealtime,
  triggerRealtimePoll,
} from '@/services/realtimeSync';
import {
  startRuntime,
  stopRuntime,
  resumeRuntime,
  notifyNetworkChange,
  getRuntimeSnapshot,
} from '@/services/agentRuntime';
import { verifyMessageSource } from '@/services/sourceVerification';
import { processSmsMessage, processNotificationMessage } from '@/services/verificationPipeline';
import type { PipelineOutcome } from '@/services/verificationPipeline';
import { registerBackgroundSync, unregisterBackgroundSync, startForegroundService, stopForegroundService } from '@/services/backgroundAgent';
import { getPermissionSnapshot, requestSmsPermission } from '@/services/permissionManager';
import { buildStatusSnapshot } from '@/services/statusEngine';
import { listProviderSources } from '@/services/providerSourceService';
import { onNetworkRestored, onStartupRecovery } from '@/services/recoveryManager';
import { logDiagnosticEvent, markModuleHealthy, markModuleError, computeSyncStatus } from '@/services/diagnosticsEngine';
import { getSupervisorSnapshot, runHealthCycle, recordHeartbeat as supervisorHeartbeat } from '@/services/supervisorEngine';
import { getNetworkSnapshot, getNetworkState } from '@/services/networkIntelligence';
import { getDeviceIdentityState } from '@/services/securityGuard';
import { backendCircuit } from '@/services/circuitBreaker';
import { getDeadLetterCount } from '@/lib/database';
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
  setOrderTimestamp,
  markSmsSentToOrder,
} from '@/lib/database';
import * as Notifications from 'expo-notifications';
import { setupNotifications, showAgentNotification } from '@/services/notifications';
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
  const networkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const appActive = useRef(true);
  const wasOffline = useRef(false);
  const isProcessing = useRef(false);
  const orderLocks = useRef<Set<string>>(new Set());
  const knownOrderIds = useRef<Set<string>>(new Set());
  const pendingOrdersRef = useRef<Order[]>([]);
  const stateRef = useRef<AgentState>(state);
  const hasActiveProfile = Boolean(settings.activeServerProfileId);

  // Keep refs in sync so async callbacks use current state without stale closures.
  useEffect(() => {
    pendingOrdersRef.current = state.pendingOrders;
    stateRef.current = state;
  }, [state]);

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
      const [permissions, online, activeProfile, backendMeta] = await Promise.all([
        getPermissionSnapshot(),
        checkOnline(),
        import('@/services/serverProfileManager').then((m) => m.getActiveServerProfile()),
        import('@/services/backendConnector').then((m) => m.getLastBackendRequestMeta()),
      ]);
      const lastSms = await getLastIndexedSmsAt();
      const pending = await getOfflineQueueCount();
      const background = settings.backgroundSyncEnabled;
      const providerSources = await listProviderSources();
      const verifiedCount = providerSources.filter((s) => s.verified && s.status === 'verified').length;

      // Phase 3: جلب بيانات Supervisor + Network + Security + Circuit Breaker
      const [supervisorSnap, networkSnap, dlqCount] = await Promise.all([
        Promise.resolve(getSupervisorSnapshot()),
        Promise.resolve(getNetworkSnapshot()),
        getDeadLetterCount().catch(() => 0),
      ]);
      const deviceIdentity = getDeviceIdentityState();
      const cbSnap = backendCircuit.getSnapshot();

      const snapshot = buildStatusSnapshot(
        {
          settings,
          deviceState,
          permissions,
          online,
          databaseReady: true,
          backgroundAgent: background,
          pendingSyncCount: pending,
          activeOrders: stateRef.current.diagnostics.activeOrders,
          lastBackendMeta: backendMeta,
          realtimeStatus: stateRef.current.diagnostics.realtimeStatus ?? 'unknown',
          lastError: stateRef.current.lastError,
        },
        stateRef.current.diagnostics
      );

      setState((s) => ({
        ...s,
        connectionStatus: snapshot.connectionStatus,
        diagnostics: {
          ...s.diagnostics,
          agentRunning: snapshot.agentRunning,
          network: snapshot.network,
          smsReady: permissions.sms === 'granted',
          notifications: permissions.notifications === 'granted',
          backgroundAgent: snapshot.backgroundAgent,
          deviceRegistered: snapshot.deviceRegistered,
          databaseReady: snapshot.databaseReady,
          pendingSyncCount: pending,
          lastSmsAt: lastSms,
          activeServerProfile: activeProfile?.name || null,
          backendStatus: snapshot.backendStatus,
          lastBackendStatus: backendMeta?.responseStatus ?? null,
          lastBackendEndpoint: backendMeta?.endpoint || null,
          lastBackendMethod: backendMeta?.method || null,
          lastBackendRequestId: backendMeta?.requestId || null,
          lastBackendResponse: backendMeta?.responseBody ? JSON.stringify(backendMeta.responseBody) : null,
          lastBackendError: backendMeta?.error || null,
          realtimeStatus: snapshot.realtimeStatus,
          verifiedProviderSources: verifiedCount,
          // Phase 3: بيانات المرحلة الجديدة
          healthScore: supervisorSnap.healthScore,
          supervisorStatus: supervisorSnap.overallStatus,
          deadLetterCount: dlqCount,
          networkState: networkSnap.networkState,
          deviceIdentityState: deviceIdentity,
          circuitBreakerState: cbSnap.state,
        },
      }));

      // Phase 3: تشغيل health cycle كجزء من diagnostics الدورية
      runHealthCycle().catch(() => undefined);
      supervisorHeartbeat('runtime');

    } catch (err) {
      setState((s) => ({
        ...s,
        diagnostics: {
          ...s.diagnostics,
          lastError: err instanceof Error ? err.message : 'diagnostics_failed',
        },
      }));
    }
  }, [settings, deviceState, checkOnline, stateRef]);

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
    // تسجيل verified_at
    await setOrderTimestamp(order.id, 'verified_at', new Date().toISOString());

    const online = await checkOnline();
    if (!online) {
      await updateOrderLocal(order.id, { localStatus: 'confirmed_local', syncStatus: 'pending' });
      await enqueueOffline(order.id, 'confirm',
        { action: 'confirm', transaction, orderId: order.id },
        { idempotencyKey: `confirm:${order.id}` }
      );
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
      await setOrderTimestamp(order.id, 'synced_at', new Date().toISOString());
      await addTimelineStage(order.id, 'SYNCED', 'completed', 'تمت المزامنة مع الخادم');
      await logVerification(order.id, 'confirm', 'confirmed', 'تم التأكيد', transaction, transaction.transactionId);
      await emitNotification('Nader Pay', 'تم تأكيد الدفع بنجاح', { orderId: order.id });
      setConnectionStatus('ONLINE');
      markModuleHealthy('sync');
      return { ok: true, offline: false };
    }

    await updateOrderLocal(order.id, { localStatus: 'confirmed_local', syncStatus: 'pending' });
    await enqueueOffline(order.id, 'confirm',
      { action: 'confirm', transaction, orderId: order.id },
      { idempotencyKey: `confirm:${order.id}` }
    );
    await setOrderTimestamp(order.id, 'sync_started_at', new Date().toISOString());
    await addTimelineStage(order.id, 'SYNC_PENDING', 'current', result.error || 'فشل المزامنة');
    await logVerification(order.id, 'confirm', 'sync_failed', result.error || 'فشل الإرسال', transaction, transaction.transactionId);
    setConnectionStatus('ERROR');
    markModuleError('sync', result.error || 'sync_failed');
    return { ok: false, offline: false, error: result.error };
  }, [checkOnline, deviceState, emitNotification, setConnectionStatus]);

  const handleMessage = useCallback(
    async (message: SmsMessage, currentSettings = settings, currentDevice = deviceState) => {
      await indexSmsMessage(message);
      setState((s) => ({ ...s, diagnostics: { ...s.diagnostics, lastSmsAt: message.date } }));

      const pending = pendingOrdersRef.current.filter((o) =>
        ['new', 'scanning', 'matched', 'review_required'].includes(o.localStatus ?? 'new')
      );

      // ── Production Verification Pipeline (المرحلة الثانية) ─────────────────
      let outcome: PipelineOutcome;
      try {
        outcome = await processSmsMessage(message, pending, {
          requireSourceVerification: currentSettings.requireSourceVerification,
          autoConfirm: currentSettings.autoConfirm,
          maxAmountTolerance: currentSettings.maxAmountTolerance,
          requireSenderPhone: false,
        });
      } catch (pipelineErr) {
        await logEvent('pipeline_error', pipelineErr instanceof Error ? pipelineErr.message : 'خطأ في pipeline', {
          address: message.originatingAddress,
        });
        // fallback آمن — لا نكسر تدفق المعالجة
        return;
      }

      // ── معالجة نتيجة Pipeline ───────────────────────────────────────────────
      switch (outcome.action) {
        case 'SOURCE_REJECTED':
          await logVerification('', 'source_untrusted', 'rejected', outcome.reason, undefined, message.id);
          return;

        case 'PARSE_FAILED':
          return;

        case 'PROVIDER_NOT_CONFIGURED':
          await logVerification('', 'provider_not_configured', 'rejected',
            `Provider ${outcome.provider} غير مهيأ بالكامل`, undefined, message.id
          );
          return;

        case 'INSUFFICIENT_EVIDENCE':
          await logVerification('', 'insufficient_evidence', 'pending',
            'أدلة غير كافية — بانتظار دليل إضافي', undefined, message.id
          );
          return;

        case 'DUPLICATE':
          await logDiagnosticEvent('sms_duplicate', `معالجة مكررة: ${outcome.fingerprint}`, {
            severity: 'INFO', module: 'matching', dedupKey: `sms_dup:${outcome.fingerprint}`,
          });
          return;

        case 'NO_MATCH':
          await logVerification('', 'sms_no_match', 'no_match',
            `${outcome.matchCode}: ${outcome.reasons.join(' • ')}`, undefined, message.id
          );
          return;

        case 'REVIEW': {
          await setOrderTimestamp(outcome.orderId, 'sms_received_at', message.date || new Date().toISOString());
          await updateOrderLocal(outcome.orderId, {
            localStatus: 'review_required',
            matchScore: outcome.score,
            rawSms: message.body,
            verificationCode: outcome.matchCode,
            verificationScore: outcome.score,
            syncStatus: 'pending',
          } as any);
          await emitNotification('Nader Pay', 'تطابق جزئي، يحتاج مراجعة', { orderId: outcome.orderId });
          await logVerification(outcome.orderId, 'match_partial', 'review_required',
            `${outcome.matchCode}: ${outcome.reasons.join(' • ')}`, undefined, message.id
          );
          return;
        }

        case 'CONFIRMED': {
          await setOrderTimestamp(outcome.orderId, 'sms_received_at', message.date || new Date().toISOString());
          await setOrderTimestamp(outcome.orderId, 'processed_at', new Date().toISOString());
          await updateOrderLocal(outcome.orderId, {
            localStatus: 'matched',
            matchScore: outcome.score,
            rawSms: message.body,
            verificationCode: outcome.matchCode,
            verificationScore: outcome.score,
            canonicalId: outcome.canonical.canonicalId,
            matchedTransaction: JSON.stringify({
              transactionId: outcome.canonical.normalized.transactionId,
              amount: outcome.canonical.normalized.amount,
              currency: outcome.canonical.normalized.currency,
              senderPhone: outcome.canonical.normalized.senderPhone,
              senderName: outcome.canonical.normalized.senderName,
              receiverPhone: outcome.canonical.normalized.receiverWallet ?? outcome.canonical.normalized.receiverAccount,
              sourceVerified: true,
              duplicate: false,
              parserId: outcome.canonical.normalized.parserId,
            }),
            syncStatus: 'pending',
          } as any);

          await emitNotification('Nader Pay', 'تم التحقق من الدفع', { orderId: outcome.orderId });
          await logVerification(outcome.orderId, 'match', 'matched',
            `${outcome.matchCode} | score=${outcome.score}`, undefined, message.id
          );

          setState((s) => ({
            ...s,
            recentMatches: [
              { order: pending.find((o) => o.id === (outcome as any).orderId) ?? null, score: outcome.score, confirmed: true, reasons: [outcome.matchCode] } as any,
              ...s.recentMatches,
            ].slice(0, 50),
          }));

          // إرسال دليل الدفع للـ Backend
          if (currentSettings.autoConfirm) {
            const orderRow = pending.find((o) => o.id === outcome.orderId);
            if (orderRow) {
              await sendEvidence(orderRow, {
                transactionId: outcome.canonical.normalized.transactionId,
                amount: outcome.canonical.normalized.amount,
                currency: outcome.canonical.normalized.currency,
                senderPhone: outcome.canonical.normalized.senderPhone,
                receiverPhone: outcome.canonical.normalized.receiverWallet,
                sourceVerified: true,
                providerId: outcome.canonical.providerId,
                canonicalId: outcome.canonical.canonicalId,
              });
            }
          }
          return;
        }
      }
    },
    [settings, deviceState, pendingOrdersRef, emitNotification, sendEvidence]
  );

  // processMessage: قفل على مستوى transactionId لمنع المعالجة المتزامنة لنفس الرسالة
  const processingTransactions = useRef<Set<string>>(new Set());

  const processMessage = useCallback(
    async (message: SmsMessage) => {
      // احسب hash/key للرسالة — نستخدم id إذا وُجد وإلا نُنشئ مفتاحاً من المحتوى
      const txKey = message.id || `${message.originatingAddress}:${message.date}:${message.body.slice(0, 40)}`;

      // قفل على مستوى الرسالة (لمنع المعالجة المتوازية لنفس الرسالة)
      if (processingTransactions.current.has(txKey)) return;
      processingTransactions.current.add(txKey);

      try {
        await handleMessage(message);
      } finally {
        processingTransactions.current.delete(txKey);
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
      const online = await checkOnline();
      if (!online) {
        // في وضع عدم الاتصال: تحميل الطلبات المخزنة محليًا ومحاولة مطابقتها مع SMS المحفوظة
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
        updateStats(orders);
        setState((s) => ({
          ...s,
          pendingOrders: orders,
          isPolling: false,
          lastError: 'لا يوجد اتصال بالإنترنت — تم تحميل الطلبات المحلية',
        }));
        setConnectionStatus('OFFLINE');
        return;
      }

      setConnectionStatus('CONNECTING');
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

      await sendHeartbeat(deviceState, stateRef.current.listenerStatus, stateRef.current.pendingSyncCount);
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
  }, [deviceState, settings, stateRef, updateStats, setConnectionStatus, checkOnline, syncOfflineQueue, emitNotification, handleMessage, mapCachedRowToOrder]);

  const registerDevice = useCallback(async () => {
    if (!hasActiveProfile) {
      setState((s) => ({ ...s, lastError: 'يرجى إعداد خادم نشط أولاً' }));
      return;
    }
    setState((s) => ({ ...s, isPolling: true, lastError: null }));
    try {
      const { registerDevice: doRegister } = await import('@/services/deviceRegistration');
      const result = await doRegister();

      if (result.alreadyRegistered) {
        // الجهاز كان مسجلاً — تأكد أن state محدّث
        if (result.deviceId && result.deviceToken) {
          const existing: DeviceState = {
            deviceId: result.deviceId,
            deviceToken: result.deviceToken,
            deviceName: deviceState.deviceName ?? 'NaderPay Agent',
            registeredAt: deviceState.registeredAt ?? new Date().toISOString(),
            accountId: deviceState.accountId ?? null,
          };
          setDeviceState(existing);
          await saveDeviceState(existing);
        }
        await logEvent('device_already_registered', 'الجهاز مسجل مسبقاً', { deviceId: result.deviceId });
        setState((s) => ({ ...s, isPolling: false }));
        return;
      }

      if (!result.success) {
        // فشل Backend حقيقي — نعرضه للمستخدم
        throw new Error(result.error || 'فشل التسجيل');
      }

      // نجح Backend — نحفظ في DB المحلية
      // خطأ DB هنا مستقل: نُسجّله لكن لا يُعتبر فشل backend
      const newState: DeviceState = {
        deviceId: result.deviceId ?? null,
        deviceToken: result.deviceToken ?? null,
        deviceName: 'NaderPay Agent',
        registeredAt: new Date().toISOString(),
        accountId: null,
      };

      try {
        setDeviceState(newState);
        await saveDeviceState(newState);
        await logEvent('device_registered', 'تم تسجيل الجهاز بنجاح', { deviceId: result.deviceId });
      } catch (dbErr) {
        // خطأ DB محلي — نُسجّله كـ warning ولا نُظهره كفشل backend
        await logEvent('device_register_db_warn', dbErr instanceof Error ? dbErr.message : 'خطأ في حفظ بيانات الجهاز محلياً');
        // state في الذاكرة محدّث — المستخدم لن يرى الخطأ
      }

      await emitNotification('Nader Pay', 'تم تسجيل الجهاز بنجاح');
    } catch (err) {
      // فشل حقيقي (Backend أو network) — نعرضه
      setState((s) => ({
        ...s,
        lastError: err instanceof Error ? err.message : 'فشل تسجيل الجهاز',
      }));
      await logEvent('device_register_error', err instanceof Error ? err.message : 'فشل التسجيل');
    } finally {
      setState((s) => ({ ...s, isPolling: false }));
    }
  }, [hasActiveProfile, deviceState, emitNotification]);

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
        await enqueueOffline(orderId, 'reject',
          { action: 'reject', reason: reason || 'manual_reject', orderId },
          { idempotencyKey: `reject:${orderId}` }
        );
        await logVerification(orderId, 'reject', 'sync_pending', 'لا يوجد اتصال بالإنترنت');
        setConnectionStatus('OFFLINE');
        return { ok: true, offline: true };
      }

      setConnectionStatus('SYNCING');
      const result = await sendRejectEvent(deviceState, orderId, reason || 'manual_reject');
      if (result.ok) {
        await updateOrderLocal(orderId, { localStatus: 'rejected', syncStatus: 'synced' });
        await setOrderTimestamp(orderId, 'synced_at', new Date().toISOString());
        await logVerification(orderId, 'reject', 'rejected', reason);
        await addTimelineStage(orderId, 'SYNCED', 'completed', 'تم رفض الطلب وتمت المزامنة');
        await emitNotification('Nader Pay', 'تم رفض الطلب', { orderId });
        setConnectionStatus('ONLINE');
        return { ok: true };
      }

      await updateOrderLocal(orderId, { localStatus: 'rejected_local', syncStatus: 'pending' });
      await enqueueOffline(orderId, 'reject',
        { action: 'reject', reason: reason || 'manual_reject', orderId },
        { idempotencyKey: `reject:${orderId}` }
      );
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

  /** مساعد داخلي: يُشغّل runtime + realtime + يجلب الطلبات فوراً */
  /** اختبار الاتصال بالخادم وتحديث backendStatus فوراً في الـ UI */
  const probeBackend = useCallback(async () => {
    const { testConnection } = await import('@/services/backendConnector');
    const { getActiveServerProfile } = await import('@/services/serverProfileManager');
    const profile = await getActiveServerProfile();
    if (!profile) return;

    try {
      const result = await testConnection(profile);
      // تحديث backendStatus مباشرةً بدون انتظار runDiagnostics الكاملة
      setState((s) => ({
        ...s,
        diagnostics: {
          ...s.diagnostics,
          backendStatus: result.ok ? 'online' : 'error',
          lastBackendError: result.ok ? null : (result.error ?? null),
          lastBackendStatus: result.status ?? null,
          activeServerProfile: profile.name,
        },
      }));
      return result.ok;
    } catch {
      setState((s) => ({
        ...s,
        diagnostics: { ...s.diagnostics, backendStatus: 'error' },
      }));
      return false;
    }
  }, []);

  const doStartAgent = useCallback(async (currentSettings: AgentSettings, currentDevice: DeviceState) => {
    const online = await checkOnline();
    const registered = Boolean(currentDevice.deviceId && currentDevice.deviceToken);

    // تحديث فوري للـ UI — يُظهر "جاري التشغيل" قبل انتهاء startRuntime
    setState((s) => ({
      ...s,
      diagnostics: {
        ...s.diagnostics,
        runtimeStatus: 'STARTING',
        runtimeReason: null,
        agentRunning: false,
      },
    }));

    await startRuntime({
      enabled: true,
      deviceRegistered: registered,
      online,
      tick: async () => {
        try {
          await runSyncEngine(currentDevice);
          const rt = stateRef.current.diagnostics.realtimeStatus ?? 'unknown';
          return { ok: true, realtimeStatus: rt };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'tick_error' };
        }
      },
      onStatusChange: (snapshot) => {
        setState((s) => ({
          ...s,
          diagnostics: {
            ...s.diagnostics,
            runtimeStatus: snapshot.status,
            runtimeReason: snapshot.reason,
            agentRunning: snapshot.isProcessing,
          },
        }));
      },
    });

    // اختبار الاتصال بالخادم فوراً → يُعالج "Backend متوقف" رغم وجود خادم مُضاف
    if (online && currentSettings.activeServerProfileId) {
      probeBackend().then((ok) => {
        // إذا نجح الاتصال → جلب الطلبات مباشرةً
        if (ok) {
          refreshOrders().catch(() => undefined);
        }
      }).catch(() => undefined);
    }

    // تشغيل realtime فوراً بدل الانتظار لـ useEffect
    if (currentSettings.activeServerProfileId && currentDevice.deviceId) {
      startRealtimeSync(
        (status) => {
          setState((s) => ({
            ...s,
            isPolling: status === 'connected' || status === 'disconnected',
            diagnostics: { ...s.diagnostics, realtimeStatus: status },
          }));
        },
        async () => { await refreshOrders(); }
      );
      // جلب الطلبات دائماً عند التشغيل (بغض النظر عن نتيجة probeBackend)
      refreshOrders().catch(() => undefined);
    }
  }, [checkOnline, stateRef, refreshOrders, probeBackend]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    const next = { ...settings, enabled };
    setSettings(next);
    await saveSettings(next);

    if (enabled) {
      await doStartAgent(next, deviceState);
      // تشغيل Foreground Service لمنع Android من قتل العملية في الخلفية
      startForegroundService('الوكيل يراقب المدفوعات...').catch(() => undefined);
    } else {
      stopRuntime();
      stopRealtimeSync();
      // إيقاف Foreground Service عند تعطيل الوكيل
      stopForegroundService().catch(() => undefined);
      setState((s) => ({
        ...s,
        isPolling: false,
        diagnostics: {
          ...s.diagnostics,
          runtimeStatus: 'DISABLED',
          runtimeReason: null,
          agentRunning: false,
          realtimeStatus: 'disconnected',
        },
      }));
    }

    // تحديث diagnostics لتعكس الحالة الحقيقية
    await runDiagnostics();
  }, [settings, deviceState, doStartAgent, runDiagnostics]);

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

  // تحميل الإعدادات وحالة الجهاز عند البدء — مع startup recovery كامل
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

      // طلب أذونات SMS والإشعارات تلقائياً عند أول تشغيل
      let permissions = await getPermissionSnapshot();
      if (permissions.sms !== 'granted') {
        await requestSmsPermission();
        permissions = await getPermissionSnapshot();
      }

      const online = await checkOnline();
      const snapshot = buildStatusSnapshot(
        {
          settings: loadedSettings,
          deviceState: loadedDevice,
          permissions,
          online,
          databaseReady: true,
          backgroundAgent: loadedSettings.backgroundSyncEnabled,
          pendingSyncCount: 0,
          activeOrders: 0,
          lastError: null,
        },
        null
      );
      if (!active) return;
      setState((s) => ({
        ...s,
        isReady: true,
        isSmsPermissionGranted: permissions.sms === 'granted',
        listenerStatus: permissions.sms === 'granted' ? 'running' : 'stopped',
        connectionStatus: snapshot.connectionStatus,
        diagnostics: {
          ...s.diagnostics,
          agentRunning: snapshot.agentRunning,
          network: snapshot.network,
          smsReady: permissions.sms === 'granted',
          notifications: permissions.notifications === 'granted',
          backgroundAgent: snapshot.backgroundAgent,
          deviceRegistered: snapshot.deviceRegistered,
          databaseReady: snapshot.databaseReady,
          backendStatus: snapshot.backendStatus,
          realtimeStatus: snapshot.realtimeStatus,
        },
      }));
      if (permissions.notifications === 'granted' && loadedSettings.notificationsEnabled) {
        await setupNotifications();
      }
      if (loadedSettings.backgroundSyncEnabled) {
        await registerBackgroundSync();
      }

      // FIX RC#5: Startup Recovery يُشغَّل دائماً لاستعادة الخادم،
      // بغض النظر عن enabled أو deviceId.
      // استعادة الخادم يتم في dbReady (self-healing migration).
      // هنا نُشغّل مزامنة البيانات فقط إذا كان الوكيل مفعّلاً.
      try {
        await onStartupRecovery(loadedDevice);
      } catch (e) {
        await logEvent('startup_recovery_warn', e instanceof Error ? e.message : 'startup_recovery_failed');
      }

      // FIX RC#4: إعادة تحميل الإعدادات بعد startup recovery
      // لأن dbReady قد استعاد active_server_profile_id الذي كان غائباً.
      const finalSettings = await loadSettings();
      if (!active) return;
      if (finalSettings.activeServerProfileId !== loadedSettings.activeServerProfileId) {
        setSettings(finalSettings);
      }

      setInitDone(true);
    })();

    return () => {
      active = false;
    };
  }, []);

  // مراقبة حالة التطبيق والشبكة
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      const wasActive = appActive.current;
      appActive.current = nextState === 'active';

      // عند رجوع التطبيق للواجهة بعد الخلفية
      if (!wasActive && nextState === 'active' && settings.enabled && deviceState.deviceId) {
        const online = await checkOnline();
        if (online) {
          reconnectRealtime().catch(() => undefined);
          // إعادة فحص الخادم + جلب الطلبات عند العودة للواجهة
          probeBackend().then((ok) => {
            if (ok) refreshOrders().catch(() => undefined);
          }).catch(() => undefined);
        }
        resumeRuntime(online).catch(() => undefined);
        runDiagnostics().catch(() => undefined);
      }
    });

    // مراقبة دورية للشبكة كـ fallback (كل 10 ثوانٍ)
    networkTimer.current = setInterval(() => {
      monitorNetwork();
    }, 10_000);

    // Network listener: event-driven (فوري) + يُعلم Runtime
    const networkSubscription = Network.addNetworkStateListener(async (event) => {
      const isConnected = Boolean(event.isConnected);
      setState((s) => ({
        ...s,
        diagnostics: {
          ...s.diagnostics,
          network: isConnected ? 'ONLINE' : 'OFFLINE',
        },
      }));
      // إعلام Runtime وRealtime بتغيير الشبكة
      await notifyNetworkChange(isConnected);
      if (isConnected && settings.enabled && deviceState.deviceId) {
        reconnectRealtime().catch(() => undefined);
        // تشغيل تسلسل الاسترداد الكامل عند استعادة الشبكة
        onNetworkRestored({
          deviceState,
          gracefulDelayMs: 800,
          notifyOnComplete: settings.notificationsEnabled,
          onNotify: emitNotification,
          onStep: (step, total, label) => {
            // يمكن استخدامها لعرض progress في UI مستقبلاً
          },
        }).catch(() => undefined);
      }
    });

    return () => {
      subscription.remove();
      networkSubscription?.remove();
      if (networkTimer.current) {
        clearInterval(networkTimer.current);
        networkTimer.current = null;
      }
    };
  }, [monitorNetwork, settings.enabled, settings.notificationsEnabled, deviceState, checkOnline, runDiagnostics, emitNotification]);

  // إعادة مزامنة تلقائية عند الانتقال من Offline إلى Online
  useEffect(() => {
    if (!state.isReady || !deviceState.deviceId || !settings.enabled || !settings.activeServerProfileId) return;
    if (state.connectionStatus === 'OFFLINE') {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      const timer = setTimeout(() => {
        syncOfflineQueue();
        refreshOrders();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [state.connectionStatus, state.isReady, deviceState.deviceId, settings.enabled, settings.activeServerProfileId, syncOfflineQueue, refreshOrders]);

  // ── Notification Listener — يعالج إشعارات تطبيقات الدفع (InstaPay / فودافون كاش) ────
  useEffect(() => {
    if (process.env.EXPO_OS !== 'android') return;

    const subscription = Notifications.addNotificationReceivedListener(async (notification) => {
      if (!settings.enabled) return;

      const packageId: string =
        (notification.request.trigger as Record<string, unknown>)?.packageName as string
        ?? '';
      const title  = notification.request.content.title  ?? '';
      const body   = notification.request.content.body   ?? '';

      if (!packageId && !body) return;

      const pending = pendingOrdersRef.current.filter((o) =>
        ['new', 'scanning', 'matched', 'review_required'].includes(o.localStatus ?? 'new')
      );

      try {
        const outcome = await processNotificationMessage(
          packageId,
          title,
          body,
          pending,
          {
            requireSourceVerification: settings.requireSourceVerification,
            autoConfirm: settings.autoConfirm,
            existingSmsEvidence: null,
          }
        );

        switch (outcome.action) {
          case 'SOURCE_REJECTED':
          case 'PARSE_FAILED':
          case 'PROVIDER_NOT_CONFIGURED':
            return;

          case 'DUPLICATE':
            await logDiagnosticEvent(
              'notification_duplicate',
              `إشعار مكرر: ${outcome.fingerprint}`,
              { severity: 'INFO', module: 'matching', dedupKey: `notif_dup:${outcome.fingerprint}` }
            );
            return;

          case 'NO_MATCH':
            await logVerification('', 'notification_no_match', 'no_match',
              `${outcome.matchCode}: ${outcome.reasons.join(' • ')}`, undefined, packageId
            );
            return;

          case 'INSUFFICIENT_EVIDENCE':
            return;

          case 'REVIEW': {
            await updateOrderLocal(outcome.orderId, {
              localStatus: 'review_required',
              matchScore: outcome.score,
              verificationCode: outcome.matchCode,
              verificationScore: outcome.score,
              syncStatus: 'pending',
            } as any);
            await emitNotification('Nader Pay', 'تطابق جزئي عبر إشعار — يحتاج مراجعة', { orderId: outcome.orderId });
            return;
          }

          case 'CONFIRMED': {
            await updateOrderLocal(outcome.orderId, {
              localStatus: 'matched',
              matchScore: outcome.score,
              verificationCode: outcome.matchCode,
              verificationScore: outcome.score,
              canonicalId: outcome.canonical.canonicalId,
              syncStatus: 'pending',
            } as any);
            await emitNotification('Nader Pay', 'تم التحقق من الدفع عبر الإشعار', { orderId: outcome.orderId });
            await logVerification(outcome.orderId, 'match', 'matched',
              `notification | ${outcome.matchCode} | score=${outcome.score}`, undefined, packageId
            );
            if (settings.autoConfirm) {
              const orderRow = pendingOrdersRef.current.find((o) => o.id === outcome.orderId);
              if (orderRow) {
                await sendEvidence(orderRow, {
                  transactionId: outcome.canonical.normalized.transactionId,
                  amount: outcome.canonical.normalized.amount,
                  currency: outcome.canonical.normalized.currency,
                  senderPhone: outcome.canonical.normalized.senderPhone,
                  receiverPhone: outcome.canonical.normalized.receiverWallet,
                  sourceVerified: true,
                  providerId: outcome.canonical.providerId,
                  canonicalId: outcome.canonical.canonicalId,
                });
              }
            }
            return;
          }
        }
      } catch (err) {
        await logEvent('notification_pipeline_error',
          err instanceof Error ? err.message : 'خطأ في notification pipeline',
          { packageId }
        );
      }
    });

    return () => subscription.remove();
  }, [settings, emitNotification, sendEvidence, logVerification, logEvent]);

  // autoStart: إذا كان الوكيل مفعّلاً في الإعدادات، يبدأ تلقائياً عند إتمام التهيئة
  useEffect(() => {
    if (!initDone || !settings.enabled || !deviceState.deviceId || !settings.activeServerProfileId) {
      // إيقاف realtime إذا لم تكتمل الشروط
      if (initDone && (!settings.enabled || !deviceState.deviceId || !settings.activeServerProfileId)) {
        stopRealtimeSync();
        setState((s) => ({
          ...s,
          isPolling: false,
          diagnostics: { ...s.diagnostics, realtimeStatus: 'disconnected' },
        }));
      }
      return;
    }
    // الوكيل مفعّل + الجهاز مسجّل + خادم نشط → تشغيل تلقائي + Foreground Service
    doStartAgent(settings, deviceState).catch(() => undefined);
    startForegroundService('الوكيل يراقب المدفوعات...').catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initDone]);

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
