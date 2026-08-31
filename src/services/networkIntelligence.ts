/**
 * networkIntelligence.ts
 * Network Intelligence — يُفرق بين حالات الشبكة بدقة.
 *
 * الحالات:
 *   ONLINE              — شبكة متصلة + Backend يستجيب
 *   UNSTABLE            — شبكة متصلة لكن Backend غير مستقر
 *   OFFLINE             — لا اتصال بالإنترنت
 *   BACKEND_UNREACHABLE — شبكة متصلة لكن Backend لا يستجيب
 *   AUTH_FAILURE        — Backend يرفض المصادقة (401/403)
 *   REALTIME_DISCONNECTED — Backend OK لكن Realtime غير متصل
 *   RECOVERING          — جارٍ استعادة الاتصال
 *
 * المبدأ: Wi-Fi/mobile connected ≠ Backend healthy
 */

import * as Network from 'expo-network';
import { logEvent } from '@/lib/database';
import { getActiveServerProfile } from '@/services/serverProfileManager';
import { backendCircuit } from '@/services/circuitBreaker';

export type NetworkState =
  | 'ONLINE'
  | 'UNSTABLE'
  | 'OFFLINE'
  | 'BACKEND_UNREACHABLE'
  | 'AUTH_FAILURE'
  | 'REALTIME_DISCONNECTED'
  | 'RECOVERING';

export type NetworkSnapshot = {
  networkState: NetworkState;
  deviceConnected: boolean;       // حالة الشبكة على المستوى الـ OS
  backendReachable: boolean;
  authValid: boolean;
  realtimeConnected: boolean;
  lastCheckedAt: string | null;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
  consecutiveBackendFailures: number;
};

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

let _snapshot: NetworkSnapshot = {
  networkState: 'OFFLINE',
  deviceConnected: false,
  backendReachable: false,
  authValid: false,
  realtimeConnected: false,
  lastCheckedAt: null,
  lastOnlineAt: null,
  lastOfflineAt: null,
  consecutiveBackendFailures: 0,
};

type StateChangeCallback = (snapshot: NetworkSnapshot) => void;
let _stateCallback: StateChangeCallback | null = null;

export function onNetworkStateChange(cb: StateChangeCallback): void {
  _stateCallback = cb;
}

export function getNetworkSnapshot(): NetworkSnapshot {
  return { ..._snapshot };
}

export function getNetworkState(): NetworkState {
  return _snapshot.networkState;
}

function update(partial: Partial<NetworkSnapshot>): void {
  const prev = _snapshot.networkState;
  _snapshot = { ..._snapshot, ...partial, lastCheckedAt: new Date().toISOString() };
  if (prev !== _snapshot.networkState) {
    logEvent('network_state_change', `${prev} → ${_snapshot.networkState}`).catch(() => undefined);
    _stateCallback?.(_snapshot);
  }
}

// ─────────────────────────────────────────────────────────────
// Device-Level Check
// ─────────────────────────────────────────────────────────────

