// Device API — register, heartbeat, event ingestion
import { adminClient, authenticateApiKey, authorizeScopes, authenticateDevice, createDeviceToken, jsonOk, jsonErr, CORS, logSecurityEvent } from '../_shared/auth.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function authenticateUserJwt(req: Request): Promise<{ userId: string; accountId: string } | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;

  const verifyClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: { user }, error } = await verifyClient.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await verifyClient
    .from('profiles')
    .select('account_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.account_id) return null;
  return { userId: user.id, accountId: profile.account_id };
}

// تطبيع رقم الهاتف (إزالة المسافات والشرطات، إضافة 0 للأرقام المصرية)
function normalizePhone(phone: string): string {
  let p = phone.replace(/[\s\-\(\)]/g, '');
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  if (p.startsWith('20') && p.length === 12) p = '0' + p.slice(2);
  return p;
}

// تحقق أمني من الجهاز: service status, version, blocked, revoked
async function checkDeviceSecurity(
  db: ReturnType<typeof adminClient>,
  deviceId: string,
  accountId: string,
  appVersion: string | null,
  req: Request
): Promise<{ ok: true } | { ok: false; code: string; message: string; status: number }> {
  // 1. Remote Control / Global Policies
  const { data: policy } = await db.from('global_policies').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (policy && !policy.service_enabled) {
    return { ok: false, code: 'SERVICE_DISABLED', message: 'الخدمة معطلة مركزيًا', status: 503 };
  }
  if (policy && appVersion && (policy.blocked_versions ?? []).includes(appVersion)) {
    await logSecurityEvent(db, {
      account_id: accountId,
      event_type: 'blocked_version',
      severity: 'warning',
      actor: `device:${deviceId}`,
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
      user_agent: req.headers.get('user-agent') ?? undefined,
      details: { app_version: appVersion },
    });
    return { ok: false, code: 'VERSION_BLOCKED', message: 'نسخة التطبيق محظورة', status: 403 };
  }
  if (policy && appVersion && policy.minimum_supported_version && appVersion < policy.minimum_supported_version) {
    return { ok: false, code: 'UPDATE_REQUIRED', message: 'يجب تحديث التطبيق', status: 426 };
  }

  // 2. حالة الجهاز
  const { data: device } = await db.from('devices').select('status, risk_level').eq('id', deviceId).eq('account_id', accountId).maybeSingle();
  if (!device) {
    return { ok: false, code: 'DEVICE_NOT_FOUND', message: 'الجهاز غير موجود', status: 404 };
  }
  if (device.status === 'revoked') {
    await logSecurityEvent(db, {
      account_id: accountId,
      event_type: 'credential_abuse',
      severity: 'critical',
      actor: `device:${deviceId}`,
      ip_address: req.headers.get('x-forwarded-for') ?? undefined,
      details: { reason: 'revoked_device_used' },
    });
    return { ok: false, code: 'DEVICE_REVOKED', message: 'تم إلغاء هذا الجهاز', status: 403 };
  }
  if (device.status === 'inactive') {
    return { ok: false, code: 'DEVICE_INACTIVE', message: 'الجهاز غير نشط', status: 403 };
  }
  if (device.risk_level === 'critical') {
    return { ok: false, code: 'DEVICE_RISK_CRITICAL', message: 'مستوى الخطر للجهاز حرج', status: 403 };
  }

  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const db = adminClient();
  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\/device-api\/?/, '').split('/').filter(Boolean);
  const request_id = crypto.randomUUID();

  // ─── POST /device-api/register ────────────────────────
  if (req.method === 'POST' && pathParts[0] === 'register') {
    const auth = await authenticateApiKey(req, db);
    if (!auth) return jsonErr('UNAUTHORIZED', 'مفتاح API غير صالح', 401, request_id);

    const scopeCheck = authorizeScopes(auth.scopes, ['devices']);
    if (!scopeCheck.ok) return jsonErr('FORBIDDEN', 'لا تملك صلاحية devices', 403, request_id);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return jsonErr('INVALID_JSON', 'جسم الطلب غير صالح', 400, request_id); }

    if (!body.device_name) return jsonErr('VALIDATION_ERROR', 'اسم الجهاز مطلوب', 422, request_id);

    const { data: device, error } = await db.from('devices').insert({
      account_id:      auth.account_id,
      device_name:     body.device_name,
      platform:        body.platform ?? 'android',
      app_version:     body.app_version ?? null,
      android_version: body.android_version ?? null,
      installation_id: body.installation_id ?? null,
      credential_id:   crypto.randomUUID(),
      status:          'active',
      listener_status: 'unknown',
      sync_status:     'unknown',
      risk_level:      'low',
    }).select('id, device_name, platform').maybeSingle();

    if (error) return jsonErr('DB_ERROR', error.message, 500, request_id);

    // إنشاء device token
    const token = await createDeviceToken(device!.id, auth.account_id, db);

    await db.from('audit_events').insert({
      account_id: auth.account_id,
      actor:      `api_key:${auth.credential_id}`,
      action:     'registered',
      entity:     'device',
      entity_id:  device!.id,
      metadata:   { device_name: device!.device_name },
    });

    return jsonOk({ device_id: device!.id, device_name: device!.device_name, device_token: token }, 201);
  }

  // ─── POST /device-api/register-with-auth (user JWT) ───
  if (req.method === 'POST' && pathParts[0] === 'register-with-auth') {
    const userAuth = await authenticateUserJwt(req);
    if (!userAuth) return jsonErr('UNAUTHORIZED', 'جلسة المستخدم غير صالحة', 401, request_id);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return jsonErr('INVALID_JSON', 'جسم الطلب غير صالح', 400, request_id); }

    if (!body.device_name) return jsonErr('VALIDATION_ERROR', 'اسم الجهاز مطلوب', 422, request_id);

    const { data: device, error } = await db.from('devices').insert({
      account_id:      userAuth.accountId,
      device_name:     body.device_name,
      platform:        body.platform ?? 'android',
      app_version:     body.app_version ?? null,
      android_version: body.android_version ?? null,
      installation_id: body.installation_id ?? null,
      credential_id:   crypto.randomUUID(),
      status:          'active',
      listener_status: 'unknown',
      sync_status:     'unknown',
      risk_level:      'low',
    }).select('id, device_name, platform').maybeSingle();

    if (error) return jsonErr('DB_ERROR', error.message, 500, request_id);

    const token = await createDeviceToken(device!.id, userAuth.accountId, db);

    await db.from('audit_events').insert({
      account_id: userAuth.accountId,
      actor:      `user:${userAuth.userId}`,
      action:     'registered',
      entity:     'device',
      entity_id:  device!.id,
      metadata:   { device_name: device!.device_name, source: 'user_agent' },
    });

    return jsonOk({ device_id: device!.id, device_name: device!.device_name, device_token: token }, 201);
  }

  // ─── POST /device-api/{device_id}/heartbeat ───────────
  if (req.method === 'POST' && pathParts.length === 2 && pathParts[1] === 'heartbeat') {
    const deviceId = pathParts[0];
    const token    = req.headers.get('x-device-token') ?? '';
    const auth     = await authenticateDevice(deviceId, token, db);
    if (!auth) return jsonErr('UNAUTHORIZED', 'رمز الجهاز غير صالح', 401, request_id);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return jsonErr('INVALID_JSON', 'جسم الطلب غير صالح', 400, request_id); }

    const security = await checkDeviceSecurity(db, deviceId, auth.account_id, body.app_version as string | null, req);
    if (!security.ok) return jsonErr(security.code, security.message, security.status, request_id);

    await db.from('devices').update({
      last_seen_at:    new Date().toISOString(),
      app_version:     body.app_version ?? null,
      android_version: body.android_version ?? null,
      listener_status: body.listener_status ?? 'unknown',
      sync_status:     body.sync_queue_size === 0 ? 'synced' : 'pending',
      updated_at:      new Date().toISOString(),
    }).eq('id', deviceId).eq('account_id', auth.account_id);

    return jsonOk({ ok: true, server_time: new Date().toISOString() });
  }

  // ─── POST /device-api/{device_id}/events ──────────────
  if (req.method === 'POST' && pathParts.length === 2 && pathParts[1] === 'events') {
    const deviceId = pathParts[0];
    const token    = req.headers.get('x-device-token') ?? '';
    const auth     = await authenticateDevice(deviceId, token, db);
    if (!auth) return jsonErr('UNAUTHORIZED', 'رمز الجهاز غير صالح', 401, request_id);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return jsonErr('INVALID_JSON', 'جسم الطلب غير صالح', 400, request_id); }

    const security = await checkDeviceSecurity(db, deviceId, auth.account_id, body.app_version as string | null, req);
    if (!security.ok) return jsonErr(security.code, security.message, security.status, request_id);

    // دعم حدثي دليل الدفع والرفض اليدوي
    if (body.event_type === 'payment_evidence_detected') {
      // التحقق من الحقول المطلوبة
      const required = ['event_id', 'provider', 'transaction_id', 'amount', 'currency', 'occurred_at'];
      for (const f of required) {
        if (!body[f]) return jsonErr('VALIDATION_ERROR', `الحقل ${f} مطلوب`, 422, request_id);
      }

      // Idempotency بواسطة transaction_id + provider
      const { data: existing } = await db.from('transactions')
        .select('id, verification_status')
        .eq('account_id', auth.account_id)
        .eq('provider', body.provider)
        .eq('transaction_id', body.transaction_id)
        .maybeSingle();

      if (existing) {
        return jsonOk({ ingested: false, duplicate: true, transaction_id: existing.id, verification_status: existing.verification_status });
      }

      // تطبيع أرقام الهواتف
      const senderPhone = body.sender_phone ? normalizePhone(body.sender_phone as string) : null;
      const recipientWallet = body.recipient_wallet ? normalizePhone(body.recipient_wallet as string) : null;

      // إدراج المعاملة
      const { data: tx, error: txErr } = await db.from('transactions').insert({
        account_id:            auth.account_id,
        provider:              body.provider,
        transaction_id:        body.transaction_id,
        amount:                body.amount,
        currency:              (body.currency as string).toUpperCase(),
        sender_phone:          senderPhone,
        sender_name:           body.sender_name ?? null,
        recipient_wallet:      recipientWallet,
        occurred_at:           body.occurred_at,
        raw_message:           body.raw_message ?? null,
        normalized_message:    body.normalized_message ?? null,
        message_hash:          body.message_hash ?? null,
        source_package:        body.source_package ?? null,
        detected_by_device_id: deviceId,
        verification_status:   'pending',
      }).select('id').maybeSingle();

      if (txErr) return jsonErr('DB_ERROR', txErr.message, 500, request_id);

      // تحديث last_seen_at للجهاز
      await db.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', deviceId);

      // استدعاء Verification Engine بشكل غير متزامن
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      fetch(`${supabaseUrl}/functions/v1/verification-engine`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body:    JSON.stringify({ transaction_id: tx!.id, account_id: auth.account_id }),
      }).catch(() => { /* نتجاهل أخطاء الاستدعاء الجانبي */ });

      return jsonOk({ ingested: true, transaction_id: tx!.id, verification_status: 'pending' }, 202);
    }

    if (body.event_type === 'payment_rejected') {
      const paymentRequestId = body.payment_request_id as string;
      const rejectionReason = body.rejection_reason as string;
      if (!paymentRequestId) return jsonErr('VALIDATION_ERROR', 'payment_request_id مطلوب', 422, request_id);

      const { data: pr } = await db.from('payment_requests')
        .select('id, status')
        .eq('id', paymentRequestId)
        .eq('account_id', auth.account_id)
        .maybeSingle();

      if (!pr) return jsonErr('NOT_FOUND', 'طلب الدفع غير موجود', 404, request_id);
      if (pr.status === 'CONFIRMED') return jsonErr('INVALID_STATE', 'لا يمكن رفض طلب مؤكد', 422, request_id);

      await db.from('payment_requests')
        .update({ status: 'REJECTED', reason_code: rejectionReason || 'MANUAL_REJECT', updated_at: new Date().toISOString() })
        .eq('id', paymentRequestId);

      await db.from('audit_events').insert({
        account_id: auth.account_id,
        actor:      `device:${deviceId}`,
        action:     'rejected',
        entity:     'payment_request',
        entity_id:  paymentRequestId,
        metadata:   { reason: rejectionReason },
      });

      return jsonOk({ rejected: true, payment_request_id: paymentRequestId }, 200);
    }

    return jsonErr('UNSUPPORTED_EVENT', `نوع الحدث ${body.event_type} غير مدعوم`, 422, request_id);
  }

  return jsonErr('NOT_FOUND', 'المسار غير موجود', 404, request_id);
});
