import { supabase } from '@/client/supabase';
import type {
  ServerProfile,
  BackendApiContract,
  ConnectionTestResult,
  BackendRequestMeta,
} from '@/types/backend';
import { resolveEndpoint, buildAbsoluteUrl } from './apiDiscovery';

/** توليد UUID آمن متوافق مع Hermes (React Native) */
function generateUUID(): string {
  // Hermes لا يدعم crypto.randomUUID — نستخدم Math.random كبديل آمن
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let lastRequestMeta: BackendRequestMeta | null = null;

export function getLastBackendRequestMeta(): BackendRequestMeta | null {
  return lastRequestMeta;
}

function buildAuthHeaders(profile: ServerProfile): Record<string, string> {
  const headers: Record<string, string> = {};
  const auth = profile.apiContract?.auth;
  const prefix = auth?.prefix || (auth?.type === 'bearer' ? 'Bearer' : '');
  const headerName = auth?.header || 'Authorization';

  if (auth?.type === 'api_key' && profile.apiKey) {
    if (auth.in === 'query') {
      // Caller must add query params separately; query path is handled by request building
    } else {
      headers[headerName] = profile.apiKey;
    }
  }

  if ((auth?.type === 'bearer' || profile.authType === 'bearer') && profile.token) {
    headers[headerName] = prefix ? `${prefix} ${profile.token}`.trim() : profile.token;
  }

  if ((auth?.type === 'basic' || profile.authType === 'basic') && profile.username && profile.password) {
    let encoded = '';
    try {
      encoded = typeof btoa === 'function' ? btoa(`${profile.username}:${profile.password}`) : '';
    } catch {
      encoded = '';
    }
    if (encoded) headers[headerName] = `Basic ${encoded}`;
  }

  if ((auth?.type === 'custom' || profile.authType === 'custom') && profile.customHeaders) {
    Object.assign(headers, profile.customHeaders);
  }

  return headers;
}

export async function sendBackendRequest(
  profile: ServerProfile,
  options: {
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    query?: Record<string, string>;
    extraHeaders?: Record<string, string>;
  }
): Promise<ConnectionTestResult> {
  const { url, method = 'GET', body, query, extraHeaders = {} } = options;
  const startedAt = new Date().toISOString();
  const requestId = generateUUID();
  const headers = { ...buildAuthHeaders(profile), ...extraHeaders };

  lastRequestMeta = {
    endpoint: url,
    method,
    requestId,
    startedAt,
  };

  try {
    const { data, error } = await supabase.functions.invoke('backend-proxy', {
      method: 'POST',
      body: { url, method, headers, body, query },
    });

    if (error) {
      const errorMsg = await (error as any)?.context?.text?.().catch(() => null);
      const meta: BackendRequestMeta = {
        ...lastRequestMeta,
        finishedAt: new Date().toISOString(),
        error: errorMsg || error.message,
      };
      lastRequestMeta = meta;
      return {
        ok: false,
        error: errorMsg || error.message,
        endpoint: url,
        method,
        requestId,
      };
    }

    const result = data as {
      ok: boolean;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: unknown;
      requestId: string;
    };

    const meta: BackendRequestMeta = {
      ...lastRequestMeta,
      responseStatus: result.status,
      responseBody: result.body,
      finishedAt: new Date().toISOString(),
    };
    lastRequestMeta = meta;

    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      endpoint: url,
      method,
      responseBody: result.body,
      requestId: result.requestId,
      authOk: result.status !== 401 && result.status !== 403,
    };
  } catch (err) {
    const meta: BackendRequestMeta = {
      ...lastRequestMeta,
      finishedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : 'Proxy request failed',
    };
    lastRequestMeta = meta;
    return {
      ok: false,
      endpoint: url,
      method,
      requestId,
      error: err instanceof Error ? err.message : 'Proxy request failed',
    };
  }
}

export async function testConnection(profile: ServerProfile): Promise<ConnectionTestResult> {
  const configUrl = profile.discoveryUrl
    ? buildAbsoluteUrl(profile.baseUrl, profile.discoveryUrl)
    : buildAbsoluteUrl(profile.baseUrl, '/config');
  return sendBackendRequest(profile, { url: configUrl, method: 'GET' });
}

