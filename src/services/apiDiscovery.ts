import type { ServerProfile, BackendApiContract, DiscoveryResponse, ConnectionTestResult } from '@/types/backend';

const DEFAULT_DISCOVERY_PATHS = ['/config', '/.well-known/naderpay-agent', '/api/config', '/discovery'];
const DEFAULT_OPENAPI_PATHS = ['/openapi.json', '/swagger.json', '/api/openapi.json', '/api/swagger.json'];

export function buildAbsoluteUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

export async function discoverApi(
  profile: ServerProfile,
  request: (url: string, method?: 'GET' | 'POST', body?: unknown) => Promise<ConnectionTestResult>
): Promise<{
  contract?: BackendApiContract;
  testResult?: ConnectionTestResult;
  error?: string;
}> {
  // إذا كان الرابط هو backend-proxy v2، نستخدم الـ contract المحدد مسبقاً
  if (/\/functions\/v1\/backend-proxy$/i.test(profile.baseUrl)) {
    const url = buildAbsoluteUrl(profile.baseUrl, '/config');
    const result = await request(url, 'GET');
    if (result.ok) {
      return { contract: buildBackendProxyV2Contract(profile.baseUrl), testResult: result };
    }
    return { error: result.error || 'فشل اختبار الاتصال بـ backend-proxy v2' };
  }

  // Try discovery endpoints
  for (const path of DEFAULT_DISCOVERY_PATHS) {
    const url = buildAbsoluteUrl(profile.baseUrl, path);
    const result = await request(url, 'GET');
    if (result.ok && result.responseBody) {
      const contract = parseDiscoveryResponse(result.responseBody, profile.baseUrl, url);
      if (contract) {
        return { contract, testResult: result };
      }
    }
  }

  // Try OpenAPI metadata
  for (const path of DEFAULT_OPENAPI_PATHS) {
    const url = buildAbsoluteUrl(profile.baseUrl, path);
    const result = await request(url, 'GET');
    if (result.ok && result.responseBody) {
      const contract = parseOpenApiResponse(result.responseBody, profile.baseUrl);
      if (contract) {
        return { contract, testResult: result };
      }
    }
  }

  return { error: 'لم يتم العثور على نقطة اكتشاف API متوافقة' };
}

function buildBackendProxyV2Contract(baseUrl: string): BackendApiContract {
  return {
    baseUrl,
    discoveryEndpoint: buildAbsoluteUrl(baseUrl, '/config'),
    endpoints: {
      config: '/config',
      orders: '/orders',
      receive: '/orders/{id}/receive',
      verify: '/orders/{id}/verify',
      confirm: '/orders/{id}/confirm',
      reject: '/orders/{id}/reject',
      duplicate: '/orders/{id}/duplicate',
      deviceRegister: '/device/register',
      heartbeat: '/device/{id}/heartbeat',
    },
    auth: { type: 'bearer', in: 'header', prefix: 'Bearer' },
  };
}

function parseDiscoveryResponse(
  body: unknown,
  baseUrl: string,
  discoveryUrl: string
): BackendApiContract | null {
  if (!body || typeof body !== 'object') return null;
  const data = body as DiscoveryResponse;
  if (!data.endpoints || typeof data.endpoints !== 'object') return null;

  return {
    baseUrl,
    discoveryEndpoint: discoveryUrl,
    endpoints: data.endpoints,
    auth: data.auth ?? { type: 'bearer', in: 'header', prefix: 'Bearer' },
    realtime: data.realtime,
    orderSchema: data.orderSchema,
  };
}

function parseOpenApiResponse(body: unknown, baseUrl: string): BackendApiContract | null {
  if (!body || typeof body !== 'object') return null;
  const doc = body as { paths?: Record<string, unknown>; info?: { title?: string; version?: string } };
  if (!doc.paths) return null;

  const endpoints: BackendApiContract['endpoints'] = {};
  const knownKeys = ['orders', 'receive', 'verify', 'confirm', 'reject', 'duplicate', 'config', 'realtime', 'sync'];

  for (const [path, methods] of Object.entries(doc.paths)) {
    if (!methods || typeof methods !== 'object') continue;
    for (const key of knownKeys) {
      if (path.toLowerCase().includes(key) && !endpoints[key]) {
        endpoints[key] = path;
      }
    }
  }

  if (Object.keys(endpoints).length === 0) return null;

  return {
    baseUrl,
    endpoints,
    auth: { type: 'bearer', in: 'header', prefix: 'Bearer' },
  };
}

export function resolveEndpoint(contract: BackendApiContract, key: string, pathParams?: Record<string, string>): string | null {
  let path = contract.endpoints[key];
  if (!path) return null;

  if (pathParams) {
    for (const [param, value] of Object.entries(pathParams)) {
      path = path.replace(`{${param}}`, encodeURIComponent(value));
    }
  }

  return buildAbsoluteUrl(contract.baseUrl, path);
}
