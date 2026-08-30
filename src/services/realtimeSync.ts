import { supabase } from '@/client/supabase';
import { getActiveServerProfile } from '@/services/serverProfileManager';
import { runSyncEngine } from '@/services/syncEngine';
import { loadDeviceState } from '@/services/agentSettings';
import type { AgentOrderStatus } from '@/types/agent';

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

const isSupabaseProfile = (profile: { baseUrl?: string | null } | null): boolean => {
  if (!profile?.baseUrl) return false;
  return /supabase\.co|supabase\.in/.test(profile.baseUrl) || profile.baseUrl.includes('supabase');
};

export type RealtimeStatus = 'connected' | 'disconnected' | 'error' | 'polling';

let currentChannel: ReturnType<typeof supabase.channel> | null = null;
let currentStatus: RealtimeStatus = 'disconnected';
let pollTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let statusCallback: ((status: RealtimeStatus) => void) | null = null;
let syncCallback: (() => void) | null = null;
let isStopped = true;
let retryAttempt = 0;
const POLL_INTERVAL_MS = 15000;
const MAX_RETRIES = 8;

export function getRealtimeStatus(): RealtimeStatus {
  return currentStatus;
}

function setStatus(status: RealtimeStatus) {
  currentStatus = status;
  statusCallback?.(status);
}

function reconnectDelay(): number {
  const base = Math.min(1000 * 2 ** retryAttempt, 30000);
  return base + Math.random() * 1000;
}

async function poll() {
  try {
    setStatus('polling');
    await runSyncEngine(await loadDeviceState());
    syncCallback?.();
  } catch {
    // ignore
  }
}

function startPolling() {
  if (pollTimer) return;
  setStatus('polling');
  poll();
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer as unknown as number);
    pollTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  if (isStopped) return;
  retryAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isStopped) {
      subscribeToRealtime();
    }
  }, reconnectDelay());
}

async function subscribeToRealtime() {
  if (isStopped) return;

  const profile = await getActiveServerProfile();
  if (!isSupabaseProfile(profile)) {
    startPolling();
    return;
  }

  stopPolling();

  if (currentChannel) {
    try {
      await supabase.removeChannel(currentChannel);
    } catch {
      // ignore
    }
    currentChannel = null;
  }

  const ds = await loadDeviceState();
  const deviceId = ds.deviceId;
  if (!deviceId) {
    startPolling();
    return;
  }

  currentChannel = supabase
    .channel('agent-orders')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `device_id=eq.${deviceId}`,
      },
      async () => {
        try {
          await runSyncEngine(await loadDeviceState());
          syncCallback?.();
        } catch {
          // ignore
        }
      }
    )
    .subscribe((status, err) => {
      if (isStopped) return;
      if (status === 'SUBSCRIBED') {
        retryAttempt = 0;
        setStatus('connected');
        // Trigger a sync immediately after connecting to catch any missed events.
        poll().catch(() => undefined);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        setStatus('error');
        if (currentChannel) {
          try {
            supabase.removeChannel(currentChannel);
          } catch {
            // ignore
          }
          currentChannel = null;
        }
        if (retryAttempt < MAX_RETRIES) {
          scheduleReconnect();
        } else {
          startPolling();
        }
      } else if (err) {
        setStatus('error');
        if (retryAttempt < MAX_RETRIES) {
          scheduleReconnect();
        } else {
          startPolling();
        }
      }
    });
}

export async function startRealtimeSync(
  onStatusChange?: (status: RealtimeStatus) => void,
  onSync?: () => void
): Promise<void> {
  isStopped = false;
  statusCallback = onStatusChange || null;
  syncCallback = onSync || null;
  retryAttempt = 0;
  await subscribeToRealtime();
}

export async function stopRealtimeSync(): Promise<void> {
  isStopped = true;
  stopPolling();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer as unknown as number);
    reconnectTimer = null;
  }
  if (currentChannel) {
    try {
      await supabase.removeChannel(currentChannel);
    } catch {
      // ignore
    }
    currentChannel = null;
  }
  currentStatus = 'disconnected';
  statusCallback = null;
  syncCallback = null;
}

export function triggerRealtimePoll(): Promise<void> {
  return poll();
}

export { STATUS_MAP };
