/**
 * productionMatchingEngine.ts
 * ════════════════════════════════════════════════════════════════
 * Production Order Matching Engine — المرحلة الثانية
 *
 * محرك مستقل عن UI يطبّق قواعد التحقق الصارمة:
 *  - Trusted Source مطلوب أولاً
 *  - Provider-specific verification rules
 *  - MatchResult codes كاملة (لا Boolean فقط)
 *  - Time Window قابل للتهيئة
 *  - Duplicate/Replay Protection مدمج
 *  - لا تأكيد بمجرد تطابق المبلغ وحده
 * ════════════════════════════════════════════════════════════════
 */

import { logEvent, logVerification, dbReady } from '@/lib/database';
import { isTransactionDuplicate, markTransactionProcessed } from './duplicateProtection';
import type { NormalizedTransaction, CanonicalTransaction } from './normalizedTransaction';
import type { ProviderName } from '@/types/provider';
import type { Order } from '@/types/agent';

// ─── Match Result Codes ───────────────────────────────────────────────────────

export type ProductionMatchCode =
  | 'EXACT_MATCH'
  | 'PARTIAL_MATCH'
  | 'AMOUNT_MISMATCH'
  | 'ACCOUNT_MISMATCH'
  | 'SENDER_MISMATCH'
  | 'PROVIDER_MISMATCH'
  | 'SOURCE_NOT_TRUSTED'
  | 'TRANSACTION_TOO_OLD'
  | 'TRANSACTION_IN_FUTURE'
  | 'DUPLICATE_TRANSACTION'
  | 'ALREADY_USED'
  | 'INVALID_PAYMENT_MESSAGE'
  | 'UNSUPPORTED_MESSAGE'
  | 'INSUFFICIENT_EVIDENCE'
  | 'NO_MATCH';

export type ProductionMatchResult = {
  code: ProductionMatchCode;
  /** درجة التطابق 0–100 */
  score: number;
  /** أسباب قابلة للعرض في Admin/Logs */
  reasons: string[];
  /** هل يُسمح بالتأكيد التلقائي؟ */
  canAutoConfirm: boolean;
  /** الطلب المطابق */
  order: Order | null;
  /** المعاملة المُعيَّرة */
  transaction: NormalizedTransaction | null;
};

// ─── Provider Time Windows ────────────────────────────────────────────────────

const PROVIDER_TIME_WINDOWS_HOURS: Record<ProviderName, number> = {
  vodafone_cash: 24,
  insta_pay: 48,
  orange_cash: 24,
  bank_transfer: 72,
  unknown: 24,
};

// ─── Main Matching Function ───────────────────────────────────────────────────

/**
 * مطابقة Canonical Transaction مع قائمة الطلبات المعلقة.
 * يطبّق قواعد التحقق الصارمة لكل Provider.
 */
