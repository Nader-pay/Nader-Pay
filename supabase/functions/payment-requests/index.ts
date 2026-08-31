// Payment Requests API — v1
// POST /v1/payment-requests, GET /{id}, POST /{id}/cancel, POST /{id}/status
import { adminClient, authenticateApiKey, authorizeScopes, checkIdempotency, saveIdempotency, jsonOk, jsonErr, CORS, logSecurityEvent } from '../_shared/auth.ts';

function validateRequestBody(body: Record<string, unknown>): { ok: true } | { ok: false; message: string } {
  if (!body.external_reference || typeof body.external_reference !== 'string') return { ok: false, message: 'external_reference مطلوب ويجب أن يكون نصًا' };
  if (typeof body.amount !== 'number' || body.amount <= 0) return { ok: false, message: 'amount يجب أن يكون رقمًا موجبًا' };
  if (!body.currency || typeof body.currency !== 'string') return { ok: false, message: 'currency مطلوبة' };
  if (body.destination && typeof body.destination !== 'object') return { ok: false, message: 'destination يجب أن يكون object' };
  if (body.customer && typeof body.customer !== 'object') return { ok: false, message: 'customer يجب أن يكون object' };
  if (body.verification && typeof body.verification !== 'object') return { ok: false, message: 'verification يجب أن يكون object' };
  return { ok: true };
}

function flattenDestination(body: Record<string, unknown>): Record<string, unknown> {
  const dest = body.destination as Record<string, unknown> | undefined;
  if (!dest) return {};
  return {
    expected_recipient_wallet: dest.wallet_number ?? dest.recipient_wallet ?? dest.phone ?? null,
    expected_recipient_name: dest.name ?? dest.recipient_name ?? null,
    expected_provider: dest.provider ?? null,
  };
}

function flattenCustomer(body: Record<string, unknown>): Record<string, unknown> {
  const c = body.customer as Record<string, unknown> | undefined;
  if (!c) return {};
  return {
    expected_sender_name: c.name ?? c.sender_name ?? null,
    expected_sender_phone: c.phone ?? c.sender_phone ?? null,
    customer_email: c.email ?? null,
  };
}

