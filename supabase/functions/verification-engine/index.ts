// Verification Engine — Rule-based payment matching
import { adminClient, jsonOk, jsonErr, CORS } from '../_shared/auth.ts';

const serviceKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  let p = phone.replace(/[\s\-\(\)]/g, '');
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  if (p.startsWith('20') && p.length === 12) p = '0' + p.slice(2);
  return p;
}

function phonesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return timingSafeStringEqual(normalizePhone(a) ?? '', normalizePhone(b) ?? '');
}

/** مقارنة ثابتة الوقت لمنع Timing Attacks */
function timingSafeStringEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) {
    // قراءة كلا الطرفين لمنع التسريب عبر التوقيت
    let diff = 0;
    for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0);
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // يُستدعى داخليًا فقط — يتحقق من service role
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.includes(serviceKey()))
    return jsonErr('UNAUTHORIZED', 'داخلي فقط', 401);

  const db = adminClient();
  const request_id = crypto.randomUUID();

  let body: { transaction_id: string; account_id: string };
  try { body = await req.json(); } catch { return jsonErr('INVALID_JSON', 'جسم غير صالح', 400, request_id); }

  const { transaction_id, account_id } = body;

  // 1. تحميل المعاملة
  const { data: tx } = await db.from('transactions').select('*').eq('id', transaction_id).eq('account_id', account_id).maybeSingle();
  if (!tx) return jsonErr('NOT_FOUND', 'المعاملة غير موجودة', 404, request_id);

  // 2. التحقق من تكرار message_hash
  if (tx.message_hash) {
    const { count } = await db.from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', account_id)
      .eq('message_hash', tx.message_hash)
      .neq('id', transaction_id);
    if ((count ?? 0) > 0) {
      await finalizeTransaction(db, transaction_id, account_id, 'duplicate', null, 'DUPLICATE', 'تكرار message_hash', 'DUPLICATE_TRANSACTION');
      return jsonOk({ result: 'DUPLICATE', reason: 'duplicate_message_hash' });
    }
  }

  // 3. التحقق من تكرار transaction_id داخل نفس المزود
  const { count: txCount } = await db.from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', account_id)
    .eq('provider', tx.provider)
    .eq('transaction_id', tx.transaction_id)
    .neq('id', transaction_id);
  if ((txCount ?? 0) > 0) {
    await finalizeTransaction(db, transaction_id, account_id, 'duplicate', null, 'DUPLICATE', 'تكرار transaction_id', 'DUPLICATE_TRANSACTION');
    return jsonOk({ result: 'DUPLICATE', reason: 'duplicate_transaction_id' });
  }

  // 4. فحص عمر المعاملة (أقدم من 24 ساعة)
  const txAge = Date.now() - new Date(tx.occurred_at).getTime();
  if (txAge > 24 * 60 * 60 * 1000) {
    await finalizeTransaction(db, transaction_id, account_id, 'failed', null, null, 'المعاملة قديمة جدًا', 'EXPIRED_REQUEST');
    return jsonOk({ result: 'REJECTED', reason: 'transaction_too_old' });
  }

  // 5. البحث عن PaymentRequest مؤهل (WAITING_PAYMENT أو CREATED)
  const { data: candidates } = await db.from('payment_requests')
    .select('*')
    .eq('account_id', account_id)
    .in('status', ['CREATED', 'WAITING_PAYMENT', 'MESSAGE_DETECTED', 'PARSING', 'VERIFYING'])
    .order('created_at', { ascending: true });

  const eligible = (candidates ?? []).filter(pr => {
    // فحص انتهاء الصلاحية
    if (pr.expires_at && new Date(pr.expires_at) < new Date()) return false;
    // مطابقة المبلغ (±0.01 للتقريب)
    if (Math.abs(pr.amount - tx.amount) > 0.01) return false;
    // مطابقة العملة
    if (pr.currency !== tx.currency) return false;
    return true;
  });

  if (eligible.length === 0) {
    await finalizeTransaction(db, transaction_id, account_id, 'failed', null, null, 'لا يوجد طلب دفع مطابق', 'NO_MATCHING_REQUEST');
    return jsonOk({ result: 'REJECTED', reason: 'no_matching_request' });
  }

  // 6. اختيار أفضل طلب مطابق
  let bestMatch = null;
  let bestScore = -1;
  let bestChecks = null;

  for (const pr of eligible) {
    const checks = {
      amount_match: Math.abs(pr.amount - tx.amount) <= 0.01,
      sender_name_match: false,
      sender_phone_match: false,
      recipient_match: false,
      is_unique: true,
      time_valid: new Date(tx.occurred_at) >= new Date(pr.created_at),
      provider_valid: true,
      confidence_score: 0,
    };

    let score = 0;
    let critical = true;

    // مطابقة المبلغ — 40 نقطة (حرجة)
    if (checks.amount_match) score += 40;
    else { critical = false; }

    // مطابقة رقم المرسل — 30 نقطة (حرجة إذا كانت محددة)
    if (pr.expected_sender_phone) {
      checks.sender_phone_match = phonesMatch(pr.expected_sender_phone, tx.sender_phone);
      if (checks.sender_phone_match) {
        score += 30;
      } else {
        critical = false;
      }
    } else {
      // لم يُحدَّد رقم المرسل — منح 10 نقاط افتراضية
      score += 10;
    }

    if (!critical) continue;

    // مطابقة المحفظة المستلمة — 20 نقطة (حرجة إذا كانت محددة)
    if (pr.expected_recipient_wallet && tx.recipient_wallet) {
      checks.recipient_match = phonesMatch(pr.expected_recipient_wallet, tx.recipient_wallet);
      if (checks.recipient_match) {
        score += 20;
      } else {
        continue;
      }
    }

    // مطابقة اسم المرسل — 20 (تطابق كامل) أو 10 (تطابق جزئي) نقطة
    if (pr.expected_sender_name && tx.sender_name) {
      const prName = pr.expected_sender_name.toLowerCase().trim();
      const txName = tx.sender_name.toLowerCase().trim();
      if (timingSafeStringEqual(prName, txName)) {
        score += 20;
        checks.sender_name_match = true;
      } else if (txName.includes(prName) || prName.includes(txName)) {
        score += 10;
        checks.sender_name_match = true;
      }
    }

    // النافذة الزمنية — 10 نقاط (حرجة)
    if (checks.time_valid) score += 10;
    else { critical = false; }

    if (!critical) continue;

    checks.confidence_score = score;
    if (score > bestScore) { bestScore = score; bestMatch = pr; bestChecks = checks; }
  }

  if (!bestMatch) {
    await finalizeTransaction(db, transaction_id, account_id, 'failed', null, null, 'المعاملة لا تطابق أي طلب بعد التحقق', 'INVALID_EVIDENCE');
    return jsonOk({ result: 'REJECTED', reason: 'verification_failed' });
  }

  // 7. فحص عدم استخدام هذا الطلب من قبل (PaymentMatch)
  const { data: existingMatch } = await db.from('payment_matches')
    .select('id')
    .eq('payment_request_id', bestMatch.id)
    .maybeSingle();

  if (existingMatch) {
    await finalizeTransaction(db, transaction_id, account_id, 'duplicate', null, 'DUPLICATE', 'طلب الدفع مستخدم بالفعل', 'DUPLICATE_TRANSACTION');
    return jsonOk({ result: 'DUPLICATE', reason: 'payment_request_already_matched' });
  }

  // 8. تحديد النتيجة النهائية
  let finalVerifStatus: string;
  let finalPrStatus: string;
  let reasonCode: string;

  if (bestScore >= 70) {
    finalVerifStatus = 'verified';
    finalPrStatus = 'CONFIRMED';
    reasonCode = 'MATCHED_ALL_REQUIRED_FIELDS';
  } else if (bestScore >= 40) {
    finalVerifStatus = 'review_required';
    finalPrStatus = 'REVIEW_REQUIRED';
    reasonCode = 'PARTIAL_DATA';
  } else {
    finalVerifStatus = 'failed';
    finalPrStatus = 'REJECTED';
    reasonCode = 'AMOUNT_MISMATCH';
    await finalizeTransaction(db, transaction_id, account_id, finalVerifStatus, null, finalPrStatus, `score منخفض: ${bestScore}`, reasonCode, bestChecks ?? undefined);
    return jsonOk({ result: 'REJECTED', reason: 'low_confidence_score' });
  }

  // 9. إتمام التأكيد بشكل ذري
  await finalizeTransaction(db, transaction_id, account_id, finalVerifStatus, bestMatch.id, finalPrStatus, null, reasonCode, bestChecks ?? undefined);

  // 10. قائمة انتظار Webhook
  await queueWebhook(db, account_id, bestMatch.id, transaction_id, finalPrStatus);

  return jsonOk({
    result: finalPrStatus,
    payment_request_id: bestMatch.id,
    transaction_id,
    score: bestScore,
  });
});