export async function matchTransactionToOrders(
  canonical: CanonicalTransaction,
  pendingOrders: Order[],
  options: {
    sourceTrusted?: boolean;
    sourceId?: string;
    timeWindowHoursOverride?: number;
    amountTolerancePct?: number;
    requireSenderPhone?: boolean;
  } = {}
): Promise<ProductionMatchResult> {
  const normalized = canonical.normalized;

  // ── 1. Trusted Source مطلوب ─────────────────────────────────────────────────
  if (!options.sourceTrusted) {
    await logProductionEvent('SOURCE_NOT_TRUSTED', normalized, null, 'المصدر غير موثق');
    return noMatchResult('SOURCE_NOT_TRUSTED', 0, ['المصدر غير موثق — تم تجاهل المعاملة'], normalized);
  }

  // ── 2. نوع المعاملة يجب أن يكون incoming_payment ────────────────────────────
  if (normalized.transactionType !== 'incoming_payment') {
    return noMatchResult('INVALID_PAYMENT_MESSAGE', 0, [`نوع المعاملة غير صالح: ${normalized.transactionType}`], normalized);
  }

  // ── 3. Duplicate Check قبل المطابقة ─────────────────────────────────────────
  const isDup = await isTransactionDuplicate(
    normalized.providerId,
    normalized.transactionId,
    normalized.amount,
    normalized.receiverAccount ?? normalized.receiverWallet ?? null,
    normalized.transactionDateTime.slice(0, 10) || null
  );
  if (isDup) {
    await logProductionEvent('DUPLICATE_TRANSACTION', normalized, null, 'معاملة مكررة');
    return noMatchResult('DUPLICATE_TRANSACTION', 0, ['معاملة مكررة — تم استخدام هذه المعاملة مسبقاً'], normalized);
  }

  // ── 4. فحص ALREADY_USED (مرتبطة بطلب آخر) ─────────────────────────────────
  const alreadyUsedOrder = await getTransactionLinkedOrder(normalized.transactionFingerprint);
  if (alreadyUsedOrder !== null) {
    await logProductionEvent('ALREADY_USED', normalized, null, `مرتبطة بالطلب ${alreadyUsedOrder}`);
    return noMatchResult('ALREADY_USED', 0,
      [`هذه المعاملة مرتبطة بالطلب ${alreadyUsedOrder} ولا يمكن استخدامها مجدداً`], normalized
    );
  }

  // ── 5. Insufficient Evidence (InstaPay Notification فقط) ───────────────────
  if (!canonical.isSufficient) {
    await logProductionEvent('INSUFFICIENT_EVIDENCE', normalized, null, 'أدلة غير كافية');
    return noMatchResult('INSUFFICIENT_EVIDENCE', 0,
      ['الأدلة غير كافية للتحقق — يلزم SMS أو دليل إضافي'], normalized
    );
  }

  // ── 6. فلترة الطلبات المؤهلة ────────────────────────────────────────────────
  const timeWindowHours = options.timeWindowHoursOverride ?? PROVIDER_TIME_WINDOWS_HOURS[normalized.providerId];
  const eligible = pendingOrders.filter((o) => isOrderEligibleForMatching(o, normalized, timeWindowHours));

  if (eligible.length === 0) {
    return noMatchResult('NO_MATCH', 0, ['لا يوجد طلب مؤهل مطابق'], normalized);
  }

  // ── 7. تسجيل المطابقة لكل طلب مؤهل ──────────────────────────────────────────
  const scored = eligible.map((order) =>
    scoreOrderMatch(normalized, order, {
      amountTolerancePct: options.amountTolerancePct ?? 0,
      requireSenderPhone: options.requireSenderPhone ?? false,
      timeWindowHours,
    })
  ).sort((a, b) => b.score - a.score);

  const best = scored[0];

  // ── 8. تحقق من غموض النتائج ──────────────────────────────────────────────────
  if (scored.length >= 2 && best.score - scored[1].score < 10) {
    await logProductionEvent('PARTIAL_MATCH', normalized, best.order.id, `نتائج متقاربة: ${best.score} vs ${scored[1].score}`);
    return {
      code: 'PARTIAL_MATCH',
      score: best.score,
      reasons: [...best.reasons, 'نتيجة غامضة: تطابقات متقاربة — يلزم مراجعة'],
      canAutoConfirm: false,
      order: best.order,
      transaction: normalized,
    };
  }

  await logVerification(
    best.order.id,
    'production_match',
    best.code === 'EXACT_MATCH' ? 'matched' : 'partial',
    `${best.code}: ${best.score}`,
    normalized as any,
    normalized.transactionId
  );

  return {
    code: best.code,
    score: best.score,
    reasons: best.reasons,
    canAutoConfirm: best.code === 'EXACT_MATCH' && best.score >= 80,
    order: best.order,
    transaction: normalized,
  };
}

// ─── Provider-specific Scoring ────────────────────────────────────────────────

type ScoredResult = {
  code: ProductionMatchCode;
  score: number;
  reasons: string[];
  order: Order;
};

