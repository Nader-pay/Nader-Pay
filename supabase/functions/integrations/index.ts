// Integrations v2 — create/list with API credential, webhook endpoint, auth modes, and encrypted secret
import { adminClient, jsonOk, jsonErr, CORS, encryptSecret, logSecurityEvent } from '../_shared/auth.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ALL_EVENTS = [
  'payment.confirmed',
  'payment.rejected',
  'payment.review_required',
  'payment.expired',
  'payment.cancelled',
  'device.online',
  'device.offline',
  'webhook.failed',
];

const V2_TYPES = ['website', 'backend', 'telegram', 'custom'];

function generateKeyId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return 'pk_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashSecret(keyId: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(keyId), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(secret));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashWebhookSecret(secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode('naderpay-webhook-v2'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(secret));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function validateEndpoint(urlStr: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== 'https:') return { ok: false, message: 'يجب أن يبدأ الرابط بـ https://' };
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1')
      return { ok: false, message: 'localhost غير مسموح في الإنتاج' };
    const blocked = ['169.254.', '10.', '172.16.', '192.168.', '127.', '0.0.0.0'];
    if (blocked.some(p => hostname.startsWith(p))) return { ok: false, message: 'الرابط الداخلي غير مسموح' };
    return { ok: true };
  } catch {
    return { ok: false, message: 'رابط غير صالح' };
  }
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

  const request_id = crypto.randomUUID();
  const auth = await getUserAccount(req);
  if (auth.error) return jsonErr(auth.error, 'يجب تسجيل الدخول', 401, request_id);
  const { user, account_id, db } = auth;

  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\/integrations\/?/, '').split('/').filter(Boolean);

  // GET /integrations
  if (req.method === 'GET' && pathParts.length === 0) {
    const { data } = await db.from('integrations')
      .select('*, api_credentials(id, key_id, status, environment, hmac_enabled, last_used_at), webhook_endpoints(id, url, events, status, auth_mode, health_status, last_test_at)')
      .eq('account_id', account_id)
      .order('created_at', { ascending: false });
    return jsonOk({ integrations: data ?? [] });
  }

  // GET /integrations/{id}
  if (req.method === 'GET' && pathParts.length === 1) {
    const integrationId = pathParts[0];
    const { data } = await db.from('integrations')
      .select('*, api_credentials(id, key_id, status, environment, hmac_enabled, last_used_at), webhook_endpoints(*)')
      .eq('id', integrationId)
      .eq('account_id', account_id)
      .maybeSingle();
    if (!data) return jsonErr('NOT_FOUND', 'التكامل غير موجود', 404, request_id);
    return jsonOk({ integration: data });
  }

  // ── All POST requests: read body ONCE, then dispatch by action/path ──
  if (req.method === 'POST') {
    const bodyText = await req.text().catch(() => '{}');
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(bodyText); } catch { /* ignore — non-JSON bodies for path-based routes */ }

    const bodyAction = String(body.action ?? '').trim();

    // POST /integrations — action: rotate_secret
    if (pathParts.length === 0 && (bodyAction === 'rotate_secret' || bodyAction === 'rotate-secret')) {
      const integrationId = String(body.integration_id ?? '');
      if (!integrationId) return jsonErr('VALIDATION_ERROR', 'integration_id مطلوب', 422, request_id);
      const { data: integration } = await db.from('integrations')
        .select('id, webhook_endpoint_id')
        .eq('id', integrationId).eq('account_id', account_id).maybeSingle();
      if (!integration) return jsonErr('NOT_FOUND', 'التكامل غير موجود', 404, request_id);

      const newSecret = generateWebhookSecret();
      const secretHash = await hashWebhookSecret(newSecret);
      const encrypted = await encryptSecret(newSecret);

      await db.from('webhook_secrets')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('integration_id', integrationId).eq('account_id', account_id).eq('status', 'active');

      await db.from('webhook_secrets').insert({
        account_id, integration_id: integrationId,
        endpoint_id: integration.webhook_endpoint_id,
        secret_hash: secretHash, encrypted_secret: encrypted, status: 'active',
      });

      if (integration.webhook_endpoint_id) {
        await db.from('webhook_endpoints')
          .update({ secret: '[stored-encrypted]', updated_at: new Date().toISOString(), health_status: 'unknown' })
          .eq('id', integration.webhook_endpoint_id).eq('account_id', account_id);
      }
      await logSecurityEvent(db, { account_id, event_type: 'webhook_secret.rotated', severity: 'info', actor: `user:${user.id}`, details: { integration_id: integrationId } });
      return jsonOk({ integration_id: integrationId, webhook_secret: newSecret, warning: 'احتفظ بالسر الجديد — لن يُعرض مرة أخرى' });
    }

    // POST /integrations — action: disable|enable
    if (pathParts.length === 0 && (bodyAction === 'disable' || bodyAction === 'enable')) {
      const integrationId = String(body.integration_id ?? '');
      if (!integrationId) return jsonErr('VALIDATION_ERROR', 'integration_id مطلوب', 422, request_id);
      const newStatus = bodyAction === 'disable' ? 'disabled' : 'active';
      const { data: existing } = await db.from('integrations').select('id').eq('id', integrationId).eq('account_id', account_id).maybeSingle();
      if (!existing) return jsonErr('NOT_FOUND', 'التكامل غير موجود', 404, request_id);
      await db.from('integrations').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', integrationId).eq('account_id', account_id);
      await db.from('webhook_endpoints').update({ status: newStatus === 'active' ? 'active' : 'disabled', updated_at: new Date().toISOString() }).eq('integration_id', integrationId).eq('account_id', account_id);
      return jsonOk({ integration_id: integrationId, status: newStatus });
    }

    // POST /integrations/{id}/rotate-secret (URL-path form, kept for compat)
    if (pathParts.length === 2 && pathParts[1] === 'rotate-secret') {
      const integrationId = pathParts[0];
      const { data: integration } = await db.from('integrations')
        .select('id, webhook_endpoint_id')
        .eq('id', integrationId).eq('account_id', account_id).maybeSingle();
      if (!integration) return jsonErr('NOT_FOUND', 'التكامل غير موجود', 404, request_id);

      const newSecret = generateWebhookSecret();
      const secretHash = await hashWebhookSecret(newSecret);
      const encrypted = await encryptSecret(newSecret);

      await db.from('webhook_secrets')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('integration_id', integrationId).eq('account_id', account_id).eq('status', 'active');

      await db.from('webhook_secrets').insert({
        account_id, integration_id: integrationId,
        endpoint_id: integration.webhook_endpoint_id,
        secret_hash: secretHash, encrypted_secret: encrypted, status: 'active',
      });

      if (integration.webhook_endpoint_id) {
        await db.from('webhook_endpoints')
          .update({ secret: '[stored-encrypted]', updated_at: new Date().toISOString(), health_status: 'unknown' })
          .eq('id', integration.webhook_endpoint_id).eq('account_id', account_id);
      }
      await logSecurityEvent(db, { account_id, event_type: 'webhook_secret.rotated', severity: 'info', actor: `user:${user.id}`, details: { integration_id: integrationId } });
      return jsonOk({ integration_id: integrationId, webhook_secret: newSecret, warning: 'احتفظ بالسر الجديد — لن يُعرض مرة أخرى' });
    }

    // POST /integrations/{id}/disable|enable (URL-path form, kept for compat)
    if (pathParts.length === 2 && (pathParts[1] === 'disable' || pathParts[1] === 'enable')) {
      const integrationId = pathParts[0];
      const newStatus = pathParts[1] === 'disable' ? 'disabled' : 'active';
      const { data: existing } = await db.from('integrations').select('id').eq('id', integrationId).eq('account_id', account_id).maybeSingle();
      if (!existing) return jsonErr('NOT_FOUND', 'التكامل غير موجود', 404, request_id);
      await db.from('integrations').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', integrationId).eq('account_id', account_id);
      await db.from('webhook_endpoints').update({ status: newStatus === 'active' ? 'active' : 'disabled', updated_at: new Date().toISOString() }).eq('integration_id', integrationId).eq('account_id', account_id);
      return jsonOk({ integration_id: integrationId, status: newStatus });
    }

    // POST /integrations — create new integration (no action field or name field present)
    if (pathParts.length === 0) {
      if (!bodyText || bodyText === '{}') return jsonErr('INVALID_JSON', 'جسم الطلب غير صالح', 400, request_id);

      const name = String(body.name ?? '').trim();
      if (!name) return jsonErr('VALIDATION_ERROR', 'اسم التكامل مطلوب', 422, request_id);

      const type = V2_TYPES.includes(String(body.type)) ? String(body.type) : 'website';
      const environment = body.environment === 'live' ? 'live' : 'sandbox';
      const websiteUrl = body.website_url ? String(body.website_url).trim() : null;
      if (type === 'website' && !websiteUrl) return jsonErr('VALIDATION_ERROR', 'رابط الموقع مطلوب', 422, request_id);

      let apiCredentialId = body.api_credential_id ? String(body.api_credential_id) : null;
      let apiKeyFull: string | null = null;

      if (body.api_key_option === 'new' || !apiCredentialId) {
        const keyId = generateKeyId();
        const secret = generateSecret();
        const hash = await hashSecret(keyId, secret);
        const encrypted = await encryptSecret(secret);
        const { data: cred, error } = await db.from('api_credentials').insert({
          account_id,
          key_id: keyId,
          secret_hash: hash,
          encrypted_secret: encrypted,
          label: body.api_label ? String(body.api_label) : name,
          status: 'active',
          environment,
          scopes: ['payments:create', 'payments:read'],
        }).select('id').maybeSingle();
        if (error) return jsonErr('DB_ERROR', error.message, 500, request_id);
        apiCredentialId = cred!.id;
        apiKeyFull = `${keyId}:${secret}`;
      } else {
        const { data: existing } = await db.from('api_credentials')
          .select('id, environment')
          .eq('id', apiCredentialId).eq('account_id', account_id).maybeSingle();
        if (!existing) return jsonErr('VALIDATION_ERROR', 'مفتاح API غير موجود', 422, request_id);
        if (existing.environment !== environment) return jsonErr('VALIDATION_ERROR', 'بيئة API Credential لا تطابق بيئة التكامل', 422, request_id);
      }

      if (!body.webhook_url || typeof body.webhook_url !== 'string') return jsonErr('VALIDATION_ERROR', 'رابط Webhook مطلوب', 422, request_id);
      const webhookUrl = body.webhook_url.trim();
      const endpointCheck = await validateEndpoint(webhookUrl);
      if (!endpointCheck.ok) return jsonErr('VALIDATION_ERROR', endpointCheck.message, 422, request_id);

      const events = Array.isArray(body.webhook_events) && body.webhook_events.length
        ? body.webhook_events.map(String).filter(e => ALL_EVENTS.includes(e))
        : ['payment.confirmed'];
      const enabledEvents = Array.isArray(body.enabled_events) ? body.enabled_events.map(String).filter(e => ALL_EVENTS.includes(e)) : events;

      const authMode = ['hmac', 'secret_header', 'bearer', 'custom_header'].includes(String(body.auth_mode))
        ? String(body.auth_mode) : 'hmac';
      const authConfig = typeof body.auth_config === 'object' && body.auth_config ? (body.auth_config as Record<string, unknown>) : {};

      let endpointSecret = '';
      if (authMode === 'hmac') {
        endpointSecret = body.create_webhook_secret
          ? generateWebhookSecret()
          : (body.provided_webhook_secret ? String(body.provided_webhook_secret) : generateWebhookSecret());
        if (endpointSecret.length < 32) return jsonErr('VALIDATION_ERROR', 'Webhook Secret قصير جدًا', 422, request_id);
      }

      const { data: integration, error: intErr } = await db.from('integrations').insert({
        account_id, name, type, website_url: websiteUrl, environment,
        api_credential_id: apiCredentialId, enabled_events: enabledEvents,
        status: 'active', last_activity_at: new Date().toISOString(),
      }).select('id').maybeSingle();
      if (intErr) return jsonErr('DB_ERROR', intErr.message, 500, request_id);

      const { data: endpoint, error: epErr } = await db.from('webhook_endpoints').insert({
        account_id, integration_id: integration!.id, url: webhookUrl,
        secret: endpointSecret ? '[stored-encrypted]' : '', events, environment, status: 'active',
        timeout_seconds: 10, auth_mode: authMode, auth_config: authConfig, health_status: 'unknown',
      }).select('id').maybeSingle();
      if (epErr) return jsonErr('DB_ERROR', epErr.message, 500, request_id);

      await db.from('integrations').update({ webhook_endpoint_id: endpoint!.id })
        .eq('id', integration!.id).eq('account_id', account_id);

      if (endpointSecret) {
        const secretHash = await hashWebhookSecret(endpointSecret);
        const encrypted = await encryptSecret(endpointSecret);
        await db.from('webhook_secrets').insert({
          account_id, integration_id: integration!.id, endpoint_id: endpoint!.id,
          secret_hash: secretHash, encrypted_secret: encrypted, status: 'active',
        });
      }

      await db.from('audit_events').insert({
        account_id, actor: `user:${user.id}`, action: 'created', entity: 'integration',
        entity_id: integration!.id,
        metadata: { type, environment, api_credential_id: apiCredentialId, webhook_endpoint_id: endpoint!.id, auth_mode: authMode },
      });

      return jsonOk({
        integration: {
          id: integration!.id, name, type, environment,
          api_credential_id: apiCredentialId, api_key: apiKeyFull,
          webhook_endpoint_id: endpoint!.id, webhook_url: webhookUrl,
          webhook_secret: endpointSecret, auth_mode: authMode,
          auth_config: authConfig, events, enabled_events: enabledEvents,
        },
        warning: 'احتفظ بـ API Key و Webhook Secret الآن — لن يُعرضا مرة أخرى',
      }, 201);
    }
  }

  return jsonErr('NOT_FOUND', 'المسار غير موجود', 404, request_id);
});
