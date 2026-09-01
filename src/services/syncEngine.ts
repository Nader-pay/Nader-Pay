import * as Network from 'expo-network';
import {
  getPendingOfflineQueue,
  updateOfflineQueueStatus,
  deleteOfflineQueueItem,
  updateOrderLocal,
  getCachedOrders,
  logEvent,
  classifyHttpError,
  computeNextRetryAt,
  type RetryClass,
  setOrderTimestamp,
  recordDedupEvent,
} from '@/lib/database';
import { getActiveServerProfile } from '@/services/serverProfileManager';
import { fetchOrders, postOrderAction } from '@/services/backendConnector';
import { normalizeOrder, normalizeOrderToInternal } from '@/services/orderNormalizer';
import { sendEvidenceEvent, sendRejectEvent } from '@/services/deviceRegistration';
import { loadDeviceState } from '@/services/agentSettings';
import type { DeviceState } from '@/types/agent';
import type { RawOrder } from '@/types/backend';

export type SyncResult = {
  fetched: number;
  processed: number;
  failed: number;
  remaining: number;
  skipped: number;
};

export type SyncItemResult =
  | { status: 'synced' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; retryClass: RetryClass; errorCode?: string; error?: string };

export async function checkNetworkOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return Boolean(state.isConnected);
  } catch {
    return false;
  }
}