function scoreOrderMatch(
  tx: NormalizedTransaction,
  order: Order,
  opts: { amountTolerancePct: number; requireSenderPhone: boolean; timeWindowHours: number }
): ScoredResult {
  const reasons: string[] = [];
  let score = 0;

  // ── Provider تطابق ──────────────────────────────────────────────────────────
  if (order.provider && order.provider !== 'unknown' && order.provider !== tx.providerId) {
    return { code: 'PROVIDER_MISMATCH', score: 0, reasons: ['Provider غير متطابق'], order };
  }

  // ── المبلغ (50 نقطة) ────────────────────────────────────────────────────────
  const tolerance = Math.max(0.01, order.amount * (opts.amountTolerancePct / 100));
  const amountDiff = Math.abs(tx.amount - order.amount);
  if (amountDiff > tolerance) {
    return { code: 'AMOUNT_MISMATCH', score: 10, reasons: [`مبلغ مختلف: استُلم ${tx.amount}، المتوقع ${order.amount}`], order };
  }
  score += amountDiff === 0 ? 55 : 45;
  reasons.push(amountDiff === 0 ? 'المبلغ متطابق تماماً' : `المبلغ ضمن التسامح المسموح`);

  // ── محفظة المستلم — Vodafone Cash (15 نقطة) ─────────────────────────────────
  if (tx.providerId === 'vodafone_cash') {
    if (order.expected_recipient_wallet && tx.receiverWallet) {
      if (phonesMatch(order.expected_recipient_wallet, tx.receiverWallet)) {
        score += 15;
        reasons.push('محفظة المستلم متطابقة');
      } else {
        return { code: 'ACCOUNT_MISMATCH', score: 0, reasons: ['محفظة المستلم غير متطابقة — Vodafone Cash يتطلب مطابقة المحفظة'], order };
      }
    }
  }

  // ── حساب المستلم — InstaPay (20 نقطة) ──────────────────────────────────────
  if (tx.providerId === 'insta_pay') {
    if (order.expected_recipient_wallet && tx.receiverAccount) {
      const expLast4 = order.expected_recipient_wallet.slice(-4);
      const gotLast4 = tx.receiverAccount.replace(/x/gi, '').slice(-4);
      if (expLast4 === gotLast4) {
        score += 20;
        reasons.push('حساب المستلم متطابق');
      } else {
        return { code: 'ACCOUNT_MISMATCH', score: 0, reasons: ['حساب InstaPay غير متطابق'], order };
      }
    }
  }

  // ── رقم المُرسِل (15 نقطة) ─────────────────────────────────────────────────
  if (order.expected_sender_phone && tx.senderPhone) {
    if (phonesMatch(order.expected_sender_phone, tx.senderPhone)) {
      score += 15;
      reasons.push('رقم المُرسِل متطابق');
    } else if (opts.requireSenderPhone) {
      return { code: 'SENDER_MISMATCH', score: 0, reasons: ['رقم المُرسِل غير متطابق (مطلوب)'], order };
    } else {
      score -= 5;
      reasons.push('رقم المُرسِل مختلف (اختياري)');
    }
  }

  // ── اسم المُرسِل (10 نقطة) ────────────────────────────────────────────────
  if (order.expected_sender_name && tx.senderName) {
    if (namesMatch(order.expected_sender_name, tx.senderName)) {
      score += 10;
      reasons.push('اسم المُرسِل متطابق');
    }
  }

  // ── النافذة الزمنية (10 نقاط) ────────────────────────────────────────────
  const txTime = new Date(tx.transactionDateTime).getTime();
  const orderTime = order.created_at ? new Date(order.created_at).getTime() : 0;
  const nowTime = Date.now();

  if (txTime > nowTime + 60_000) {
    return { code: 'TRANSACTION_IN_FUTURE', score: 0, reasons: [`وقت العملية في المستقبل: ${tx.transactionDateTime}`], order };
  }

  if (orderTime > 0) {
    const diffHrs = (txTime - orderTime) / 3_600_000;
    if (diffHrs < -1) {
      return { code: 'TRANSACTION_TOO_OLD', score: 0, reasons: [`العملية قديمة: سبقت الطلب بـ${Math.abs(Math.round(diffHrs))} ساعة`], order };
    }
    if (diffHrs > opts.timeWindowHours) {
      return { code: 'TRANSACTION_TOO_OLD', score: 0, reasons: [`العملية خارج نافذة البحث (${Math.round(diffHrs)} ساعة)`], order };
    }
    score += 10;
    reasons.push('الوقت ضمن النافذة المسموحة');
  }

  score = Math.min(100, Math.max(0, score));
  const code: ProductionMatchCode = score >= 80 ? 'EXACT_MATCH' : score >= 50 ? 'PARTIAL_MATCH' : 'NO_MATCH';
  return { code, score, reasons, order };
}

