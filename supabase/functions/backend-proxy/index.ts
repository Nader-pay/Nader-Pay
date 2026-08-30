import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS });
  }

  try {
    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return jsonResponse(400, { error: 'Invalid payload: expected JSON object' });
    }

    // Health check — يُستخدم لاختبار الاتصال من التطبيق
    if ((payload as Record<string, unknown>).action === 'health') {
      return jsonResponse(200, { ok: true, service: 'backend-proxy', ts: new Date().toISOString() });
    }

    const { url, method = 'GET', headers = {}, body, query = {} } = payload as {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      query?: Record<string, string>;
    };

    if (!url || typeof url !== 'string') {
      return jsonResponse(400, { error: 'Missing or invalid url' });
    }

    // Validate URL to prevent accidental internal network calls
    const target = new URL(url);
    if (!['http:', 'https:'].includes(target.protocol)) {
      return jsonResponse(400, { error: 'Only HTTP/HTTPS URLs are allowed' });
    }

    // Build final URL with query params
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        target.searchParams.set(key, String(value));
      }
    });

    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();

    const init: RequestInit = {
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Request-Id': requestId,
        ...headers,
      },
    };

    if (body !== undefined && body !== null && ['POST', 'PUT', 'PATCH'].includes(init.method as string)) {
      init.body = JSON.stringify(body);
    }

    const upstream = await fetch(target.toString(), init);
    const responseText = await upstream.text();
    let responseBody: unknown = responseText;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      // keep as plain text
    }

    return jsonResponse(
      upstream.status,
      {
        ok: upstream.ok,
        status: upstream.status,
        statusText: upstream.statusText,
        headers: Object.fromEntries(upstream.headers.entries()),
        body: responseBody,
        requestId,
      },
      { 'X-Request-Id': requestId }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy error';
    return jsonResponse(502, { error: message });
  }
});
