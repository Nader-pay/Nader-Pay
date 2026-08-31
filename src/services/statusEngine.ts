import type { PermissionSnapshot } from './permissionManager';
import type { AgentDiagnosticState, ConnectionStatus, DeviceState, AgentSettings } from '@/types/agent';

export type RealtimeDetailStatus =
  | 'connected'
  | 'polling'
  | 'disconnected'
  | 'error'
  | 'unavailable'
  | 'unknown';

export type BackendDetailStatus =
  | 'online'
  | 'offline'
  | 'error'
  | 'unknown'
  | 'unauthorized'
  | 'forbidden'
  | 'path_restricted'
  | 'invalid_config'
  | 'timeout'
  | 'server_error';

export type StatusSnapshot = {
  agentRunning: boolean;
  connectionStatus: ConnectionStatus;
  backendStatus: BackendDetailStatus;
  realtimeStatus: RealtimeDetailStatus;
  smsPermission: PermissionSnapshot['sms'];
  notificationsPermission: PermissionSnapshot['notifications'];
  deviceRegistered: boolean;
  databaseReady: boolean;
  network: 'ONLINE' | 'OFFLINE';
  backgroundAgent: boolean;
  pendingSyncCount: number;
  activeOrders: number;
  lastError: string | null;
};

/**
 * Status Engine: يحسب الحالة الحقيقية من المدخلات الفعلية.
 * لا يضع قيمًا افتراضية إيجابية.
 */
export function buildStatusSnapshot(
  params: {
    settings: AgentSettings;
    deviceState: DeviceState;
    permissions: PermissionSnapshot;
    online: boolean;
    databaseReady: boolean;
    backgroundAgent: boolean;
    pendingSyncCount: number;
    activeOrders: number;
    lastBackendMeta?: {
      responseStatus?: number;
      error?: string;
      endpoint?: string;
    } | null;
    realtimeStatus?: RealtimeDetailStatus;
    lastError?: string | null;
  },
  previous: AgentDiagnosticState | null
): StatusSnapshot {
  const deviceRegistered = Boolean(params.deviceState.deviceId && params.deviceState.deviceToken);

  const backendStatus = computeBackendStatus(params.online, params.lastBackendMeta);
  const realtimeStatus =
    params.realtimeStatus ??
    (previous?.realtimeStatus === 'connected' ? 'connected' : 'unknown');

  // agentRunning: يتطلب backend متصل فعلاً (online أو path_restricted = الخادم يعمل لكن health endpoint مقيد)
  // لا يعمل إذا كان unauthorized/forbidden/error/unknown/offline
  const backendReachable =
    backendStatus === 'online' || backendStatus === 'path_restricted';
  const agentRunning =
    params.settings.enabled &&
    deviceRegistered &&
    params.online &&
    Boolean(params.settings.activeServerProfileId) &&
    backendReachable;

  let connectionStatus: ConnectionStatus = 'CONNECTING';
  if (!params.online) {
    connectionStatus = 'OFFLINE';
  } else if (backendStatus === 'online' || backendStatus === 'path_restricted') {
    connectionStatus = 'ONLINE';
  } else if (
    backendStatus === 'error' ||
    backendStatus === 'unauthorized' ||
    backendStatus === 'forbidden' ||
    backendStatus === 'server_error' ||
    backendStatus === 'timeout'
  ) {
    connectionStatus = 'ERROR';
  }

  return {
    agentRunning,
    connectionStatus,
    backendStatus,
    realtimeStatus,
    smsPermission: params.permissions.sms,
    notificationsPermission: params.permissions.notifications,
    deviceRegistered,
    databaseReady: params.databaseReady,
    network: params.online ? 'ONLINE' : 'OFFLINE',
    backgroundAgent: params.backgroundAgent,
    pendingSyncCount: params.pendingSyncCount,
    activeOrders: params.activeOrders,
    lastError: params.lastError ?? null,
  };
}

function computeBackendStatus(
  online: boolean,
  meta?: {
    responseStatus?: number;
    error?: string;
    endpoint?: string;
  } | null
): BackendDetailStatus {
  if (!online) return 'offline';
  if (!meta) return 'unknown';

  if (meta.responseStatus === undefined || meta.responseStatus === null) {
    if (meta.error?.includes('timeout')) return 'timeout';
    if (meta.error) return 'error';
    return 'unknown';
  }

  if (meta.responseStatus >= 200 && meta.responseStatus < 300) return 'online';
  if (meta.responseStatus === 401) return 'unauthorized';
  if (meta.responseStatus === 403) {
    // نتحقق من body إذا كان Path not allowed = خادم يعمل لكن health endpoint مقيد
    const bodyStr = meta.error || '';
    if (bodyStr.includes('Path not allowed') || bodyStr.includes('path_restricted')) {
      return 'path_restricted';
    }
    return 'forbidden';
  }
  if (meta.responseStatus === 400) return 'invalid_config';
  if (meta.responseStatus === 408) return 'timeout';
  if (meta.responseStatus >= 500) return 'server_error';
  if (meta.responseStatus >= 404) return 'offline';

  return 'error';
}

export function statusColor(status: string): string {
  switch (status) {
    case 'online':
    case 'connected':
    case 'verified':
    case 'granted':
    case 'OK':
    case 'ONLINE':
      return '#22c55e';
    case 'path_restricted':
    case 'warning':
    case 'verifying':
    case 'selected':
    case 'CONNECTING':
    case 'SYNCING':
      return '#f59e0b';
    case 'error':
    case 'forbidden':
    case 'unauthorized':
    case 'disconnected':
    case 'failed':
    case 'denied':
    case 'offline':
      return '#ef4444';
    default:
      return '#6b7280';
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'online':
    case 'ONLINE':
      return 'متصل';
    case 'path_restricted':
      return 'متصل (مقيد)';
    case 'offline':
    case 'OFFLINE':
      return 'غير متصل';
    case 'connected':
      return 'متصل';
    case 'disconnected':
      return 'غير متصل';
    case 'polling':
      return 'Polling';
    case 'error':
      return 'خطأ';
    case 'unauthorized':
      return 'غير مصرح (401)';
    case 'forbidden':
      return 'محظور (403)';
    case 'invalid_config':
      return 'إعداد غير صحيح';
    case 'timeout':
      return 'Timeout';
    case 'server_error':
      return 'خطأ خادم';
    case 'verified':
      return 'موثق';
    case 'unverified':
      return 'غير موثق';
    case 'verifying':
      return 'جاري التوثيق';
    case 'selected':
      return 'مختار';
    case 'failed':
      return 'فشل التوثيق';
    case 'granted':
      return 'ممنوحة';
    case 'denied':
      return 'مرفوضة';
    default:
      return '—';
  }
}
