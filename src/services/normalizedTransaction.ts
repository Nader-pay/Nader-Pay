/**
 * normalizedTransaction.ts
 * ════════════════════════════════════════════════════════════════
 * Transaction Normalization — المرحلة الثانية
 *
 * تحوّل نتائج جميع Parsers إلى نموذج داخلي موحد.
 * الحقول غير الموجودة = null (لا قيم وهمية).
 *
 * أيضاً:
 *  - PaymentEvidence: دليل فردي (SMS أو Notification)
 *  - CanonicalTransaction: المعاملة الموحدة بعد ربط الأدلة
 * ════════════════════════════════════════════════════════════════
 */

import type { ProviderName } from '@/types/provider';
import type { ProviderParseResult } from '@/types/provider';
import { buildTransactionFingerprint } from './duplicateProtection';

// ─── النموذج الموحد للمعاملة ─────────────────────────────────────────────────

export type NormalizedTransaction = {
  /** معرّف العملية (من Parser أو fingerprint) */
  transactionId: string;
  /** Provider المُصدِر */
  providerId: ProviderName;
  /** نوع العملية — incoming_payment فقط مقبول */
  transactionType: 'incoming_payment' | 'unknown';
  /** المبلغ */
  amount: number;
  /** العملة */
  currency: string;
  /** رقم المُرسِل — null إذا لم يُذكر في الرسالة */
  senderPhone: string | null;
  /** اسم المُرسِل — null إذا لم يُذكر */
  senderName: string | null;
  /** حساب المستلم (InstaPay) */
  receiverAccount: string | null;
  /** محفظة المستلم (Vodafone Cash) */
  receiverWallet: string | null;
  /** الرصيد بعد العملية */
  balanceAfter: number | null;
  /** وقت العملية الفعلي (من نص الرسالة) */
  transactionDateTime: string;
  /** وقت وصول الرسالة للجهاز */
  messageReceivedAt: string;
  /** نوع المصدر: sms | notification */
  sourceType: 'sms' | 'notification';
  /** معرّف المصدر (رقم المرسل أو package identifier) */
  sourceIdentifier: string;
  /** نص الرسالة الأصلي */
  originalMessage: string;
  /** معرّف الـ Parser المستخدم */
  parserId: string;
  /** إصدار الـ Parser */
  parserVersion: string;
  /** Fingerprint حتمي للـ deduplication */
  transactionFingerprint: string;
  /** طريقة التحويل (InstaPay) */
  transferMethod: string | null;
};

// ─── Payment Evidence (دليل فردي) ─────────────────────────────────────────────

export type EvidenceType = 'sms' | 'notification';
export type EvidenceStatus = 'pending' | 'linked' | 'rejected' | 'insufficient';

export type PaymentEvidence = {
  /** معرّف فريد للدليل */
  evidenceId: string;
  /** نوع الدليل */
  evidenceType: EvidenceType;
  /** Provider المرتبط */
  providerId: ProviderName;
  /** المعاملة المُعيَّرة المستخرجة */
  normalized: NormalizedTransaction;
  /** وقت استلام الدليل */
  receivedAt: string;
  /** حالة الدليل */
  status: EvidenceStatus;
  /** معرّف Canonical Transaction المرتبطة (بعد الربط) */
  canonicalTransactionId: string | null;
  /** سبب الرفض إن وُجد */
  rejectReason: string | null;
};

// ─── Canonical Transaction (معاملة موحدة من أدلة متعددة) ─────────────────────

export type CanonicalTransaction = {
  /** معرّف الـ Canonical Transaction */
  canonicalId: string;
  /** Provider */
  providerId: ProviderName;
  /** المعاملة المُعيَّرة الأساسية */
  normalized: NormalizedTransaction;
  /** الأدلة المرتبطة */
  evidences: PaymentEvidence[];
  /** هل جاء SMS */
  hasSms: boolean;
  /** هل جاء Notification */
  hasNotification: boolean;
  /** هل الأدلة كافية للتحقق */
  isSufficient: boolean;
  /** وقت أول دليل وصل */
  firstEvidenceAt: string;
  /** الطلب المرتبط (بعد المطابقة) */
  matchedOrderId: string | null;
};