export async function checkDeviceConnectivity(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Backend Reachability Check
// ─────────────────────────────────────────────────────────────

const BACKEND_PROBE_TIMEOUT_MS = 8_000;

export async function checkBackendReachability(): Promise<{
  reachable: boolean;
  authValid: boolean;
  status?: number;
}> {
  // إذا كان Circuit مفتوحاً → نعتبر Backend غير متاح بدون إرسال طلب
  if (!backendCircuit.canRequest()) {
    return { reachable: false, authValid: false, status: 0 };
  }

  try {
    const profile = await getActiveServerProfile();
    if (!profile) return { reachable: false, authValid: false };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BACKEND_PROBE_TIMEOUT_MS);

    const { fetch: expoFetch } = await import('expo/fetch');
    const response = await expoFetch(`${profile.baseUrl}/health`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${profile.token || ''}`,
        apikey: profile.token || '',
      },
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timeoutId);

    if (!response) {
      backendCircuit.recordFailure('TIMEOUT');
      return { reachable: false, authValid: false };
    }

    if (response.status === 401 || response.status === 403) {
      backendCircuit.recordFailure(`AUTH_${response.status}`);
      return { reachable: true, authValid: false, status: response.status };
    }

    if (response.status >= 200 && response.status < 500) {
      backendCircuit.recordSuccess();
      return { reachable: true, authValid: true, status: response.status };
    }

    backendCircuit.recordFailure(`HTTP_${response.status}`);
    return { reachable: false, authValid: false, status: response.status };
  } catch {
    backendCircuit.recordFailure('EXCEPTION');
    return { reachable: false, authValid: false };
  }
}

// ─────────────────────────────────────────────────────────────
// Full Network Assessment
// ─────────────────────────────────────────────────────────────

/**
 * تقييم كامل لحالة الشبكة.
 * يُحدّث الـ snapshot ويُطلق callbacks إذا تغيرت الحالة.
 */
export async function assessNetworkState(opts: {
  realtimeConnected?: boolean;
  skipBackendProbe?: boolean;
} = {}): Promise<NetworkSnapshot> {
  const now = new Date().toISOString();

  // 1. هل الجهاز متصل؟
  const deviceConnected = await checkDeviceConnectivity();

  if (!deviceConnected) {
    update({
      networkState: 'OFFLINE',
      deviceConnected: false,
      backendReachable: false,
      authValid: false,
      lastOfflineAt: now,
    });
    return _snapshot;
  }

  // 2. هل Backend يستجيب؟
  let backendReachable = _snapshot.backendReachable;
  let authValid = _snapshot.authValid;

  if (!opts.skipBackendProbe) {
    const probe = await checkBackendReachability();
    backendReachable = probe.reachable;
    authValid = probe.authValid;
  }

  // 3. تحديد الحالة المجمّعة
  let networkState: NetworkState;

  if (!backendReachable) {
    _snapshot.consecutiveBackendFailures++;
    if (_snapshot.consecutiveBackendFailures >= 2) {
      networkState = 'BACKEND_UNREACHABLE';
    } else {
      networkState = 'UNSTABLE';
    }
  } else if (!authValid) {
    networkState = 'AUTH_FAILURE';
    _snapshot.consecutiveBackendFailures = 0;
  } else {
    _snapshot.consecutiveBackendFailures = 0;
    const realtimeConn = opts.realtimeConnected ?? _snapshot.realtimeConnected;
    networkState = realtimeConn ? 'ONLINE' : 'REALTIME_DISCONNECTED';
  }

  update({
    networkState,
    deviceConnected: true,
    backendReachable,
    authValid,
    realtimeConnected: opts.realtimeConnected ?? _snapshot.realtimeConnected,
    lastOnlineAt: backendReachable ? now : _snapshot.lastOnlineAt,
  });

  return _snapshot;
}

/**
 * تحديث حالة Realtime بدون probe للـ Backend.
 */
export function updateRealtimeState(connected: boolean): void {
  const wasConnected = _snapshot.realtimeConnected;
  if (wasConnected === connected) return;

  let networkState = _snapshot.networkState;

  if (_snapshot.backendReachable && _snapshot.authValid) {
    networkState = connected ? 'ONLINE' : 'REALTIME_DISCONNECTED';
  }

  update({ realtimeConnected: connected, networkState });
}

/**
 * تحديث فوري عند تغيير شبكة الجهاز (من expo-network listener).
 */
export async function onDeviceNetworkChange(connected: boolean): Promise<void> {
  if (!connected) {
    update({
      networkState: 'OFFLINE',
      deviceConnected: false,
      backendReachable: false,
      lastOfflineAt: new Date().toISOString(),
    });
  } else if (_snapshot.networkState === 'OFFLINE') {
    update({ networkState: 'RECOVERING', deviceConnected: true });
    // تقييم كامل عند الاسترداد
    await assessNetworkState();
  }
}
