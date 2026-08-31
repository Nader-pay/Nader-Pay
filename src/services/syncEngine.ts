import * as Network from 'expo-network';
import {
  getPendingOfflineQueue,
  updateOfflineQueueStatus,
  deleteOfflineQueueItem,
  updateOrderLocal,
  getCachedOrders,
  logEvent,
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
};

export async function checkNetworkOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return Boolean(state.isConnected);
  } catch {
    return false;
  }
}

export async function fetchPendingOrders(): Promise<{ ok: boolean; count?: number; error?: string }> {
  try {
    const profile = await getActiveServerProfile();
    if (!profile) {
      return { ok: false, error: 'No active server profile' };
    }

    const result = await fetchOrders(profile, { status: 'pending', limit: 500 });
    if (!result.ok) {
      return { ok: false, error: result.error || 'Failed to fetch orders' };
    }

    const orders = (result.orders || []).map((o) => normalizeOrder(o as RawOrder));
    const internals = orders.map((o) => normalizeOrderToInternal(o));

    const cached = await getCachedOrders();
    const cachedIds = new Set(cached.map((c) => c.id));

    const merged = internals.map((o) => {
      const existing = cached.find((c) => c.id === o.id);
      if (existing) {
        // Preserve locally enriched fields
        return {
          ...o,
          local_status: existing.local_status || o.local_status,
          sync_status: existing.sync_status || o.sync_status,
          raw_sms: existing.raw_sms || o.raw_sms,
          matched_transaction: existing.matched_transaction || undefined,
          verification_payload: existing.verification_payload || undefined,
        };
      }
      return o;
    });

    const { cacheOrders } = await import('@/lib/database');
    await cacheOrders(merged);
    await logEvent('sync_orders', `Fetched ${merged.length} orders`, { count: merged.length });

    return { ok: true, count: merged.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unexpected error';
    await logEvent('sync_orders_error', error);
    return { ok: false, error };
  }
}

export async function runSyncEngine(deviceState?: DeviceState): Promise<SyncResult> {
  const ds = deviceState ?? (await loadDeviceState());
  const profile = await getActiveServerProfile();
  const result: SyncResult = { fetched: 0, processed: 0, failed: 0, remaining: 0 };

  if (!profile || !ds.deviceId || !ds.deviceToken) {
    return result;
  }

  if (!(await checkNetworkOnline())) {
    return result;
  }

  // Fetch pending orders first
  try {
    const fetchResult = await fetchPendingOrders();
    if (fetchResult.ok) {
      result.fetched = fetchResult.count ?? 0;
    }
  } catch {
    // continue to process queue even if fetch fails
  }

  // Process offline queue
  const queue = await getPendingOfflineQueue();
  for (const item of queue) {
    await updateOfflineQueueStatus(item.id, 'syncing', item.attempts + 1);

    const payload = (typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload) as Record<string, unknown>;
    let ok = false;

    if (item.action === 'confirm') {
      const evidence = payload.evidence as Record<string, unknown> | undefined;
      const orderId = payload.orderId as string | undefined;
      if (evidence && orderId) {
        const result = await sendEvidenceEvent(ds, evidence as any);
        ok = result.ok;
      } else if (evidence) {
        const result = await sendEvidenceEvent(ds, evidence as any);
        ok = result.ok;
      }
    } else if (item.action === 'reject') {
      const orderId = payload.orderId as string;
      const reason = payload.reason as string;
      if (orderId) {
        const result = await sendRejectEvent(ds, orderId, reason || 'manual_reject');
        ok = result.ok;
      }
    } else if (item.action === 'post') {
      const endpoint = payload.endpoint as string;
      const body = payload.body as Record<string, unknown>;
      const orderId = payload.orderId as string;
      const action = payload.actionType as 'receive' | 'verify' | 'confirm' | 'reject' | 'duplicate';
      if (orderId && action && profile) {
        const res = await postOrderAction(profile, action, orderId, body);
        ok = res.ok;
      } else if (endpoint && body) {
        const { sendBackendRequest } = await import('@/services/backendConnector');
        const res = await sendBackendRequest(profile, { url: endpoint, method: 'POST', body });
        ok = res.ok;
      }
    }

    if (ok) {
      await deleteOfflineQueueItem(item.id);
      if (payload.orderId) {
        await updateOrderLocal(payload.orderId as string, { syncStatus: 'synced' });
      }
      result.processed += 1;
    } else {
      const attempts = item.attempts + 1;
      if (attempts >= 5) {
        await deleteOfflineQueueItem(item.id);
        if (payload.orderId) {
          await updateOrderLocal(payload.orderId as string, { syncStatus: 'failed' });
        }
      } else {
        await updateOfflineQueueStatus(item.id, 'pending', attempts);
        if (payload.orderId) {
          await updateOrderLocal(payload.orderId as string, { syncStatus: 'failed' });
        }
      }
      result.failed += 1;
    }
  }

  const remaining = await getPendingOfflineQueue();
  result.remaining = remaining.length;
  return result;
}