// ─── Normalize Parser Result → NormalizedTransaction ─────────────────────────

/**
 * تحوّل نتيجة Parser إلى NormalizedTransaction.
 * - لا تملأ حقولاً وهمية
 * - تُعيَّن transactionDateTime و messageReceivedAt بشكل صحيح
 */
export function normalizeParseResult(
  parsed: ProviderParseResult,
  sourceType: 'sms' | 'notification',
  sourceIdentifier: string,
  messageReceivedAt?: string
): NormalizedTransaction {
  const now = new Date().toISOString();
  const fingerprint = buildTransactionFingerprint(
    parsed.provider,
    parsed.transactionId,
    parsed.amount,
    parsed.recipientAccount ?? parsed.recipientWallet ?? null,
    parsed.transactionDate ?? null
  );

  return {
    transactionId: parsed.transactionId,
    providerId: parsed.provider,
    transactionType: parsed.transactionType ?? 'unknown',
    amount: parsed.amount,
    currency: parsed.currency ?? 'EGP',
    senderPhone: parsed.senderPhone ?? null,
    senderName: parsed.senderName ?? null,
    receiverAccount: parsed.recipientAccount ?? null,
    receiverWallet: parsed.recipientWallet ?? null,
    balanceAfter: parsed.balanceAfterTransaction ?? null,
    // transactionDateTime: من الرسالة إذا كانت متاحة
    transactionDateTime: parsed.transactionDate
      ? normalizeDateString(parsed.transactionDate)
      : (parsed.occurredAt || now),
    // messageReceivedAt: وقت الاستلام الفعلي — مستقل عن وقت العملية
    messageReceivedAt: messageReceivedAt ?? parsed.messageReceivedAt ?? now,
    sourceType,
    sourceIdentifier,
    originalMessage: parsed.rawMessage,
    parserId: parsed.parserId,
    parserVersion: parsed.parserVersion,
    transactionFingerprint: fingerprint,
    transferMethod: parsed.transferMethod ?? null,
  };
}

// ─── Evidence Builder ─────────────────────────────────────────────────────────

export function buildPaymentEvidence(
  normalized: NormalizedTransaction,
  evidenceType: EvidenceType,
  evidenceId?: string
): PaymentEvidence {
  const id = evidenceId ?? `ev:${normalized.providerId}:${normalized.transactionFingerprint}:${Date.now()}`;
  return {
    evidenceId: id,
    evidenceType,
    providerId: normalized.providerId,
    normalized,
    receivedAt: new Date().toISOString(),
    status: 'pending',
    canonicalTransactionId: null,
    rejectReason: null,
  };
}

// ─── SMS + Notification Correlation ──────────────────────────────────────────

/**
 * ربط SMS و Notification كـ Canonical Transaction.
 *
 * منطق الربط:
 * - نفس المبلغ ± تسامح صغير
 * - نفس Provider
 * - نفس حساب/محفظة المستلم (آخر 4 أرقام على الأقل)
 * - نافذة زمنية متقاربة (افتراضي: 30 دقيقة)
 *
 * إذا لم يمكن الربط بدرجة كافية → لا دمج تخميني.
 */
