// Webhook Dispatcher v2 — HMAC-SHA256 signing, auth modes, retry, replay
import { adminClient, jsonOk, jsonErr, CORS, encryptSecret, decryptSecret, logSecurityEvent } from '../_shared/auth.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const encoder = new TextEncoder();

const retryDelays = [10, 30, 120, 600, 1800]; // seconds (v2 spec)
const WEBHOOK_VERSION = '2026-01';

function validateEndpoint(urlStr: string): { ok: true } | { ok: false; message: string } {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== 'https:') return { ok: false, message: 'يجب أن يبدأ بـ https://' };
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1') return { ok: false, message: 'localhost غير مسموح' };
    const blocked = ['10.', '172.16.', '192.168.', '127.', '169.254.', '0.0.0.0'];
    if (blocked.some(p => hostname.startsWith(p))) return { ok: false, message: 'رابط داخلي غير مسموح' };
    return { ok: true };
  } catch {
    return { ok: false, message: 'رابط غير صالح' };
  }
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function decryptSecretWithMigration(
  db: ReturnType<typeof adminClient>,
  secretId: string,
  encrypted: string
): Promise<string> {
  // Legacy plaintext secrets do not contain the iv.cipher separator
  if (!encrypted.includes('.')) {
    const plaintext = encrypted;
    const newEncrypted = await encryptSecret(plaintext);
    await db.from('webhook_secrets').update({ encrypted_secret: newEncrypted }).eq('id', secretId);
    return plaintext;
  }
  return decryptSecret(encrypted);
}

