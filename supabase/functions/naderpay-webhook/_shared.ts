// مساعدات Webhook Receiver (مكررة داخل الـ Function لأن _shared لا يُضمّن أحيانًا للـ Functions الجديدة)
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const adminClient = () =>
  createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, x-webhook-authorization, x-webhook-event-id, x-webhook-timestamp, x-webhook-signature, x-webhook-idempotency-key',
};

export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function jsonErr(code: string, message: string, status: number, request_id?: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: { code, message, request_id: request_id ?? crypto.randomUUID(), ...extra } }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function deriveEncryptionKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const base = await crypto.subtle.digest('SHA-256', encoder.encode(serviceKey));
  return crypto.subtle.importKey('raw', base, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
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

export async function authenticateApiKeyBearer(
  req: Request,
  db: ReturnType<typeof adminClient>
): Promise<{ account_id: string; credential_id: string; key_id: string } | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const apiKey = auth.slice(7).trim();
  if (!apiKey) return null;
  return verifyApiKey(apiKey, db);
}

export async function authenticateApiKey(
  req: Request,
  db: ReturnType<typeof adminClient>
): Promise<{ account_id: string; credential_id: string; key_id: string } | null> {
  const apiKey = req.headers.get('x-api-key') ?? '';
  if (!apiKey) return null;
  return verifyApiKey(apiKey, db);
}

async function verifyApiKey(
  apiKey: string,
  db: ReturnType<typeof adminClient>
): Promise<{ account_id: string; credential_id: string; key_id: string } | null> {
  const [keyId, ...secretParts] = apiKey.split(':');
  const secret = secretParts.join(':');
  if (!keyId || !secret) return null;

  const { data: cred } = await db
    .from('api_credentials')
    .select('id, account_id, secret_hash, status')
    .eq('key_id', keyId)
    .eq('status', 'active')
    .maybeSingle();

  if (!cred) return null;

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(keyId), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(secret));
  const hash = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (hash !== cred.secret_hash) return null;

  await db.from('api_credentials').update({ last_used_at: new Date().toISOString() }).eq('id', cred.id);

  return { account_id: cred.account_id, credential_id: cred.id, key_id: keyId };
}

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
    // ignore
  }
}