export function correlateEvidences(
  evidenceA: PaymentEvidence,
  evidenceB: PaymentEvidence,
  options: { timeWindowMinutes?: number; amountTolerancePct?: number } = {}
): { canLink: boolean; confidence: number; reason: string } {
  const { timeWindowMinutes = 30, amountTolerancePct = 0.5 } = options;

  const a = evidenceA.normalized;
  const b = evidenceB.normalized;

  // Provider يجب أن يكون متطابقاً
  if (a.providerId !== b.providerId) {
    return { canLink: false, confidence: 0, reason: 'Provider مختلف' };
  }

  // المبلغ
  const tolerance = Math.max(0.01, a.amount * (amountTolerancePct / 100));
  if (Math.abs(a.amount - b.amount) > tolerance) {
    return { canLink: false, confidence: 0, reason: `مبلغ مختلف: ${a.amount} vs ${b.amount}` };
  }

  let confidence = 50; // بداية بالمبلغ المتطابق

  // حساب المستلم (InstaPay)
  const aAccount = a.receiverAccount?.replace(/x/gi, '').slice(-4);
  const bAccount = b.receiverAccount?.replace(/x/gi, '').slice(-4);
  if (aAccount && bAccount) {
    if (aAccount === bAccount) {
      confidence += 30;
    } else {
      return { canLink: false, confidence: 0, reason: `حساب مستلم مختلف: ${aAccount} vs ${bAccount}` };
    }
  }

  // محفظة المستلم (VF Cash)
  const aWallet = normalizePhoneForCorrelation(a.receiverWallet ?? '');
  const bWallet = normalizePhoneForCorrelation(b.receiverWallet ?? '');
  if (aWallet && bWallet) {
    if (aWallet.slice(-10) === bWallet.slice(-10)) {
      confidence += 30;
    } else {
      return { canLink: false, confidence: 0, reason: `محفظة مستلم مختلفة` };
    }
  }

  // نافذة زمنية
  const tA = new Date(a.transactionDateTime).getTime();
  const tB = new Date(b.transactionDateTime).getTime();
  if (!Number.isNaN(tA) && !Number.isNaN(tB)) {
    const diffMinutes = Math.abs(tA - tB) / 60_000;
    if (diffMinutes > timeWindowMinutes) {
      return { canLink: false, confidence: 0, reason: `فارق زمني كبير: ${Math.round(diffMinutes)} دقيقة` };
    }
    confidence += 10;
  }

  return {
    canLink: confidence >= 60,
    confidence,
    reason: confidence >= 60 ? 'تطابق كافٍ للربط' : 'ثقة غير كافية للربط',
  };
}

/**
 * إنشاء Canonical Transaction من دليل أولي أو من دليلين مترابطين.
 */
export function buildCanonicalTransaction(
  primaryEvidence: PaymentEvidence,
  secondaryEvidence?: PaymentEvidence
): CanonicalTransaction {
  const canonicalId = `ct:${primaryEvidence.normalized.transactionFingerprint}`;
  const evidences: PaymentEvidence[] = [primaryEvidence];
  if (secondaryEvidence) evidences.push(secondaryEvidence);

  const hasSms = evidences.some((e) => e.evidenceType === 'sms');
  const hasNotification = evidences.some((e) => e.evidenceType === 'notification');

  // كافٍ = SMS موثق أو Notification + SMS مترابطان
  const isSufficient =
    hasSms ||
    (hasNotification && evidences.length >= 1 && primaryEvidence.providerId !== 'insta_pay') ||
    (hasNotification && hasSms);

  return {
    canonicalId,
    providerId: primaryEvidence.normalized.providerId,
    normalized: primaryEvidence.normalized,
    evidences,
    hasSms,
    hasNotification,
    isSufficient,
    firstEvidenceAt: primaryEvidence.receivedAt,
    matchedOrderId: null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeDateString(date: string): string {
  if (!date) return new Date().toISOString();
  // yyyy-mm-dd → ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return `${date}T00:00:00.000Z`;
  }
  // dd/mm/yyyy
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
    const [d, m, y] = date.split('/');
    return `${y}-${m}-${d}T00:00:00.000Z`;
  }
  // محاولة parse مباشر
  const t = new Date(date).getTime();
  return Number.isNaN(t) ? new Date().toISOString() : new Date(date).toISOString();
}

function normalizePhoneForCorrelation(phone: string): string {
  let p = (phone ?? '').replace(/[\s\-()]/g, '');
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  if (p.startsWith('20') && p.length === 12) p = '0' + p.slice(2);
  return p;
}