export async function fetchOrders(
  profile: ServerProfile,
  params?: { status?: string; since?: string; limit?: number }
): Promise<{ ok: boolean; orders?: unknown[]; error?: string; requestId?: string }> {
  const endpoint = profile.apiContract
    ? resolveEndpoint(profile.apiContract, 'orders')
    : buildAbsoluteUrl(profile.baseUrl, '/orders');
  if (!endpoint) {
    return { ok: false, error: 'Orders endpoint not configured' };
  }

  const query: Record<string, string> = {};
  if (params?.status) query.status = params.status;
  if (params?.since) query.since = params.since;
  if (params?.limit) query.limit = String(params.limit);

  const result = await sendBackendRequest(profile, { url: endpoint, method: 'GET', query });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || `HTTP ${result.status}`,
      requestId: result.requestId,
    };
  }

  const body = result.responseBody;
  let orders: unknown[] = [];
  if (Array.isArray(body)) {
    orders = body;
  } else if (body && typeof body === 'object' && 'orders' in body) {
    const ordersField = (body as { orders?: unknown[] }).orders;
    if (Array.isArray(ordersField)) orders = ordersField;
  }

  return { ok: true, orders, requestId: result.requestId };
}

export async function postOrderAction(
  profile: ServerProfile,
  action: 'receive' | 'verify' | 'confirm' | 'reject' | 'duplicate',
  orderId: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; error?: string; requestId?: string }> {
  const endpoint = profile.apiContract
    ? resolveEndpoint(profile.apiContract, action, { id: orderId })
    : buildAbsoluteUrl(profile.baseUrl, `/orders/${orderId}/${action}`);
  if (!endpoint) {
    return { ok: false, error: `${action} endpoint not configured` };
  }

  const result = await sendBackendRequest(profile, { url: endpoint, method: 'POST', body: payload });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || `HTTP ${result.status}`,
      requestId: result.requestId,
    };
  }
  return { ok: true, requestId: result.requestId };
}

export async function registerDeviceWithBackend(
  profile: ServerProfile,
  deviceInfo: { deviceName: string; platform: string; appVersion: string; androidVersion: string; installationId?: string }
): Promise<{ ok: boolean; deviceId?: string; deviceToken?: string; error?: string }> {
  const endpoint = profile.apiContract
    ? resolveEndpoint(profile.apiContract, 'deviceRegister')
    : buildAbsoluteUrl(profile.baseUrl, '/device/register');
  if (!endpoint) {
    return { ok: false, error: 'Device register endpoint not configured' };
  }

  const result = await sendBackendRequest(profile, {
    url: endpoint,
    method: 'POST',
    body: {
      device_name: deviceInfo.deviceName,
      platform: deviceInfo.platform,
      app_version: deviceInfo.appVersion,
      android_version: deviceInfo.androidVersion,
      installation_id: deviceInfo.installationId,
    },
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error || `HTTP ${result.status}`,
    };
  }

  const body = result.responseBody as { device_id?: string; device_token?: string } | undefined;
  if (!body?.device_id || !body?.device_token) {
    return { ok: false, error: 'Device registration response missing device_id or device_token' };
  }

  return { ok: true, deviceId: body.device_id, deviceToken: body.device_token };
}

export async function sendHeartbeat(
  profile: ServerProfile,
  deviceId: string,
  deviceToken: string,
  payload: { listenerStatus: string; queueSize: number; appVersion: string; androidVersion: string }
): Promise<{ ok: boolean; error?: string }> {
  const endpoint = profile.apiContract
    ? resolveEndpoint(profile.apiContract, 'heartbeat', { id: deviceId })
    : buildAbsoluteUrl(profile.baseUrl, `/device/${deviceId}/heartbeat`);
  if (!endpoint) {
    return { ok: false, error: 'Heartbeat endpoint not configured' };
  }

  const result = await sendBackendRequest(profile, {
    url: endpoint,
    method: 'POST',
    body: {
      device_token: deviceToken,
      listener_status: payload.listenerStatus,
      sync_queue_size: payload.queueSize,
      app_version: payload.appVersion,
      android_version: payload.androidVersion,
    },
    extraHeaders: { 'x-device-token': deviceToken },
  });

  if (!result.ok) {
    return { ok: false, error: result.error || `HTTP ${result.status}` };
  }
  return { ok: true };
}

export function getContract(profile: ServerProfile): BackendApiContract | undefined {
  return profile.apiContract;
}
