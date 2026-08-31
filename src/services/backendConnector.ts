import type {
  ServerProfile,
  BackendApiContract,
  ConnectionTestResult,
  BackendRequestMeta,
} from '@/types/backend';
import { resolveEndpoint, buildAbsoluteUrl } from './apiDiscovery';
import { withCircuitBreaker, backendCircuit } from '@/services/circuitBreaker';
import {
  detectDeviceIdentityFromResponse,
  setDeviceIdentityState,
  handleDeviceRevocation,
  handleAuthExpiry,
  buildSecurityHeaders,
  scrubSensitiveData,
} from '@/services/securityGuard';

/** توليد UUID آمن متوافق مع Hermes (React Native) */
function generateUUID(): string {
  // Hermes لا يدعم crypto.randomUUID — نستخدم Math.random كبديل آمن
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * تحويل رسائل الخطأ التقنية من الخادم إلى نصوص عربية فهمها للمستخدم */
function humanizeBackendError(body: unknown, status: number): string | undefined {
  if (status < 400) return undefined;

  const error = (body as { error?: string; code?: string; message?: string } | undefined)?.error
    || (body as { code?: string; message?: string } | undefined)?.message
    || (body as string | undefined)
    || '';

  const errorText = typeof error === 'string' ? error : JSON.stringify(error);
  const errorJson: { code?: string; message?: string } | null = typeof error === 'string'
    ? null
    : (error as { code?: string; message?: string });
  const code = errorJson?.code || errorText;
  const message = errorJson?.message || errorText;

  if (status === 401 || status === 403) {
    // "Path not allowed" من backend-proxy ليس فشل مصادقة — بل قيد على المسار
    if (errorText.includes('Path not allowed') || errorText.includes('path not allowed')) {
      return `مسار مرفوض من الخادم (${status})`;
    }
    return 'فشل المصادقة: المفتاح غير صالح أو ليس لديك صلاحيات كافية';
  }
  if (code === 'NOT_FOUND' || message.includes('NOT_FOUND') || message.includes('was not found') || message.includes('لا يوجد')) {
    return 'نقطة النهاية غير موجودة. تأكد من استخدام /functions/v1/backend-proxy في Base URL';
  }
  if (status === 503) {
    return 'الخدمة معطلة حاليًا من الخادم';
  }
  // Phase 3 — تحديث Device Identity State من استجابة الخادم
  const identityState = detectDeviceIdentityFromResponse(status, body);
  if (identityState) {
    setDeviceIdentityState(identityState, errorText);
    if (identityState === 'REVOKED') {
      handleDeviceRevocation(errorText).catch(() => undefined);
    } else if (identityState === 'AUTH_EXPIRED') {
      handleAuthExpiry().catch(() => undefined);
    }
  }

  if (code === 'DEVICE_REVOKED') {
    return 'هذا الجهاز ملغى';
  }
  if (code === 'VERSION_BLOCKED') {
    return 'نسخة التطبيق محظورة';
  }
  if (code === 'UPDATE_REQUIRED') {
    return 'يجب تحديث التطبيق';
  }

  return undefined;
}

let lastRequestMeta: BackendRequestMeta | null = null;
// lastConnectionTestMeta: يُحدَّث فقط من testConnection ولا يُلوَّث بطلبات البيزنس
let lastConnectionTestMeta: BackendRequestMeta | null = null;

export function getLastBackendRequestMeta(): BackendRequestMeta | null {
  // نُعيد meta آخر اختبار اتصال فعلي حتى لا تلوّثه طلبات device/register أو orders
  return lastConnectionTestMeta ?? lastRequestMeta;
}

export const DEFAULT_NADERPAY_SERVER_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://hbldhnpduoczneoyfzyz.supabase.co'}/functions/v1/backend-proxy`;
export const DEFAULT_NADERPAY_ANON_TOKEN = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhibGRobnBkdW9jem5lb3lmenl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MzM2NzksImV4cCI6MjEwMzMwOTY3OX0.uT0Oy_AYcMIQe1VNrWLTnPCSiE141MntZbp3IgFLpxE';

function buildAuthHeaders(profile: ServerProfile): Record<string, string> {
  const headers: Record<string, string> = {};

  // للـ Supabase backend-proxy: إرسال Authorization: Bearer {token} و apikey مباشرة
  // نتجاهل apiContract.auth تماماً لتفادي double-prefix أو prefix خاطئ
  const isSupabase = /\.supabase\.co\/functions\/v1\//i.test(profile.baseUrl);
  const isAppProxy = profile.baseUrl.includes('hbldhnpduoczneoyfzyz') || profile.baseUrl.includes(process.env.EXPO_PUBLIC_SUPABASE_URL || 'hbldhnpduoczneoyfzyz');

  if (isSupabase) {
    // الخادم Supabase دائماً يحتاج Bearer token
    const token = profile.token || (isAppProxy ? DEFAULT_NADERPAY_ANON_TOKEN : '');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['apikey'] = token;
    }
    return headers;
  }

  // للخوادم غير Supabase: استخدام منطق authType العادي
  const authType = profile.authType;

  if (authType === 'bearer' && profile.token) {
    headers['Authorization'] = `Bearer ${profile.token}`;
  }

  if (authType === 'api_key' && profile.apiKey) {
    const auth = profile.apiContract?.auth;
    const headerName = auth?.header || 'Authorization';
    if (auth?.in !== 'query') {
      headers[headerName] = profile.apiKey;
    }
  }

  if (authType === 'basic' && profile.username && profile.password) {
    try {
      const encoded = typeof btoa === 'function' ? btoa(`${profile.username}:${profile.password}`) : '';
      if (encoded) headers['Authorization'] = `Basic ${encoded}`;
    } catch { /* ignore */ }
  }

  if (authType === 'custom' && profile.customHeaders) {
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
  const authHeaders = buildAuthHeaders(profile);

  lastRequestMeta = {
    endpoint: url,
    method,
    requestId,
    startedAt,
  };

  try {
    const baseUrl = profile.baseUrl.replace(/\/$/, '');
    // ننشط عمليات backend-proxy v2 إذا كان الـ Base URL ينتهي بـ backend-proxy
    const isBackendProxyV2 = /\/functions\/v1\/backend-proxy$/i.test(baseUrl);
    const targetUrl = isBackendProxyV2 ? baseUrl : url;
    const upstreamHeaders = isBackendProxyV2 ? authHeaders : { ...authHeaders, ...extraHeaders };

    let requestPayload: unknown;
    if (isBackendProxyV2) {
      // backend-proxy هو reverse-proxy عادي يتوقع: { url, method, headers, body, query }
      // حيث url = الرابط الكامل للـ Supabase Edge Function المستهدفة
      // نستخرج Supabase base (بدون /functions/v1/backend-proxy) ثم نضيف المسار الصحيح
      const supabaseBase = baseUrl.replace(/\/functions\/v1\/backend-proxy$/i, '');

      // نستخرج المسار من الـ url الذي يصلنا (قد يكون كاملاً أو نسبياً)
      let targetPath: string;
      if (url.startsWith(baseUrl)) {
        // url فيه baseUrl مضافاً — نستخرج المسار النسبي
        targetPath = url.slice(baseUrl.length).replace(/^\/+/, '');
      } else if (url.startsWith('http')) {
        // url كامل لخادم آخر — نُرسله مباشرة
        targetPath = '';
      } else {
        targetPath = url.replace(/^\/+/, '');
      }

      // نبني الـ upstream URL الكامل
      const upstreamUrl = targetPath
        ? `${supabaseBase}/functions/v1/${targetPath}`
        : url;

      const queryString = new URLSearchParams(query as Record<string, string>).toString();
      const finalUrl = queryString
        ? (upstreamUrl.includes('?') ? `${upstreamUrl}&${queryString}` : `${upstreamUrl}?${queryString}`)
        : upstreamUrl;

      requestPayload = { url: finalUrl, method, headers: { ...authHeaders, ...extraHeaders }, body };
    } else {
      // في الوضع المباشر أو الـ backend-proxy v1
      requestPayload = { url, method, headers: upstreamHeaders, body, query };
    }

    const { fetch: expoFetch } = await import('expo/fetch').catch(() => ({ fetch: globalThis.fetch }));
    const response = await expoFetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': requestId,
        ...upstreamHeaders,
      },
      body: JSON.stringify(requestPayload),
    });

    const responseText = await response.text();
    let data: unknown = null;
    try { data = JSON.parse(responseText); } catch { data = responseText; }

    if (!response.ok) {
      const status = response.status;
      const meta: BackendRequestMeta = {
        ...lastRequestMeta,
        finishedAt: new Date().toISOString(),
        error: `HTTP ${status}`,
      };
      lastRequestMeta = meta;
      return {
        ok: false,
        error: humanizeBackendError(data, status) || `HTTP ${status}`,
        endpoint: url,
        method,
        requestId,
      };
    }

    // لـ backend-proxy v2 — الرد يبدو مباشر من mobile-topup
    // لـ backend-proxy v1 — الرد ملفوف في { ok, status, statusText, headers, body, requestId }
    const isWrapped = data && typeof data === 'object' && 'ok' in data && 'status' in data && 'body' in data;
    const result = isWrapped
      ? (data as {
          ok: boolean;
          status: number;
          statusText: string;
          headers: Record<string, string>;
          body: unknown;
          requestId: string;
        })
      : {
          ok: true,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: data,
          requestId,
        };

    const meta: BackendRequestMeta = {
      ...lastRequestMeta,
      responseStatus: result.status,
      responseBody: result.body,
      finishedAt: new Date().toISOString(),
    };
    lastRequestMeta = meta;

    const friendlyError = humanizeBackendError(result.body, result.status);
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      endpoint: url,
      method,
      responseBody: result.body,
      requestId: result.requestId,
      authOk: result.status !== 401 && result.status !== 403,
      error: friendlyError,
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
  const baseUrl = profile.baseUrl.replace(/\/$/, '');
  const isBackendProxyV2 = /\/functions\/v1\/backend-proxy$/i.test(baseUrl);

  if (isBackendProxyV2) {
    // للـ backend-proxy v2: نرسل POST مع { path: "config", method: "GET" }
    // أي رد 2xx يعني نجاح الاتصال والمصادقة — لا نشترط شكل محدد للـ body
    const authHeaders = buildAuthHeaders(profile);
    const requestId = generateUUID();
    lastRequestMeta = {
      endpoint: baseUrl,
      method: 'POST',
      requestId,
      startedAt: new Date().toISOString(),
    };
    try {
      const { fetch: expoFetch } = await import('expo/fetch').catch(() => ({ fetch: globalThis.fetch }));

      const res = await expoFetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': requestId,
          ...authHeaders,
        },
        body: JSON.stringify({ action: 'health' }),
      });

      const text = await res.text();
      let data: unknown = null;
      try { data = JSON.parse(text); } catch { data = text; }

      // نُسجّل الـ responseStatus الحقيقي دائماً في lastConnectionTestMeta
      const realStatus = res.status;
      const connTestMeta: BackendRequestMeta = {
        ...lastRequestMeta,
        responseStatus: realStatus,
        responseBody: data,
        finishedAt: new Date().toISOString(),
      };
      lastRequestMeta = connTestMeta;
      lastConnectionTestMeta = connTestMeta;

      // أي رد من الخادم (حتى 4xx) يعني الاتصال يعمل والـ token وصل
      // "Path not allowed" أو "Missing or invalid url" = الخادم يعمل لكن health check مرفوض
      const bodyStr = typeof data === 'string' ? data : JSON.stringify(data ?? '');
      const isProxyReachable =
        res.ok ||
        bodyStr.includes('Path not allowed') ||
        bodyStr.includes('Missing or invalid url') ||
        bodyStr.includes('Invalid payload');

      if (isProxyReachable) {
        return {
          ok: true,
          status: realStatus,
          endpoint: baseUrl,
          method: 'POST',
          responseBody: data,
          requestId,
          authOk: res.ok || res.status < 500,
        };
      }

      // 401/403 حقيقي بدون رسالة proxy معروفة = فشل مصادقة
      return {
        ok: false,
        error: humanizeBackendError(data, realStatus) || `HTTP ${realStatus}`,
        endpoint: baseUrl,
        method: 'POST',
        requestId,
        authOk: false,
      };
    } catch (err) {
      const errMeta: BackendRequestMeta = {
        ...lastRequestMeta,
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'Connection failed',
      };
      lastRequestMeta = errMeta;
      lastConnectionTestMeta = errMeta;
      return {
        ok: false,
        endpoint: baseUrl,
        method: 'POST',
        requestId,
        error: err instanceof Error ? err.message : 'فشل الاتصال',
      };
    }
  }

  // خوادم عادية: استخدام discovery URL
  const discoveryUrl = profile.discoveryUrl || '/config';
  const configUrl = buildAbsoluteUrl(profile.baseUrl, discoveryUrl);
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
  deviceInfo: { deviceName: string; platform: string; appVersion: string; androidVersion: string; installationId?: string; userJwt?: string }
): Promise<{ ok: boolean; deviceId?: string; deviceToken?: string; error?: string }> {
  // نحدد endpoint التسجيل:
  // - إذا كان apiContract مُعرّفاً: نستخدمه
  // - وإلا: نُرسل عبر backend-proxy كـ upstream path مباشر
  let endpoint: string | null = null;
  if (profile.apiContract) {
    endpoint = resolveEndpoint(profile.apiContract, 'deviceRegister') ?? null;
  }
  if (!endpoint) {
    // backend-proxy الخاص بنا يُوكّل الطلب لـ Nader Pay device-api
    // نُمرر المسار النسبي فقط — sendBackendRequest سيبني الـ URL الكامل
    endpoint = 'device-api/register-with-auth';
  }

  // extraHeaders: إذا كان هناك user JWT نُمرره، وإلا نترك buildAuthHeaders يُرسل anon key
  const extraHeaders: Record<string, string> = {};
  if (deviceInfo.userJwt) {
    extraHeaders['Authorization'] = `Bearer ${deviceInfo.userJwt}`;
    extraHeaders['apikey'] = deviceInfo.userJwt;
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
    extraHeaders,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || `HTTP ${result.status}` };
  }

  // الرد من backend-proxy مُغلّف في { ok, status, body } — نستخرج body
  const wrapped = result.responseBody as { ok?: boolean; body?: { device_id?: string; device_token?: string }; device_id?: string; device_token?: string } | undefined;
  const bodyData = wrapped?.body ?? wrapped;
  const deviceId = bodyData?.device_id;
  const deviceToken = bodyData?.device_token;

  if (!deviceId || !deviceToken) {
    return { ok: false, error: 'استجابة التسجيل لا تحتوي على device_id أو device_token' };
  }

  return { ok: true, deviceId, deviceToken };
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
