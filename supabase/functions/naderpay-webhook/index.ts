// naderpay-webhook — Receiver endpoint that validates API credential + HMAC signature
import {
  adminClient,
  jsonOk,
  jsonErr,
  CORS,
  authenticateApiKey,
  verifyWebhookSignature,
  isWebhookTimestampValid,
  isWebhookEventReplayed,
  recordWebhookEvent,
  checkIdempotency,
  saveIdempotency,
  logSecurityEvent,
  decryptSecret,
} from './_shared.ts';

const ENDPOINT_PATH = 'naderpay-webhook';
const REQUEST_TIMEOUT_MS = 10000;

function getHeader(req: Request, name: string): string | null {
  const value = req.headers.get(name);
  if (!value) return null;
  return value.trim();
}

async function decryptSecretOrPlaintext(encrypted: string): Promise<string | null> {
  // Legacy plaintext secrets were stored without the iv.cipher separator
  if (!encrypted.includes('.')) {
    return encrypted;
  }
  try {
    return await decryptSecret(encrypted);
  } catch {
    return null;
  }
}

async function getActiveWebhookSecrets(
  db: ReturnType<typeof adminClient>,
  accountId: string
): Promise<string[]> {
  const { data: rows } = await db
    .from('webhook_secrets')
    .select('encrypted_secret')
    .eq('account_id', accountId)
    .eq('status', 'active');
  const secrets: string[] = [];
  for (const row of rows ?? []) {
    const secret = await decryptSecretOrPlaintext(row.encrypted_secret);
    if (secret) secrets.push(secret);
  }
  return secrets;
}

async function getEndpointSecrets(
  db: ReturnType<typeof adminClient>,
  accountId: string
): Promise<string[]> {
  const { data: rows } = await db
    .from('webhook_endpoints')
    .select('secret')
    .eq('account_id', accountId)
    .neq('secret', '');
  const secrets = (rows ?? []).map((r) => r.secret).filter(Boolean);
  return [...new Set(secrets)];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const requestId = crypto.randomUUID();
  const db = adminClient();

  // Only POST is accepted
  if (req.method !== 'POST') {
    return jsonErr('METHOD_NOT_ALLOWED', 'POST فقط', 405, requestId);
  }

  // 1. API credential via x-api-key or X-Webhook-Authorization header
  // The Edge Function runtime reserves Authorization for JWT auth, so the dispatcher
  // sends the API credential in X-Webhook-Authorization: Bearer <key_id>:<secret>
  let apiKey = getHeader(req, 'x-api-key');
  if (!apiKey) {
    const webhookAuth = getHeader(req, 'X-Webhook-Authorization') ?? getHeader(req, 'x-webhook-authorization');
    if (webhookAuth && webhookAuth.startsWith('Bearer ')) {
      apiKey = webhookAuth.slice(7).trim();
    }
  }
  if (!apiKey) {
    return jsonErr('UNAUTHORIZED_NO_AUTH_HEADER', 'مطلوب x-api-key أو X-Webhook-Authorization', 401, requestId);
  }

  // Set the header expected by the shared auth helper
  const reqClone = req.clone();
  const patchedHeaders = new Headers(reqClone.headers);
  patchedHeaders.set('x-api-key', apiKey);
  const patchedReq = new Request(reqClone, { headers: patchedHeaders });
  const auth = await authenticateApiKey(patchedReq, db);
  if (!auth) {
    return jsonErr('INVALID_API_CREDENTIAL', 'بيانات API credential غير صالحة', 401, requestId);
  }
  const { account_id, credential_id, key_id } = auth;

  const eventId = getHeader(req, 'X-Webhook-Event-Id');
  const timestamp = getHeader(req, 'X-Webhook-Timestamp');
  const signature = getHeader(req, 'X-Webhook-Signature');
  const idempotencyKey = getHeader(req, 'X-Webhook-Idempotency-Key');

  if (!eventId) {
    return jsonErr('MISSING_EVENT_ID', 'مطلوب X-Webhook-Event-Id', 401, requestId);
  }

  // 2. Idempotency: return cached response for valid duplicate requests
  if (idempotencyKey) {
    const cached = await checkIdempotency(account_id, idempotencyKey, ENDPOINT_PATH, db);
    if (cached.cached) {
      return jsonOk({ received: true, event_id: eventId, cached: true, body: cached.body }, cached.status);
    }
  }

  // 3. Timestamp validation
  if (!isWebhookTimestampValid(timestamp, 300)) {
    return jsonErr('TIMESTAMP_EXPIRED', 'الطابع الزمني منتهي أو غير صالح', 401, requestId);
  }

  // 4. Replay protection via event_id
  const replayed = await isWebhookEventReplayed(db, account_id, eventId, ENDPOINT_PATH);
  if (replayed) {
    await logSecurityEvent(db, {
      account_id,
      event_type: 'webhook.replay_detected',
      severity: 'warning',
      actor: `api:${credential_id}`,
      details: { event_id: eventId, key_id },
    });
    return jsonErr('EVENT_REPLAYED', 'تم استقبال هذا الحدث من قبل', 409, requestId);
  }

  // 5. Signature verification (required when account has HMAC webhook secrets)
  const webhookSecrets = await getActiveWebhookSecrets(db, account_id);
  const endpointSecrets = await getEndpointSecrets(db, account_id);
  const allSecrets = [...new Set([...webhookSecrets, ...endpointSecrets])];

  let rawBody = '';
  try {
    rawBody = await req.text();
  } catch {
    return jsonErr('BAD_REQUEST', 'تعذر قراءة جسم الطلب', 400, requestId);
  }

  if (allSecrets.length > 0) {
    if (!signature) {
      return jsonErr('MISSING_SIGNATURE', 'مطلوب X-Webhook-Signature', 401, requestId);
    }
    let signatureValid = false;
    for (const secret of allSecrets) {
      if (await verifyWebhookSignature(rawBody, signature, secret)) {
        signatureValid = true;
        break;
      }
    }
    if (!signatureValid) {
      await logSecurityEvent(db, {
        account_id,
        event_type: 'webhook.invalid_signature',
        severity: 'warning',
        actor: `api:${credential_id}`,
        details: { event_id: eventId, key_id },
      });
      return jsonErr('INVALID_SIGNATURE', 'توقيع Webhook غير صالح', 401, requestId);
    }
  }

  // 6. Record successful receipt
  await recordWebhookEvent(db, account_id, eventId, ENDPOINT_PATH);

  const responseBody = {
    received: true,
    event_id: eventId,
    timestamp: new Date().toISOString(),
    request_id: requestId,
    auth_result: 'success',
    auth_verified: true,
    signature_result: 'success',
    signature_verified: true,
    timestamp_verified: true,
  };

  if (idempotencyKey) {
    await saveIdempotency(account_id, idempotencyKey, ENDPOINT_PATH, responseBody, 200, db);
  }

  await logSecurityEvent(db, {
    account_id,
    event_type: 'webhook.received',
    severity: 'info',
    actor: `api:${credential_id}`,
    details: { event_id: eventId, key_id, has_signature: !!signature },
  });

  return jsonOk(responseBody);
});
