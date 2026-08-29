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
let statusCallback: ((status: RealtimeStatus) => void) | null = null;
let syncCallback: (() => void) | null = null;
const POLL_INTERVAL_MS = 15000;

export function getRealtimeStatus(): RealtimeStatus {
  return currentStatus;
}

function setStatus(status: RealtimeStatus) {
  currentStatus = status;
  statusCallback?.(status);
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

async function subscribeToRealtime() {
  const profile = await getActiveServerProfile();
  if (!isSupabaseProfile(profile)) {
    startPolling();
    return;
  }

  stopPolling();

  if (currentChannel) {
    await supabase.removeChannel(currentChannel);
    currentChannel = null;
  }

  const ds = await loadDeviceState();
  const deviceId = ds.deviceId;
  if (!deviceId) {
    startPolling();
    return;
  }

  // Generic realtime channel listening to public orders changes scoped to device
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
      if (status === 'SUBSCRIBED') {
        setStatus('connected');
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        setStatus('error');
        if (currentChannel) {
          supabase.removeChannel(currentChannel);
          currentChannel = null;
        }
        startPolling();
      } else if (err) {
        setStatus('error');
        startPolling();
      }
    });
}

export async function startRealtimeSync(
  onStatusChange?: (status: RealtimeStatus) => void,
  onSync?: () => void
): Promise<void> {
  statusCallback = onStatusChange || null;
  syncCallback = onSync || null;
  await subscribeToRealtime();
}

export async function stopRealtimeSync(): Promise<void> {
  stopPolling();
  if (currentChannel) {
    await supabase.removeChannel(currentChannel);
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
