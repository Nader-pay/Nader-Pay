// مساعدات المصادقة والأمان المشتركة بين Edge Functions
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const adminClient = () =>
  createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-idempotency-key, x-api-key, x-timestamp, x-nonce, x-signature, x-naderpay-timestamp, x-naderpay-nonce, x-naderpay-signature, x-webhook-authorization, x-webhook-event-id, x-webhook-timestamp, x-webhook-signature, x-webhook-idempotency-key',
};

export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function jsonErr(code: string, message: string, status: number, request_id?: string): Response {
  return new Response(JSON.stringify({ error: { code, message, request_id: request_id ?? crypto.randomUUID() } }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ─── الاشتقاق الآمن لمفتاح تشفير Webhook Secrets ───
async function deriveEncryptionKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const base = await crypto.subtle.digest('SHA-256', encoder.encode(serviceKey));
  return crypto.subtle.importKey('raw', base, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );
  const ivB64 = btoa(String.fromCharCode(...iv));
  const cipherB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  return `${ivB64}.${cipherB64}`;
}

export async function decryptSecret(encrypted: string): Promise<string> {
  const [ivB64, cipherB64] = encrypted.split('.');
  if (!ivB64 || !cipherB64) throw new Error('تنسيق encrypted secret غير صالح');

  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
  const key = await deriveEncryptionKey();
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// ─── API Key Extraction ───
// يقبل التوكن إما من x-api-key أو من Authorization: Bearer <key_id:secret>
const API_KEY_PATTERN = /^pk_[a-zA-Z0-9_]+:[a-zA-Z0-9]+$/;

function extractApiKey(req: Request): { keyId: string; secret: string; raw: string } | null {
  const fromHeader = req.headers.get('x-api-key')?.trim();
  if (fromHeader && API_KEY_PATTERN.test(fromHeader)) {
    const [keyId, ...secretParts] = fromHeader.split(':');
    return { keyId, secret: secretParts.join(':'), raw: fromHeader };
  }

  const auth = req.headers.get('Authorization')?.trim() ?? '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    // لا نتعامل مع JWT على أنه API Key: إذا كان التوكن يشبه JWT نتجاهله
    // ونترك للمسارات الأخرى التحقق من JWT إن احتاجت.
    if (API_KEY_PATTERN.test(token)) {
      const [keyId, ...secretParts] = token.split(':');
      return { keyId, secret: secretParts.join(':'), raw: token };
    }
  }

  return null;
}

// ─── API Key — basic (x-api-key) + Bearer + HMAC اختياري ───
export async function authenticateApiKey(
  req: Request,
  db: ReturnType<typeof adminClient>
): Promise<{ account_id: string; credential_id: string; key_id: string; scopes: string[] } | null> {
  const extracted = extractApiKey(req);
  if (!extracted) return null;

  const { keyId, secret } = extracted;

  const { data: cred } = await db
    .from('api_credentials')
    .select('id, account_id, secret_hash, status, hmac_enabled, scopes')
    .eq('key_id', keyId)
    .eq('status', 'active')
    .maybeSingle();

  if (!cred) return null;

  // التحقق من hash
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(keyId), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature   = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(secret));
  const hash        = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (hash !== cred.secret_hash) return null;

  // HMAC اختياري: إذا مفعّل، يجب التحقق من التوقيع والـ nonce
  if (cred.hmac_enabled) {
    const hmacOk = await authenticateApiKeyHmac(req, db, cred.account_id, keyId, secret);
    if (!hmacOk) return null;
  }

  // تحديث last_used_at
  await db.from('api_credentials').update({ last_used_at: new Date().toISOString() }).eq('id', cred.id);

  return { account_id: cred.account_id, credential_id: cred.id, key_id: keyId, scopes: (cred.scopes as string[]) ?? [] };
}

// ─── API Key via Authorization: Bearer ───
// نفس authenticateApiKey ولكن يُستخدم عندما يكون الـ Authorization header مخصصًا بالكامل للـ API Key
export async function authenticateApiKeyBearer(
  req: Request,
  db: ReturnType<typeof adminClient>
): Promise<{ account_id: string; credential_id: string; key_id: string; scopes: string[] } | null> {
  return authenticateApiKey(req, db);
}

function hasAnyScope(credScopes: string[], required: string[]): boolean {
  if (!required || required.length === 0) return true;
  const scopes = new Set(credScopes ?? []);
  if (scopes.has('full')) return true;
  return required.some((s) => scopes.has(s));
}

export function authorizeScopes(
  credScopes: string[],
  required: string[]
): { ok: true } | { ok: false; missing: string[] } {
  const scopes = new Set(credScopes ?? []);
  if (scopes.has('full')) return { ok: true };
  const missing = required.filter((s) => !scopes.has(s));
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing };
}