async function finalizeTransaction(
  db: ReturnType<typeof adminClient>,
  txId: string,
  accountId: string,
  verifStatus: string,
  prId: string | null,
  prStatus: string | null,
  reason: string | null,
  reasonCode: string | null,
  checks?: {
    amount_match?: boolean;
    sender_name_match?: boolean;
    sender_phone_match?: boolean;
    recipient_match?: boolean;
    is_unique?: boolean;
    time_valid?: boolean;
    provider_valid?: boolean;
    confidence_score?: number;
  }
) {
  // تحديث حالة المعاملة
  await db.from('transactions').update({ verification_status: verifStatus, reason_code: reasonCode }).eq('id', txId);

  if (prId && prStatus) {
    // تحديث حالة طلب الدفع
    await db.from('payment_requests')
      .update({ status: prStatus, reason_code: reasonCode, updated_at: new Date().toISOString() })
      .eq('id', prId);

    // إنشاء PaymentMatch مع نتائج التحقق
    if (['verified', 'review_required'].includes(verifStatus)) {
      await db.from('payment_matches').insert({
        account_id:          accountId,
        payment_request_id:  prId,
        transaction_id:      txId,
        matched_by:          'system',
        notes:               reason,
      });
    }
  }

  // سجل AuditEvent
  await db.from('audit_events').insert({
    account_id: accountId,
    actor:      'system:verification-engine',
    action:     'verification_result',
    entity:     'transaction',
    entity_id:  txId,
    metadata:   { verification_status: verifStatus, payment_request_id: prId, payment_request_status: prStatus, reason, reason_code: reasonCode, checks },
  });
}