// ─── Eligibility Filter ───────────────────────────────────────────────────────

function isOrderEligibleForMatching(
  order: Order,
  tx: NormalizedTransaction,
  windowHours: number
): boolean {
  // حالات مقبولة فقط
  const activeStatuses = ['new', 'scanning', 'matched', 'review_required'];
  if (!activeStatuses.includes(order.localStatus ?? 'new')) return false;

  // Provider isolation
  if (order.provider && order.provider !== 'unknown' && order.provider !== tx.providerId) return false;

  // انتهاء الصلاحية
  if (order.expires_at && new Date(order.expires_at) < new Date()) return false;

  // نافذة زمنية
  if (order.created_at) {
    const orderTime = new Date(order.created_at).getTime();
    const txTime = new Date(tx.transactionDateTime).getTime();
    const diffHrs = (txTime - orderTime) / 3_600_000;
    if (diffHrs < -1 || diffHrs > windowHours) return false;
  }

  return true;
}

// ─── Atomic Claim Transaction ─────────────────────────────────────────────────

/**
 * حجز المعاملة atomically لطلب محدد.
 * يستخدم INSERT OR IGNORE + تحقق مزدوج لضمان idempotency.
 * يمنع نفس المعاملة من تأكيد طلبين.
 */
export async function claimTransactionForOrder(
  tx: NormalizedTransaction,
  orderId: string
): Promise<{ claimed: boolean; reason?: string }> {
  try {
    const db = await dbReady;

    // تحقق مزدوج: هل الـ fingerprint محجوز لطلب آخر؟
    const existing = await db.getFirstAsync<{ order_id: string; status: string }>(
      `SELECT order_id, status FROM processed_transactions WHERE transaction_id = ?`,
      [tx.transactionFingerprint]
    );

    if (existing) {
      if (existing.order_id === orderId) {
        // مرتبطة بنفس الطلب = idempotent OK
        return { claimed: true };
      }
      return {
        claimed: false,
        reason: `المعاملة مرتبطة بالطلب ${existing.order_id} بحالة ${existing.status}`,
      };
    }

    // حجز atomic
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT OR IGNORE INTO processed_transactions
         (transaction_id, provider, order_id, status, processed_at)
       VALUES (?, ?, ?, 'claimed', ?)`,
      [tx.transactionFingerprint, tx.providerId, orderId, now]
    );

    // للـ VF Cash: سجّل transactionId الخام أيضاً
    if (tx.providerId === 'vodafone_cash' && tx.transactionId !== tx.transactionFingerprint) {
      await db.runAsync(
        `INSERT OR IGNORE INTO processed_transactions
           (transaction_id, provider, order_id, status, processed_at)
         VALUES (?, ?, ?, 'claimed', ?)`,
        [tx.transactionId, tx.providerId, orderId, now]
      );
    }

    await logEvent('transaction_claimed',
      `${tx.transactionFingerprint} → الطلب ${orderId}`,
      { fingerprint: tx.transactionFingerprint, orderId }
    );

    return { claimed: true };
  } catch (err) {
    return { claimed: false, reason: err instanceof Error ? err.message : 'خطأ في الحجز' };
  }
}

/**
 * تسجيل المعاملة كمؤكدة بعد نجاح Backend sync.
 */
export async function finalizeTransactionConfirmation(
  tx: NormalizedTransaction,
  orderId: string
): Promise<void> {
  await markTransactionProcessed(
    tx.providerId,
    tx.transactionId,
    tx.amount,
    tx.receiverAccount ?? tx.receiverWallet ?? null,
    tx.transactionDateTime.slice(0, 10) || null,
    orderId
  );

  await logEvent('transaction_confirmed',
    `${tx.transactionFingerprint} للطلب ${orderId}`,
    { fingerprint: tx.transactionFingerprint, orderId, provider: tx.providerId }
  );
}

// ─── Audit Trail ─────────────────────────────────────────────────────────────

export type AuditTrailEntry = {
  orderId: string;
  providerId: string;
  source: string;
  parserVersion: string;
  transactionFingerprint: string;
  verificationResult: ProductionMatchCode;
  matchScore: number;
  timestamp: string;
  reason: string;
  finalAction: 'confirmed' | 'rejected' | 'review_required' | 'duplicate' | 'ignored';
};

export async function writeAuditTrail(entry: AuditTrailEntry): Promise<void> {
  // لا نسجل نص SMS الكامل في production logs — فقط البيانات الضرورية
  await logVerification(
    entry.orderId,
    'audit_trail',
    entry.finalAction,
    `${entry.verificationResult} | score=${entry.matchScore} | ${entry.reason}`,
    {
      provider: entry.providerId,
      source: entry.source,
      parserVersion: entry.parserVersion,
      fingerprint: entry.transactionFingerprint,
    } as any,
    entry.transactionFingerprint
  );
}

// ─── Query: Is Fingerprint Linked? ───────────────────────────────────────────

async function getTransactionLinkedOrder(fingerprint: string): Promise<string | null> {
  try {
    const db = await dbReady;
    const row = await db.getFirstAsync<{ order_id: string; status: string }>(
      `SELECT order_id, status FROM processed_transactions
       WHERE transaction_id = ? AND status IN ('claimed','confirmed')`,
      [fingerprint]
    );
    return row?.order_id ?? null;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function noMatchResult(
  code: ProductionMatchCode,
  score: number,
  reasons: string[],
  transaction: NormalizedTransaction | null
): ProductionMatchResult {
  return { code, score, reasons, canAutoConfirm: false, order: null, transaction };
}

async function logProductionEvent(
  code: ProductionMatchCode,
  tx: NormalizedTransaction,
  orderId: string | null,
  reason: string
): Promise<void> {
  await logEvent('production_match', `${code}: ${reason}`, {
    provider: tx.providerId,
    fingerprint: tx.transactionFingerprint,
    orderId,
    reason,
  }).catch(() => undefined);
}

function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb || na.slice(-10) === nb.slice(-10);
}

function normalizePhone(phone: string): string | null {
  let p = (phone ?? '').replace(/[\s\-()]/g, '');
  if (!p) return null;
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  if (p.startsWith('20') && p.length === 12) p = '0' + p.slice(2);
  return p;
}

function namesMatch(expected: string, actual: string): boolean {
  const e = normalizeName(expected);
  const a = normalizeName(actual);
  if (e === a) return true;
  const eWords = e.split(/\s+/).filter(Boolean);
  const aWords = a.split(/\s+/).filter(Boolean);
  if (eWords.length === 0 || aWords.length === 0) return false;
  const common = eWords.filter((w) => aWords.includes(w));
  return common.length >= Math.min(eWords.length, aWords.length) * 0.5;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, ' ').replace(/\s+/g, ' ').trim();
}