async function authenticateApiKeyHmac(
  req: Request,
  db: ReturnType<typeof adminClient>,
  accountId: string,
  keyId: string,
  secret: string
): Promise<boolean> {
  const timestamp = req.headers.get('x-naderpay-timestamp') ?? req.headers.get('x-timestamp');
  const nonce     = req.headers.get('x-naderpay-nonce')     ?? req.headers.get('x-nonce');
  const signature = req.headers.get('x-naderpay-signature') ?? req.headers.get('x-signature');
  if (!timestamp || !nonce || !signature) return false;

  // timestamp ±5 دقائق
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) return false;

  // nonce غير مستخدم من قبل
  const { data: existing } = await db
    .from('api_credential_nonces')
    .select('id')
    .eq('account_id', accountId)
    .eq('key_id', keyId)
    .eq('nonce', nonce)
    .maybeSingle();
  if (existing) return false;

  // تسجيل nonce
  await db.from('api_credential_nonces').insert({
    account_id: accountId,
    key_id: keyId,
    nonce,
    expires_at: new Date((now + 300) * 1000).toISOString(),
  });

  const method = req.method;
  const url = new URL(req.url);
  const path = url.pathname + url.search;
  // استنساخ الطلب لقراءة الجسم بدون إفساد الطلب الأصلي
  const body = await req.clone().text();
  const sigPayload = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const computed = await crypto.subtle.sign('HMAC', key, encoder.encode(sigPayload));
  const computedHex = Array.from(new Uint8Array(computed)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (computedHex !== signature) return false;
  return true;
}

// ─── Webhook Signature Verification ───
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const signature = signatureHeader.slice(7);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const computed = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const computedHex = Array.from(new Uint8Array(computed)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computedHex === signature;
}

// ─── Webhook Timestamp & Replay Helpers ───
export function isWebhookTimestampValid(timestamp: string | null, toleranceSeconds = 300): boolean {
  if (!timestamp) return false;
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - ts) <= toleranceSeconds;
}

export async function isWebhookEventReplayed(
  db: ReturnType<typeof adminClient>,
  accountId: string,
  eventId: string,
  endpointPath = 'naderpay-webhook'
): Promise<boolean> {
  const { data } = await db
    .from('webhook_received_events')
    .select('id')
    .eq('account_id', accountId)
    .eq('event_id', eventId)
    .eq('endpoint_path', endpointPath)
    .maybeSingle();
  return !!data;
}

export async function recordWebhookEvent(
  db: ReturnType<typeof adminClient>,
  accountId: string,
  eventId: string,
  endpointPath = 'naderpay-webhook'
): Promise<void> {
  try {
    await db.from('webhook_received_events').insert({
      account_id: accountId,
      event_id: eventId,
      endpoint_path: endpointPath,
    });
  } catch {
    // ignore duplicates
  }
}

// ─── Device Token ───
export async function authenticateDevice(
  deviceId: string,
  token: string,
  db: ReturnType<typeof adminClient>
): Promise<{ account_id: string } | null> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(deviceId), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature   = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(token));
  const hash        = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');

  const { data } = await db
    .from('device_credentials')
    .select('account_id, status')
    .eq('device_id', deviceId)
    .eq('token_hash', hash)
    .eq('status', 'active')
    .maybeSingle();

  return data ? { account_id: data.account_id } : null;
}

export async function createDeviceToken(deviceId: string, accountId: string, db: ReturnType<typeof adminClient>): Promise<string> {
  const token = crypto.randomUUID();
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(deviceId), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature   = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(token));
  const hash        = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');

  await db.from('device_credentials').insert({ device_id: deviceId, account_id: accountId, token_hash: hash });
  return token;
}

// ─── Idempotency ───
export async function checkIdempotency(
  accountId: string,
  key: string,
  endpoint: string,
  db: ReturnType<typeof adminClient>
): Promise<{ cached: true; body: unknown; status: number } | { cached: false }> {
  const { data } = await db
    .from('idempotency_keys')
    .select('response_body, status_code')
    .eq('account_id', accountId)
    .eq('idempotency_key', key)
    .eq('endpoint', endpoint)
    .maybeSingle();

  if (data?.response_body) return { cached: true, body: data.response_body, status: data.status_code ?? 200 };
  return { cached: false };
}

export async function saveIdempotency(
  accountId: string,
  key: string,
  endpoint: string,
  body: unknown,
  status: number,
  db: ReturnType<typeof adminClient>
): Promise<void> {
  await db.from('idempotency_keys').upsert(
    { account_id: accountId, idempotency_key: key, endpoint, response_body: body, status_code: status },
    { onConflict: 'account_id,idempotency_key,endpoint' }
  );
}

// ─── Security Events ───
export async function logSecurityEvent(
  db: ReturnType<typeof adminClient>,
  opts: {
    account_id?: string;
    event_type: string;
    severity: 'info' | 'warning' | 'critical';
    actor?: string;
    ip_address?: string;
    user_agent?: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  if (!opts.account_id) return;
  try {
    await db.from('security_events').insert({
      account_id: opts.account_id,
      event_type: opts.event_type,
      severity: opts.severity,
      actor: opts.actor ?? null,
      ip_address: opts.ip_address ?? null,
      user_agent: opts.user_agent ?? null,
      details: opts.details ?? null,
    });
  } catch {
    // تجاهل الأخطاء لعدم التأثير على سير الطلب
  }
}
