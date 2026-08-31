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
// Polling كـ fallback فقط — بفاصل مناسب لا يستهلك البطارية
const POLL_INTERVAL_MS = 30_000;   // 30 ثانية — بدل 15s عدوانية
const POLL_FALLBACK_INTERVAL_MS = 60_000; // دقيقة كاملة بعد MAX_RETRIES
const MAX_RETRIES = 5;             // 5 محاولات ثم polling

export function getRealtimeStatus(): RealtimeStatus {
  return currentStatus;
}

function setStatus(status: RealtimeStatus) {
  if (currentStatus !== status) {
    currentStatus = status;
    statusCallback?.(status);
  }
}

function reconnectDelay(): number {
  const base = Math.min(1000 * 2 ** retryAttempt, 30000);
  return base + Math.random() * 1000;
}

async function poll() {
  if (isStopped) return;
  try {
    await runSyncEngine(await loadDeviceState());
    syncCallback?.();
  } catch {
    // تجاهل أخطاء polling — لا نغيّر الـ status
  }
}

function startPolling(interval = POLL_INTERVAL_MS) {
  if (pollTimer) return;
  // polling هو fallback فقط — نُخبر statusCallback بـ 'polling' لا 'connected'
  setStatus('polling');
  // تأخير بسيط قبل أول poll
  setTimeout(() => { if (!isStopped) poll(); }, 2000);
  pollTimer = setInterval(() => { if (!isStopped) poll(); }, interval);
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
    // خادم غير Supabase — polling كـ fallback
    startPolling(POLL_FALLBACK_INTERVAL_MS);
    return;
  }

  stopPolling();

  if (currentChannel) {
    try {
      await supabase.removeChannel(currentChannel);
    } catch {
      // تجاهل
    }
    currentChannel = null;
  }

  const ds = await loadDeviceState();
  const deviceId = ds.deviceId;
  if (!deviceId) {
    // جهاز غير مسجل — polling كـ fallback
    startPolling(POLL_FALLBACK_INTERVAL_MS);
    return;
  }

  // تمرير user JWT لـ Supabase Realtime (auth) عبر setAuth بدلاً من channel params
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      // @ts-ignore — setAuth موجودة في realtime-js لكن قد لا تُعرّف في typings القديمة
      supabase.realtime?.setAuth(session.access_token);
    }
  } catch {
    // نكمل بدون JWT إذا فشل
  }

  setStatus('disconnected'); // حالة انتقالية قبل SUBSCRIBED

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
        if (isStopped) return;
        try {
          await runSyncEngine(await loadDeviceState());
          syncCallback?.();
        } catch {
          // تجاهل
        }
      }
    )
    .subscribe((status, err) => {
      if (isStopped) return;
      if (status === 'SUBSCRIBED') {
        retryAttempt = 0;
        setStatus('connected');
        // مزامنة فورية بعد الاتصال لاستدراك أي events فاتت
        setTimeout(() => { if (!isStopped) poll().catch(() => undefined); }, 500);
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        setStatus('error');
        if (currentChannel) {
          try { supabase.removeChannel(currentChannel); } catch { /* تجاهل */ }
          currentChannel = null;
        }
        if (retryAttempt < MAX_RETRIES) {
          scheduleReconnect();
        } else {
          // استنفذنا المحاولات — polling بفاصل مناسب كـ fallback
          startPolling(POLL_FALLBACK_INTERVAL_MS);
        }
      } else if (err) {
        setStatus('error');
        if (retryAttempt < MAX_RETRIES) {
          scheduleReconnect();
        } else {
          startPolling(POLL_FALLBACK_INTERVAL_MS);
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
      // تجاهل
    }
    currentChannel = null;
  }
  currentStatus = 'disconnected';
  statusCallback = null;
  syncCallback = null;
}

/** إعادة الاتصال بعد network reconnect أو رجوع التطبيق للواجهة */
export async function reconnectRealtime(): Promise<void> {
  if (isStopped) return;
  // إيقاف الـ polling المؤقت وإعادة محاولة الـ realtime
  stopPolling();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer as unknown as number);
    reconnectTimer = null;
  }
  retryAttempt = 0;
  await subscribeToRealtime();
}

export function triggerRealtimePoll(): Promise<void> {
  return poll();
}

export { STATUS_MAP };