function flattenVerification(body: Record<string, unknown>): Record<string, unknown> {
  const v = body.verification as Record<string, unknown> | undefined;
  if (!v) return {};
  return {
    verification_required_fields: Array.isArray(v.required_fields) ? v.required_fields : null,
    verification_max_attempts: typeof v.max_attempts === 'number' ? v.max_attempts : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const db = adminClient();
  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\/payment-requests\/?/, '').split('/').filter(Boolean);
  const request_id = crypto.randomUUID();

  // المصادقة
  const auth = await authenticateApiKey(req, db);
  if (!auth) {
    await logSecurityEvent(db, {
      event_type: 'api.auth_failed',
      severity: 'warning',
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
      user_agent: req.headers.get('user-agent') ?? undefined,
    });
    return jsonErr('UNAUTHORIZED', 'مفتاح API غير صالح', 401, request_id);
  }
  const { account_id, credential_id, scopes } = auth;

  // التحقق من الصلاحيات
  const scopeCheck = authorizeScopes(scopes, ['payment_requests']);
  if (!scopeCheck.ok) {
    await logSecurityEvent(db, {
      account_id,
      event_type: 'api.scope_denied',
      severity: 'warning',
      actor: `api_key:${credential_id}`,
      details: { missing: scopeCheck.missing },
    });
    return jsonErr('FORBIDDEN', 'لا تملك صلاحية payment_requests', 403, request_id);
  }

  // جلب بيئة الـ Credential للتحقق منها لاحقًا
  const { data: cred } = await db.from('api_credentials').select('environment').eq('id', credential_id).maybeSingle();
  const credentialEnv = cred?.environment ?? 'sandbox';

  // POST /payment-requests — إنشاء
  if (req.method === 'POST' && pathParts.length === 0) {
    const idemKey = req.headers.get('x-idempotency-key');
    if (idemKey) {
      const cached = await checkIdempotency(account_id, idemKey, 'POST /payment-requests', db);
      if (cached.cached) return new Response(JSON.stringify(cached.body), { status: cached.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return jsonErr('INVALID_JSON', 'جسم الطلب غير صالح', 400, request_id); }

    const valid = validateRequestBody(body);
    if (!valid.ok) return jsonErr('VALIDATION_ERROR', valid.message, 422, request_id);

    const dest = flattenDestination(body);
    const cust = flattenCustomer(body);
    const ver = flattenVerification(body);

    const { data: pr, error } = await db.from('payment_requests').insert({
      account_id,
      external_reference: body.external_reference,
      order_reference: body.order_reference ?? null,
      payment_type: body.payment_type ?? 'wallet',
      amount: body.amount,
      currency: (body.currency as string).toUpperCase(),
      expected_sender_phone: cust.expected_sender_phone ?? null,
      expected_sender_name: cust.expected_sender_name ?? null,
      expected_recipient_wallet: dest.expected_recipient_wallet ?? null,
      destination: body.destination ?? null,
      customer: body.customer ?? null,
      verification: body.verification ?? null,
      expires_at: body.expires_at ?? null,
      metadata: body.metadata ?? null,
      status: 'CREATED',
    }).select('id, status, created_at, expires_at, external_reference, order_reference, amount, currency, destination, customer, verification').maybeSingle();

    if (error) return jsonErr('DB_ERROR', error.message, 500, request_id);

    await db.from('audit_events').insert({
      account_id,
      actor: `api_key:${credential_id}`,
      action: 'created',
      entity: 'payment_request',
      entity_id: pr!.id,
      metadata: { external_reference: pr!.external_reference, order_reference: pr!.order_reference },
    });

    const responseBody = {
      payment_request_id: pr!.id,
      status: pr!.status,
      created_at: pr!.created_at,
      expires_at: pr!.expires_at,
      external_reference: pr!.external_reference,
      order_reference: pr!.order_reference,
      amount: pr!.amount,
      currency: pr!.currency,
      destination: pr!.destination,
      customer: pr!.customer,
      verification: pr!.verification,
    };
    if (idemKey) await saveIdempotency(account_id, idemKey, 'POST /payment-requests', responseBody, 201, db);
    return jsonOk(responseBody, 201);
  }

  // GET /payment-requests/{id}
  if (req.method === 'GET' && pathParts.length === 1) {
    const id = pathParts[0];
    const { data: pr } = await db.from('payment_requests').select('*, payment_matches(*, transactions(*)), webhook_deliveries(*)').eq('id', id).eq('account_id', account_id).maybeSingle();
    if (!pr) return jsonErr('NOT_FOUND', 'طلب الدفع غير موجود', 404, request_id);

    return jsonOk({
      ...pr,
      payment_match: pr.payment_matches?.[0] ?? null,
      webhook_deliveries: pr.webhook_deliveries ?? [],
    });
  }

  // POST /payment-requests/{id}/cancel
  if (req.method === 'POST' && pathParts.length === 2 && pathParts[1] === 'cancel') {
    const id = pathParts[0];
    const { data: pr } = await db.from('payment_requests').select('status').eq('id', id).eq('account_id', account_id).maybeSingle();
    if (!pr) return jsonErr('NOT_FOUND', 'طلب الدفع غير موجود', 404, request_id);

    const terminalStates = ['CONFIRMED', 'REJECTED', 'DUPLICATE', 'EXPIRED', 'CANCELLED'];
    if (terminalStates.includes(pr.status))
      return jsonErr('INVALID_STATE', `لا يمكن إلغاء طلب بحالة ${pr.status}`, 409, request_id);

    const { data: updated } = await db.from('payment_requests')
      .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
      .eq('id', id).eq('account_id', account_id)
      .select('id, status, updated_at').maybeSingle();

    await db.from('audit_events').insert({
      account_id,
      actor: `api_key:${credential_id}`,
      action: 'cancelled',
      entity: 'payment_request',
      entity_id: id,
      metadata: { previous_status: pr.status },
    });

    return jsonOk({ payment_request_id: updated!.id, status: updated!.status, updated_at: updated!.updated_at });
  }

  // POST /payment-requests/{id}/status
  if (req.method === 'POST' && pathParts.length === 2 && pathParts[1] === 'status') {
    const id = pathParts[0];
    const { data: pr } = await db.from('payment_requests').select('status, reason_code').eq('id', id).eq('account_id', account_id).maybeSingle();
    if (!pr) return jsonErr('NOT_FOUND', 'طلب الدفع غير موجود', 404, request_id);
    return jsonOk({ payment_request_id: id, status: pr.status, reason_code: pr.reason_code });
  }

  return jsonErr('NOT_FOUND', 'المسار غير موجود', 404, request_id);
});