/** جلب الطلبات من الخادم وتخزينها محلياً — يجلب كل الحالات لضمان اكتمال البيانات */
export async function fetchPendingOrders(): Promise<{ ok: boolean; count?: number; error?: string }> {
  try {
    const profile = await getActiveServerProfile();
    if (!profile) return { ok: false, error: 'No active server profile' };

    // جلب كل الطلبات بدون فلتر status حتى تظهر الملغية والمرفوضة والقديمة
    const result = await fetchOrders(profile, { limit: 500 });
    if (!result.ok) return { ok: false, error: result.error || 'Failed to fetch orders' };

    const orders = (result.orders || []).map((o) => normalizeOrder(o as RawOrder));
    const internals = orders.map((o) => normalizeOrderToInternal(o));

    const cached = await getCachedOrders();
    const cachedMap = new Map(cached.map((c) => [c.id, c]));

    const merged = internals.map((o) => {
      const existing = cachedMap.get(o.id);
      if (existing) {
        // الحفاظ على البيانات المحلية المخصّبة ولا نستبدلها بقيم الخادم
        return {
          ...o,
          local_status: existing.local_status || o.local_status,
          sync_status: existing.sync_status || o.sync_status,
          raw_sms: existing.raw_sms || o.raw_sms,
          matched_transaction: existing.matched_transaction || undefined,
          verification_payload: existing.verification_payload || undefined,
          // الحفاظ على timestamps المحلية — لا نستبدلها بأوقات الجلب
          sms_received_at: (existing as any).sms_received_at ?? undefined,
          first_seen_local_at: (existing as any).first_seen_local_at ?? undefined,
          verified_at: (existing as any).verified_at ?? undefined,
        };
      }
      return o;
    });

    const { cacheOrders } = await import('@/lib/database');
    await cacheOrders(merged);

    // تسجيل first_seen_local_at للطلبات الجديدة فقط
    const now = new Date().toISOString();
    for (const o of merged) {
      if (!cachedMap.has(o.id)) {
        await setOrderTimestamp(o.id, 'first_seen_local_at', now);
      }
    }

    await logEvent('sync_orders', `Fetched ${merged.length} orders`, { count: merged.length });
    return { ok: true, count: merged.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unexpected error';
    await logEvent('sync_orders_error', error);
    return { ok: false, error };
  }
}

/** معالجة عنصر واحد من قائمة الانتظار — يُعيد نتيجة تصنيفية */
async function processSingleQueueItem(
  item: Awaited<ReturnType<typeof getPendingOfflineQueue>>[number],
  ds: DeviceState,
  profile: Awaited<ReturnType<typeof getActiveServerProfile>>
): Promise<SyncItemResult> {
  const payload = (typeof item.payload === 'string'
    ? JSON.parse(item.payload)
    : item.payload) as Record<string, unknown>;

  // فحص idempotency — إذا كان الخادم سبق وأكّد هذه العملية نعتبرها synced
  const idempotencyKey = item.idempotency_key;

  let backendStatus = 0;
  let responseBody: unknown = null;

  try {
    if (item.action === 'confirm') {
      const evidence = payload.evidence as Record<string, unknown> | undefined;
      const orderId = payload.orderId as string | undefined;
      const target = evidence ?? payload;
      if (!orderId && !evidence) return { status: 'skipped', reason: 'missing orderId or evidence' };

      const result = await sendEvidenceEvent(ds, target as any);
      backendStatus = (result as any).status ?? 0;
      if (result.ok) {
        if (orderId) await setOrderTimestamp(orderId, 'synced_at', new Date().toISOString());
        return { status: 'synced' };
      }
      // 409 Conflict = سبق التأكيد على الخادم = synced
      if (backendStatus === 409) return { status: 'synced' };
      const rc = classifyHttpError(backendStatus, result.error);
      return { status: 'failed', retryClass: rc, errorCode: String(backendStatus), error: result.error };

    } else if (item.action === 'reject') {
      const orderId = payload.orderId as string;
      const reason = payload.reason as string;
      if (!orderId) return { status: 'skipped', reason: 'missing orderId' };

      const result = await sendRejectEvent(ds, orderId, reason || 'manual_reject');
      backendStatus = (result as any).status ?? 0;
      if (result.ok) {
        await setOrderTimestamp(orderId, 'synced_at', new Date().toISOString());
        return { status: 'synced' };
      }
      if (backendStatus === 409) return { status: 'synced' };
      const rc = classifyHttpError(backendStatus, result.error);
      return { status: 'failed', retryClass: rc, errorCode: String(backendStatus), error: result.error };

    } else if (item.action === 'post') {
      const endpoint = payload.endpoint as string;
      const body = payload.body as Record<string, unknown>;
      const orderId = payload.orderId as string;
      const action = payload.actionType as 'receive' | 'verify' | 'confirm' | 'reject' | 'duplicate';
      if (!profile) return { status: 'skipped', reason: 'no profile' };

      let res: { ok: boolean; error?: string; status?: number };
      if (orderId && action) {
        res = await postOrderAction(profile, action, orderId, body);
      } else if (endpoint && body) {
        const { sendBackendRequest } = await import('@/services/backendConnector');
        res = await sendBackendRequest(profile, { url: endpoint, method: 'POST', body });
      } else {
        return { status: 'skipped', reason: 'invalid post item' };
      }

      backendStatus = (res as any).status ?? 0;
      if (res.ok) {
        if (orderId) await setOrderTimestamp(orderId, 'synced_at', new Date().toISOString());
        return { status: 'synced' };
      }
      if (backendStatus === 409) return { status: 'synced' };
      const rc = classifyHttpError(backendStatus, res.error);
      return { status: 'failed', retryClass: rc, errorCode: String(backendStatus), error: res.error };
    }

    return { status: 'skipped', reason: `unknown action: ${item.action}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unexpected';
    const rc = classifyHttpError(0, msg);
    return { status: 'failed', retryClass: rc, error: msg };
  }
}

/** مزامنة قائمة الانتظار المحلية مع الخادم */
export async function runSyncEngine(deviceState?: DeviceState): Promise<SyncResult> {
  const ds = deviceState ?? (await loadDeviceState());
  const profile = await getActiveServerProfile();
  const result: SyncResult = { fetched: 0, processed: 0, failed: 0, remaining: 0, skipped: 0 };

  if (!profile || !ds.deviceId || !ds.deviceToken) return result;
  if (!(await checkNetworkOnline())) return result;

  // 1. جلب الطلبات المعلقة من الخادم أولاً
  try {
    const fetchResult = await fetchPendingOrders();
    if (fetchResult.ok) result.fetched = fetchResult.count ?? 0;
  } catch { /* نكمل حتى لو فشل الجلب */ }

  // 2. معالجة قائمة الانتظار
  const queue = await getPendingOfflineQueue();

  for (const item of queue) {
    // تسجيل sync_started_at
    const orderId = (() => {
      try {
        const p = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
        return (p as Record<string, unknown>).orderId as string | undefined;
      } catch { return undefined; }
    })();
    if (orderId) await setOrderTimestamp(orderId, 'sync_started_at', new Date().toISOString());

    await updateOfflineQueueStatus(item.id, 'syncing', item.attempts + 1);
    const itemResult = await processSingleQueueItem(item, ds, profile);

    if (itemResult.status === 'synced') {
      await deleteOfflineQueueItem(item.id);
      if (orderId) await updateOrderLocal(orderId, { syncStatus: 'synced' });
      result.processed += 1;
    } else if (itemResult.status === 'skipped') {
      await deleteOfflineQueueItem(item.id);
      result.skipped += 1;
    } else {
      // failed
      const attempts = item.attempts + 1;
      const rc = itemResult.retryClass;
      const MAX_ATTEMPTS = rc === 'RETRYABLE' ? 8 : 3;

      if (rc === 'NON_RETRYABLE' || rc === 'PERMANENT_FAILURE' || rc === 'AUTH_REQUIRED' || rc === 'DUPLICATE' || attempts >= MAX_ATTEMPTS) {
        // علاّم بفشل دائم ولا نحذف — نحافظ على audit trail
        await updateOfflineQueueStatus(item.id, 'failed', attempts, { errorCode: itemResult.errorCode, retryClass: rc });
        if (orderId) await updateOrderLocal(orderId, { syncStatus: 'failed' });
      } else {
        await updateOfflineQueueStatus(item.id, 'pending', attempts, { errorCode: itemResult.errorCode, retryClass: rc });
        if (orderId) await updateOrderLocal(orderId, { syncStatus: 'failed' });
      }
      result.failed += 1;
    }
  }

  const remaining = await getPendingOfflineQueue();
  result.remaining = remaining.length;
  return result;
}

/** مصالحة الأحداث المحلية مع الطلبات الواردة — Phase 3 محسّن */
export async function reconcileLocalEvents(): Promise<{
  checked: number;
  matched: number;
  conflicts: number;
  inFlightRecovered: number;
}> {
  const result = { checked: 0, matched: 0, conflicts: 0, inFlightRecovered: 0 };
  try {
    const {
      getSyncCursor, setSyncCursor, getInFlightOrders,
      markOrderInFlight, clearOrderInFlight, addToDeadLetter,
    } = await import('@/lib/database');

    // 1. استرداد In-Flight orders من crash سابق
    const inFlight = await getInFlightOrders();
    for (const o of inFlight) {
      // أي طلب كان IN_FLIGHT وقت الـ crash → REVIEW
      const stage = (o.transaction_stage ?? 'RECEIVED') as import('./transactionLifecycle').TransactionStage;
      const { moveToReview } = await import('@/services/transactionLifecycle');
      await moveToReview(o.id, stage, 'in_flight_at_crash', 'reconcile');
      await clearOrderInFlight(o.id);
      result.inFlightRecovered++;
    }

    // 2. مصالحة SMS مع الطلبات المعلقة
    const cached = await getCachedOrders();
    const pending = cached.filter((o) =>
      ['new', 'scanning', 'review_required'].includes(o.local_status ?? 'new')
    );
    result.checked = pending.length;
    if (pending.length === 0) {
      await setSyncCursor('reconcile', { lastSyncedAt: new Date().toISOString(), checkpointStatus: 'valid' });
      return result;
    }

    const { findMatchingSmsInIndex } = await import('@/services/localSmsIndex');
    const cursor = await getSyncCursor('reconcile');
    const cursorAt = cursor?.last_synced_at ?? null;

    for (const order of pending) {
      // تجاوز الطلبات القديمة المصالحة مسبقاً إذا لم تتغير
      if (cursorAt && order.updated_at && order.updated_at < cursorAt
          && order.local_status !== 'review_required') continue;

      const matches = await findMatchingSmsInIndex({
        id: order.id,
        amount: order.amount,
        provider: order.provider as any,
        expected_sender_phone: order.expected_sender_phone ?? undefined,
        expected_recipient_wallet: order.expected_recipient_wallet ?? undefined,
        created_at: order.created_at,
      });

      if (matches.length === 0) continue;

      // فحص تعارض: نفس الـ SMS مرتبطة بأكثر من طلب
      const conflicting = matches.filter(
        (m) => (m as any).matched_order_id && (m as any).matched_order_id !== order.id
      );
      if (conflicting.length > 0) {
        result.conflicts++;
        const { moveToReview } = await import('@/services/transactionLifecycle');
        await moveToReview(
          order.id,
          (order.local_status as any) ?? 'RECEIVED',
          `SMS مرتبطة بطلب آخر: ${(conflicting[0] as any).matched_order_id}`,
          'reconcile'
        );
        await logEvent('reconcile_conflict', `تعارض SMS في الطلب ${order.id}`, {
          conflictingOrderId: (conflicting[0] as any).matched_order_id,
        });
        continue;
      }

      // مطابقة جديدة محتملة
      await logEvent('reconcile_match', `${matches.length} رسالة SMS مطابقة للطلب ${order.id}`, {
        orderId: order.id, count: matches.length,
      });
      const db2 = await import('@/lib/database').then((m) => m.dbReady);
      await db2.runAsync(
        "UPDATE orders_cache SET local_status = 'scanning' WHERE id = ? AND local_status IN ('new','review_required')",
        [order.id]
      );
      result.matched++;
    }

    // 3. تحديث sync cursor
    await setSyncCursor('reconcile', {
      lastSyncedAt: new Date().toISOString(),
      checkpointStatus: 'valid',
      metadata: { checked: result.checked, matched: result.matched, conflicts: result.conflicts },
    });

    await logEvent('reconcile_done', `مصالحة: ${result.checked} فُحص، ${result.matched} تطابق، ${result.conflicts} تعارض`);
  } catch (err) {
    await logEvent('reconcile_error', err instanceof Error ? err.message : 'unknown');
  }
  return result;
}