async function getActiveSecret(
  db: ReturnType<typeof adminClient>,
  accountId: string,
  endpointId?: string | null,
  integrationId?: string | null
): Promise<string | null> {
  // First: lookup by endpoint_id (new source of truth)
  if (endpointId) {
    const { data: secret } = await db.from('webhook_secrets')
      .select('id, encrypted_secret')
      .eq('account_id', accountId)
      .eq('endpoint_id', endpointId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (secret) return decryptSecretWithMigration(db, secret.id, secret.encrypted_secret);
  }
  // Fallback: legacy integration-bound secrets
  if (integrationId) {
    const { data: secret } = await db.from('webhook_secrets')
      .select('id, encrypted_secret')
      .eq('account_id', accountId)
      .eq('integration_id', integrationId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (secret) return decryptSecretWithMigration(db, secret.id, secret.encrypted_secret);
  }
  return null;
}

async function getActiveSecretForEndpoint(
  db: ReturnType<typeof adminClient>,
  accountId: string,
  endpointId: string,
  integrationId?: string | null
): Promise<string | null> {
  return getActiveSecret(db, accountId, endpointId, integrationId);
}

async function storeWebhookSecret(
  db: ReturnType<typeof adminClient>,
  accountId: string,
  secret: string,
  endpointId: string,
  integrationId?: string | null
): Promise<void> {
  const secretHash = await crypto.subtle.digest('SHA-256', encoder.encode(secret)).then((b) =>
    Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('')
  );
  const encrypted = await encryptSecret(secret);
  await db.from('webhook_secrets').insert({
    account_id: accountId,
    endpoint_id: endpointId,
    integration_id: integrationId ?? null,
    secret_hash: secretHash,
    encrypted_secret: encrypted,
    status: 'active',
  });
}

async function revokeEndpointSecrets(
  db: ReturnType<typeof adminClient>,
  accountId: string,
  endpointId: string
): Promise<void> {
  await db.from('webhook_secrets')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('endpoint_id', endpointId)
    .eq('status', 'active');
}

function generateWebhookSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function parseApiKeyFromEnv(envName: string): Promise<{ id: string; keyId: string; secret: string; environment: string } | null> {
  const full = Deno.env.get(envName);
  if (!full || !full.includes(':')) return null;
  const [keyId, secret] = full.split(':');
  if (!keyId || !secret) return null;
  return { id: 'env', keyId, secret, environment: 'sandbox' };
}

async function getApiCredentialForEndpoint(
  db: ReturnType<typeof adminClient>,
  accountId: string,
  endpoint: Record<string, unknown>
): Promise<{ id: string; keyId: string; secret: string; environment: string } | null> {
  const integrationId = endpoint.integration_id as string | null;
  let apiCredentialId: string | null = null;
  let environment = (endpoint.environment as string) ?? 'sandbox';

  if (integrationId) {
    const { data: integration } = await db.from('integrations')
      .select('api_credential_id, environment')
      .eq('id', integrationId)
      .eq('account_id', accountId)
      .maybeSingle();
    apiCredentialId = integration?.api_credential_id ?? null;
    environment = integration?.environment ?? environment;
  }

  const query = db.from('api_credentials')
    .select('id, key_id, encrypted_secret, environment')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .eq('environment', environment);
  if (apiCredentialId) query.eq('id', apiCredentialId);

  // Use limit(1) before maybeSingle() because maybeSingle() returns null when the
  // unbounded query would return multiple rows.
  const { data: cred } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cred && cred.encrypted_secret) {
    try {
      const secret = await decryptSecret(cred.encrypted_secret);
      return { id: cred.id, keyId: cred.key_id, secret, environment: cred.environment };
    } catch {
      // fall through to broader fallbacks
    }
  }

  // Fallback 1: any active credential for this account regardless of environment
  const { data: anyCred } = await db.from('api_credentials')
    .select('id, key_id, encrypted_secret, environment')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (anyCred && anyCred.encrypted_secret) {
    try {
      const secret = await decryptSecret(anyCred.encrypted_secret);
      return { id: anyCred.id, keyId: anyCred.key_id, secret, environment: anyCred.environment };
    } catch {
      // fall through
    }
  }

  // Fallback 2: server-side NADERPAY_API_KEY environment secret
  return parseApiKeyFromEnv('NADERPAY_API_KEY');
}

function isEdgeFunctionUrl(url: string): boolean {
  return /\.supabase\.co\/functions\/v1\//.test(url);
}

async function getAuthHeaders(
  endpoint: Record<string, unknown>,
  eventId: string,
  timestamp: string,
  rawBody: string,
  apiCredential: { keyId: string; secret: string } | null,
  webhookSecret: string | null
): Promise<{ headers: Record<string, string>; signature?: string; authHeader?: string; apiAuthHeader?: string }> {
  const authMode = (endpoint.auth_mode as string) ?? 'hmac';
  const authConfig = (endpoint.auth_config as Record<string, unknown>) ?? {};
  const url = (endpoint.url as string) ?? '';
  const edgeFunction = isEdgeFunctionUrl(url);
  const runtimeToken = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Event-Id': eventId,
    'X-Webhook-Idempotency-Key': eventId,
    'X-Webhook-Timestamp': timestamp,
    'User-Agent': 'NaderPay-Webhook/1.0',
  };

  // API credential is always sent as a Bearer token. For Supabase Edge Functions, the runtime
  // reserves the Authorization header for JWT auth, so we pass the API credential in
  // X-Webhook-Authorization and use the service role key for Authorization.
  let apiAuthHeader: string | undefined;
  if (apiCredential) {
    apiAuthHeader = `Bearer ${apiCredential.keyId}:${apiCredential.secret}`;
    if (edgeFunction) {
      baseHeaders['Authorization'] = `Bearer ${runtimeToken}`;
      baseHeaders['X-Webhook-Authorization'] = apiAuthHeader;
    } else {
      baseHeaders['Authorization'] = apiAuthHeader;
    }
  }

  switch (authMode) {
    case 'hmac': {
      if (!webhookSecret) return { headers: baseHeaders, apiAuthHeader };
      const signature = await hmacSign(webhookSecret, rawBody);
      return {
        headers: { ...baseHeaders, 'X-Webhook-Signature': `sha256=${signature}` },
        signature,
        authHeader: edgeFunction ? baseHeaders['Authorization'] : apiAuthHeader,
        apiAuthHeader,
      };
    }
    case 'secret_header': {
      const headerName = String(authConfig.header_name || 'X-Webhook-Secret');
      const token = String(authConfig.secret || '');
      return { headers: { ...baseHeaders, [headerName]: token }, authHeader: baseHeaders['Authorization'], apiAuthHeader };
    }
    case 'bearer': {
      const token = String(authConfig.token || '');
      return { headers: { ...baseHeaders, 'Authorization': `Bearer ${token}` }, authHeader: baseHeaders['Authorization'], apiAuthHeader };
    }
    case 'custom_header': {
      const headerName = String(authConfig.header_name || 'X-API-Key');
      const token = String(authConfig.token || '');
      return { headers: { ...baseHeaders, [headerName]: token }, authHeader: baseHeaders['Authorization'], apiAuthHeader };
    }
    default:
      return { headers: baseHeaders, authHeader: baseHeaders['Authorization'], apiAuthHeader };
  }
}