async function queueWebhook(
  db: ReturnType<typeof adminClient>,
  accountId: string,
  prId: string,
  txId: string,
  prStatus: string
) {
  const eventMap: Record<string, string> = {
    CONFIRMED:       'payment.confirmed',
    REJECTED:        'payment.rejected',
    REVIEW_REQUIRED: 'payment.review_required',
    EXPIRED:         'payment.expired',
    CANCELLED:       'payment.cancelled',
  };
  const eventType = eventMap[prStatus];
  if (!eventType) return;

  // جلب endpoints المفعلة المرتبطة بالتكامل
  const { data: endpoints } = await db.from('webhook_endpoints')
    .select('id, integration_id')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .contains('events', [eventType]);

  if (!endpoints?.length) return;

  const { data: pr } = await db.from('payment_requests').select('external_reference, order_reference, amount, currency, destination, customer, verification, status, reason_code, created_at, expires_at').eq('id', prId).maybeSingle();
  const { data: tx } = await db.from('transactions').select('sender_phone, sender_name').eq('id', txId).maybeSingle();

  const eventId = `${prId}:${eventType}`;
  const payload = {
    event:       eventType,
    id:          eventId,
    version:     '2026-01',
    created_at:  new Date().toISOString(),
    data: {
      id:                 prId,
      order_reference:    pr?.order_reference ?? null,
      external_reference: pr?.external_reference ?? null,
      amount:             pr?.amount ?? null,
      currency:           pr?.currency ?? null,
      status:             prStatus.toLowerCase(),
      transaction_id:     txId,
      sender_phone:       tx?.sender_phone ?? null,
      sender_name:        tx?.sender_name ?? null,
      reason_code:        pr?.reason_code ?? null,
    },
  };

  const deliveries = endpoints.map((ep) => ({
    account_id:         accountId,
    endpoint_id:        ep.id,
    integration_id:     ep.integration_id,
    payment_request_id: prId,
    event_id:           eventId,
    event_type:         eventType,
    payload,
    attempts:           0,
    max_attempts:       5,
    status:             'pending',
    next_attempt_at:    new Date().toISOString(),
    payload_version:    '2026-01',
  }));

  await db.from('webhook_deliveries').insert(deliveries);
}