async function sendWebhook(
  db: ReturnType<typeof adminClient>,
  delivery: Record<string, unknown>,
  endpoint: Record<string, unknown>,
  apiCredential: { keyId: string; secret: string } | null,
  webhookSecret: string | null,
  isTest = false
): Promise<{
  delivered: boolean;
  responseStatus: number;
  responseError: string;
  responseBody: string;
  responseTimeMs: number;
  signature?: string;
  authHeader?: string;
  apiAuthHeader?: string;
  requestHeaders?: Record<string, string>;
}> {
  const deliveryId = delivery.id as string;
  const eventId = (delivery.event_id as string) ?? deliveryId;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = delivery.payload as Record<string, unknown>;
  if (isTest && typeof payload === 'object') {
    payload.test = true;
  }
  const rawBody = JSON.stringify(payload);
  const timeoutMs = ((endpoint.timeout_seconds as number) ?? 10) * 1000;

  const { headers, signature, authHeader, apiAuthHeader } = await getAuthHeaders(endpoint, eventId, timestamp, rawBody, apiCredential, webhookSecret);

  const started = Date.now();
  let responseStatus = 0;
  let responseError = '';
  let responseBody = '';

  await db.from('webhook_deliveries').update({ status: 'sending', last_attempt_at: new Date().toISOString() }).eq('id', deliveryId);

  try {
    const res = await fetch(endpoint.url as string, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
    responseStatus = res.status;
    responseBody = await res.text().catch(() => '');
    // limit stored response body
    responseBody = responseBody.slice(0, 2000);
  } catch (e) {
    responseError = e instanceof Error ? e.message : String(e);
  }

  const responseTimeMs = Date.now() - started;
  const attempts = ((delivery.attempts as number) ?? 0) + 1;
  const maxAttempts = (delivery.max_attempts as number) ?? 5;
  const delivered = responseStatus >= 200 && responseStatus < 300;

  if (delivered) {
    await db.from('webhook_deliveries').update({
      status: 'delivered',
      attempts,
      delivered_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
      response_time_ms: responseTimeMs,
      response_status: responseStatus,
      response_body: responseBody,
      last_error: null,
      payload_version: WEBHOOK_VERSION,
    }).eq('id', deliveryId);
  } else {
    const exhausted = attempts >= maxAttempts;
    const nextAt = exhausted ? null : new Date(Date.now() + retryDelays[Math.min(attempts, retryDelays.length) - 1] * 1000).toISOString();
    await db.from('webhook_deliveries').update({
      status: exhausted ? 'exhausted' : 'failed',
      attempts,
      next_attempt_at: nextAt,
      last_attempt_at: new Date().toISOString(),
      response_time_ms: responseTimeMs,
      response_status: responseStatus,
      response_body: responseBody,
      last_error: responseError || `HTTP ${responseStatus}`,
      payload_version: WEBHOOK_VERSION,
    }).eq('id', deliveryId);
  }

  await db.from('audit_events').insert({
    account_id: delivery.account_id,
    actor: 'system:webhook-dispatcher',
    action: delivered ? 'webhook_delivered' : 'webhook_failed',
    entity: 'webhook_delivery',
    entity_id: deliveryId,
    metadata: {
      attempt: attempts,
      status: responseStatus,
      error: responseError || null,
      response_time_ms: responseTimeMs,
      is_test: isTest,
      event_id: eventId,
      auth_mode: endpoint.auth_mode ?? 'hmac',
    },
  });

  return {
    delivered,
    responseStatus,
    responseError,
    responseBody,
    responseTimeMs,
    signature,
    authHeader,
    apiAuthHeader,
    requestHeaders: headers,
  };
}

async function runDispatch(db: ReturnType<typeof adminClient>, limit = 50): Promise<{ processed: number; delivered: number; timestamp: string }> {
  const now = new Date().toISOString();
  const { data: pending } = await db.from('webhook_deliveries')
    .select('*, webhook_endpoints(*)')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', now)
    .order('next_attempt_at', { ascending: true })
    .limit(limit);

  const due = (pending ?? []).filter((d: Record<string, unknown>) => (d.attempts as number) < (d.max_attempts as number));
  const results = await Promise.allSettled(due.map(async (d) => {
    const endpoint = d.webhook_endpoints as Record<string, unknown>;
    if (!endpoint) return { delivered: false };
    const accountId = d.account_id as string;
    const endpointId = endpoint.id as string;
    const integrationId = d.integration_id as string | null;
    const [apiCredential, webhookSecret] = await Promise.all([
      getApiCredentialForEndpoint(db, accountId, endpoint),
      getActiveSecretForEndpoint(db, accountId, endpointId, integrationId),
    ]);
    return sendWebhook(db, d, endpoint, apiCredential, webhookSecret);
  }));
  const delivered = results.filter((r, i) => r.status === 'fulfilled' && due[i] && (r.value as { delivered?: boolean }).delivered).length;
  return { processed: due.length, delivered, timestamp: now };
}

async function getUserAccount(req: Request) {
  const db = adminClient();
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { error: 'UNAUTHORIZED' as const };
  const { data: profile } = await db.from('profiles').select('account_id, role').eq('id', user.id).maybeSingle();
  if (!profile?.account_id) return { error: 'FORBIDDEN' as const };
  return { user, account_id: profile.account_id, db };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const requestId = crypto.randomUUID();
  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\/webhook-dispatcher\/?/, '').split('/').filter(Boolean);
  const authHeader = req.headers.get('Authorization') ?? '';

  // GET /webhook-dispatcher — cron dispatch
  if (req.method === 'GET') {
    if (!authHeader.includes(serviceKey())) return jsonErr('UNAUTHORIZED', 'داخلي فقط', 401, requestId);
    const db = adminClient();
    const result = await runDispatch(db);
    return jsonOk(result);
  }

  if (req.method === 'POST') {
    const db = adminClient();
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* optional */ }
    const action = String(body.action ?? '');

    if (action === 'dispatch') {
      if (!authHeader.includes(serviceKey())) return jsonErr('UNAUTHORIZED', 'داخلي فقط', 401, requestId);
      const result = await runDispatch(db);
      return jsonOk(result);
    }

    const auth = await getUserAccount(req);
    if (auth.error) return jsonErr(auth.error, 'يجب تسجيل الدخول', 401, requestId);
    const { user, account_id } = auth;

    // create_endpoint
    if (action === 'create_endpoint') {
      const endpointUrl = String(body.url ?? '').trim();
      const check = validateEndpoint(endpointUrl);
      if (!check.ok) return jsonErr('VALIDATION_ERROR', check.message, 422, requestId);

      const events = Array.isArray(body.events) ? body.events.map(String) : ['payment.confirmed'];
      const timeout = typeof body.timeout_seconds === 'number' ? body.timeout_seconds : 10;
      const environment = body.environment === 'live' ? 'live' : 'sandbox';
      const authMode = ['hmac', 'secret_header', 'bearer', 'custom_header'].includes(String(body.auth_mode))
        ? String(body.auth_mode)
        : 'hmac';
      const authConfig = typeof body.auth_config === 'object' && body.auth_config ? body.auth_config as Record<string, unknown> : {};
      const integrationId = body.integration_id ? String(body.integration_id) : null;

      // Server-side secret generation only for HMAC mode
      let secret = '';
      if (authMode === 'hmac') {
        secret = generateWebhookSecret();
      }

      // Never store plaintext secret in webhook_endpoints; store encrypted in webhook_secrets
      const { data: endpoint, error } = await db.from('webhook_endpoints').insert({
        account_id,
        integration_id: integrationId,
        url: endpointUrl,
        secret: authMode === 'hmac' ? '[stored-encrypted]' : '',
        events,
        environment,
        auth_mode: authMode,
        auth_config: authConfig,
        timeout_seconds: Math.min(30, Math.max(1, timeout)),
        status: 'active',
        health_status: 'unknown',
      }).select('id, account_id, integration_id, url, events, status, created_at, updated_at, timeout_seconds, environment, auth_mode, auth_config, last_test_at, health_status').maybeSingle();
      if (error) return jsonErr('DB_ERROR', error.message, 500, requestId);

      if (authMode === 'hmac' && secret && endpoint) {
        await storeWebhookSecret(db, account_id, secret, endpoint.id, integrationId);
      }

      await db.from('audit_events').insert({
        account_id,
        actor: `user:${user.id}`,
        action: 'created',
        entity: 'webhook_endpoint',
        entity_id: endpoint!.id,
        metadata: { url: endpointUrl, events, environment, auth_mode: authMode },
      });

      // Return secret only once, immediately after creation
      return jsonOk({ ...endpoint, webhook_secret: secret, warning: 'احتفظ بـ Webhook Secret — لن يُعرض مرة أخرى' }, 201);
    }

    // update_endpoint
    if (action === 'update_endpoint') {
      const endpointId = String(body.endpoint_id ?? '');
      const { data: existing } = await db.from('webhook_endpoints').select('*').eq('id', endpointId).eq('account_id', account_id).maybeSingle();
      if (!existing) return jsonErr('NOT_FOUND', 'Endpoint غير موجود', 404, requestId);

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.url === 'string') {
        const check = validateEndpoint(body.url);
        if (!check.ok) return jsonErr('VALIDATION_ERROR', check.message, 422, requestId);
        updates.url = body.url.trim();
      }
      if (Array.isArray(body.events)) updates.events = body.events.map(String);
      if (typeof body.timeout_seconds === 'number') updates.timeout_seconds = Math.min(30, Math.max(1, body.timeout_seconds));
      if (typeof body.status === 'string') updates.status = body.status;
      if (['hmac', 'secret_header', 'bearer', 'custom_header'].includes(String(body.auth_mode))) updates.auth_mode = String(body.auth_mode);
      if (typeof body.auth_config === 'object' && body.auth_config) updates.auth_config = body.auth_config;
      // NEVER accept secret changes from update endpoint; use rotate_secret instead
      if (body.secret !== undefined) {
        return jsonErr('VALIDATION_ERROR', 'لا يمكن تعديل Webhook Secret من هنا — استخدم تدوير السر', 422, requestId);
      }

      const { data: endpoint, error } = await db.from('webhook_endpoints').update(updates).eq('id', endpointId).eq('account_id', account_id).select('id, account_id, integration_id, url, events, status, created_at, updated_at, timeout_seconds, environment, auth_mode, auth_config, last_test_at, health_status').maybeSingle();
      if (error) return jsonErr('DB_ERROR', error.message, 500, requestId);

      await db.from('audit_events').insert({
        account_id,
        actor: `user:${user.id}`,
        action: 'updated',
        entity: 'webhook_endpoint',
        entity_id: endpointId,
        metadata: { fields: Object.keys(updates) },
      });
      return jsonOk(endpoint);
    }

    // rotate_secret
    if (action === 'rotate_secret') {
      const endpointId = String(body.endpoint_id ?? '');
      const { data: endpoint } = await db.from('webhook_endpoints')
        .select('id, integration_id, account_id, auth_mode')
        .eq('id', endpointId)
        .eq('account_id', account_id)
        .maybeSingle();
      if (!endpoint) return jsonErr('NOT_FOUND', 'Endpoint غير موجود', 404, requestId);

      if (endpoint.auth_mode !== 'hmac') return jsonErr('VALIDATION_ERROR', 'التدوير متاح فقط لـ HMAC', 422, requestId);

      const newSecret = generateWebhookSecret();

      // Revoke all active secrets for this endpoint and store new encrypted secret
      await revokeEndpointSecrets(db, account_id, endpointId);
      await storeWebhookSecret(db, account_id, newSecret, endpointId, endpoint.integration_id);

      // Mark endpoint as needing fresh health check
      await db.from('webhook_endpoints')
        .update({ secret: '[stored-encrypted]', health_status: 'unknown', updated_at: new Date().toISOString() })
        .eq('id', endpointId)
        .eq('account_id', account_id);

      await logSecurityEvent(db, {
        account_id,
        event_type: 'webhook_secret.rotated',
        severity: 'info',
        actor: `user:${user.id}`,
        details: { endpoint_id: endpointId, integration_id: endpoint.integration_id },
      });

      // Return the new secret only once, immediately after rotation
      return jsonOk({
        endpoint_id: endpointId,
        webhook_secret: newSecret,
        warning: 'تم تدوير السر — الـ Secret القديم غير صالح فورًا. احتفظ بالسر الجديد — لن يُعرض مرة أخرى',
      });
    }

    // test
    if (action === 'test') {
      const endpointId = String(body.endpoint_id ?? '');
      const { data: endpoint } = await db.from('webhook_endpoints')
        .select('*')
        .eq('id', endpointId)
        .eq('account_id', account_id)
        .maybeSingle();
      if (!endpoint) return jsonErr('NOT_FOUND', 'Endpoint غير موجود', 404, requestId);

      const integrationId = endpoint.integration_id ?? null;
      const secret = await getActiveSecretForEndpoint(db, account_id, endpoint.id, integrationId) ?? endpoint.secret;
      if (endpoint.auth_mode === 'hmac' && !secret) return jsonErr('CONFIG_ERROR', 'لا يوجد Webhook Secret', 500, requestId);

      const eventId = `test-${crypto.randomUUID()}`;
      const payload = {
        event: 'payment.confirmed',
        id: eventId,
        version: WEBHOOK_VERSION,
        created_at: new Date().toISOString(),
        test: true,
        data: {
          id: `pay_test_${crypto.randomUUID().slice(0, 8)}`,
          order_reference: 'TEST-ORDER-123',
          external_reference: 'TEST-ORDER-123',
          amount: 100,
          currency: 'EGP',
          status: 'confirmed',
        },
      };

      const { data: delivery } = await db.from('webhook_deliveries').insert({
        account_id,
        endpoint_id: endpointId,
        integration_id: integrationId,
        event_id: eventId,
        event_type: 'payment.confirmed',
        payload,
        status: 'pending',
        attempts: 0,
        max_attempts: 1,
        next_attempt_at: new Date().toISOString(),
        payload_version: WEBHOOK_VERSION,
      }).select('*').maybeSingle();
      if (!delivery) return jsonErr('DB_ERROR', 'فشل إنشاء تسليم الاختبار', 500, requestId);

      const apiCredential = await getApiCredentialForEndpoint(db, account_id, endpoint);
      const result = await sendWebhook(db, delivery, endpoint, apiCredential, secret, true);
      const healthStatus = result.delivered ? 'healthy' : 'unhealthy';
      await db.from('webhook_endpoints').update({ last_test_at: new Date().toISOString(), health_status: healthStatus }).eq('id', endpointId);

      return jsonOk({
        event_id: eventId,
        delivery_id: delivery.id,
        delivered: result.delivered,
        http_status: result.responseStatus,
        response_time_ms: result.responseTimeMs,
        response_body: result.responseBody,
        signature: result.signature,
        auth_header: result.authHeader ? result.authHeader.replace(/^Bearer\s+.+$/, 'Bearer ***') : null,
        api_auth_header: result.apiAuthHeader ? result.apiAuthHeader.replace(/:.{3,}$/, ':***') : null,
        request_headers: result.requestHeaders
          ? Object.fromEntries(Object.entries(result.requestHeaders).map(([k, v]) => {
              if (k.toLowerCase() === 'authorization') return [k, v.replace(/^Bearer\s+.+$/, 'Bearer ***')];
              if (k.toLowerCase() === 'x-webhook-authorization') return [k, v.replace(/:.{3,}$/, ':***')];
              if (k.toLowerCase() === 'x-webhook-secret') return [k, '***'];
              return [k, v];
            }))
          : null,
        auth_mode: endpoint.auth_mode ?? 'hmac',
        error: result.responseError || null,
      });
    }

    // retry
    if (action === 'retry') {
      const deliveryId = String(body.delivery_id ?? '');
      const { data: delivery } = await db.from('webhook_deliveries')
        .select('*, webhook_endpoints(*)')
        .eq('id', deliveryId)
        .eq('account_id', account_id)
        .maybeSingle();
      if (!delivery) return jsonErr('NOT_FOUND', 'التسليم غير موجود', 404, requestId);

      const endpoint = delivery.webhook_endpoints as Record<string, unknown>;
      const endpointId = endpoint.id as string;
      const integrationId = delivery.integration_id as string | null;
      const secret = await getActiveSecretForEndpoint(db, account_id, endpointId, integrationId) ?? (endpoint.secret as string);
      if ((endpoint.auth_mode as string) === 'hmac' && !secret) return jsonErr('CONFIG_ERROR', 'لا يوجد Webhook Secret', 500, requestId);

      await db.from('webhook_deliveries').update({
        status: 'pending',
        attempts: 0,
        next_attempt_at: new Date().toISOString(),
        last_error: null,
        response_status: null,
        response_body: null,
        response_time_ms: null,
      }).eq('id', deliveryId);

      const apiCredential = await getApiCredentialForEndpoint(db, account_id, endpoint);
      const result = await sendWebhook(db, delivery, endpoint, apiCredential, secret);
      return jsonOk({
        delivery_id: deliveryId,
        delivered: result.delivered,
        http_status: result.responseStatus,
        response_time_ms: result.responseTimeMs,
        response_body: result.responseBody,
        error: result.responseError || null,
      });
    }

    // replay
    if (action === 'replay') {
      const deliveryId = String(body.delivery_id ?? '');
      const { data: original } = await db.from('webhook_deliveries')
        .select('*, webhook_endpoints(*)')
        .eq('id', deliveryId)
        .eq('account_id', account_id)
        .maybeSingle();
      if (!original) return jsonErr('NOT_FOUND', 'التسليم غير موجود', 404, requestId);

      const endpoint = original.webhook_endpoints as Record<string, unknown>;
      const endpointId = endpoint.id as string;
      const integrationId = original.integration_id as string | null;
      const secret = await getActiveSecretForEndpoint(db, account_id, endpointId, integrationId) ?? (endpoint.secret as string);
      if ((endpoint.auth_mode as string) === 'hmac' && !secret) return jsonErr('CONFIG_ERROR', 'لا يوجد Webhook Secret', 500, requestId);

      const eventId = `${original.event_id as string}-replay-${crypto.randomUUID()}`;
      const payload = original.payload as Record<string, unknown>;
      const { data: delivery } = await db.from('webhook_deliveries').insert({
        account_id,
        endpoint_id: endpoint.id,
        integration_id: integrationId,
        event_id: eventId,
        event_type: original.event_type,
        payload,
        status: 'pending',
        attempts: 0,
        max_attempts: original.max_attempts,
        next_attempt_at: new Date().toISOString(),
        payload_version: WEBHOOK_VERSION,
      }).select('*').maybeSingle();
      if (!delivery) return jsonErr('DB_ERROR', 'فشل إنشاء تسليم جديد', 500, requestId);

      const apiCredential = await getApiCredentialForEndpoint(db, account_id, endpoint);
      const result = await sendWebhook(db, delivery, endpoint, apiCredential, secret);
      return jsonOk({
        original_delivery_id: deliveryId,
        new_delivery_id: delivery.id,
        event_id: eventId,
        delivered: result.delivered,
        http_status: result.responseStatus,
        response_time_ms: result.responseTimeMs,
        response_body: result.responseBody,
        error: result.responseError || null,
      });
    }

    return jsonErr('BAD_REQUEST', 'action غير معروف', 400, requestId);
  }

  return jsonErr('NOT_FOUND', 'المسار غير موجود', 404, requestId);
});
