/**
 * Verification Match Layer — طبقة مستقلة عن UI
 * ───────────────────────────────────────────────
 * تستقبل: Provider + ParsedTransaction + Order requirements
 * تُعيد: VerificationMatchResult (MATCH / PARTIAL_MATCH / NO_MATCH / ...)
 *
 * لا تُغيّر تنفيذ تأكيد الطلب الحالي في هذه المرحلة.
 * الهدف: عزل Parser عن Matcher + توحيد منطق المطابقة.
 */

import type { ProviderName } from '@/types/agent';
import type { ProviderParseResult } from '@/types/provider';
import { isTransactionDuplicate } from './duplicateProtection';

export type VerificationMatchCode =
  | 'MATCH'
  | 'PARTIAL_MATCH'
  | 'NO_MATCH'
  | 'INVALID_MESSAGE'
  | 'DUPLICATE'
  | 'UNSUPPORTED_SOURCE';

export type OrderRequirements = {
  provider: ProviderName | null;
  amount: number;
  /** تحمل المبلغ (نسبة مئوية) */
  amountTolerancePct?: number;
  expectedSenderPhone?: string | null;
  expectedSenderName?: string | null;
  expectedRecipientWallet?: string | null;
  expectedRecipientAccount?: string | null;
  createdAt?: string;
  /** نافذة البحث بالساعات */
  maxSearchWindowHours?: number;
};

export type VerificationMatchResult = {
  code: VerificationMatchCode;
  score: number;          // 0–100
  reasons: string[];
  /** هل يمكن التأكيد التلقائي؟ */
  canAutoConfirm: boolean;
};

/**
 * قارن معاملة مُحللة مع متطلبات طلب.
 * مستقل تماماً عن UI وعن matchingEngine الحالي.
 * لا يُعدّل سلوك matchingEngine — يُستخدم بالتوازي.
 */
export async function verifyTransactionAgainstOrder(
  parsed: ProviderParseResult,
  order: OrderRequirements
): Promise<VerificationMatchResult> {
  const reasons: string[] = [];

  // ─── 1. التحقق من transactionType ────────────────────────────────────────
  if (parsed.transactionType !== 'incoming_payment') {
    return {
      code: 'INVALID_MESSAGE',
      score: 0,
      reasons: [`نوع المعاملة غير صالح: ${parsed.transactionType ?? 'unknown'}`],
      canAutoConfirm: false,
    };
  }

  // ─── 2. التحقق من Provider ────────────────────────────────────────────────
  if (order.provider && parsed.provider !== order.provider) {
    return {
      code: 'UNSUPPORTED_SOURCE',
      score: 0,
      reasons: [`Provider غير متطابق: الرسالة من ${parsed.provider}، الطلب يتوقع ${order.provider}`],
      canAutoConfirm: false,
    };
  }

  // ─── 3. التحقق من المبلغ ─────────────────────────────────────────────────
  const tolerancePct = order.amountTolerancePct ?? 0;
  const toleranceAbs = order.amount * (tolerancePct / 100);
  const amountDiff = Math.abs(parsed.amount - order.amount);

  if (amountDiff > toleranceAbs) {
    return {
      code: 'NO_MATCH',
      score: 10,
      reasons: [`المبلغ غير متطابق: استُلم ${parsed.amount}، المتوقع ${order.amount}`],
      canAutoConfirm: false,
    };
  }
  let score = 50;
  if (amountDiff === 0) {
    score += 20;
    reasons.push('المبلغ متطابق تماماً');
  } else {
    reasons.push(`المبلغ ضمن نطاق التحمل (±${tolerancePct}%)`);
  }

  // ─── 4. التحقق من تكرار المعاملة ─────────────────────────────────────────
  const isDup = await isTransactionDuplicate(
    parsed.provider,
    parsed.transactionId,
    parsed.amount,
    parsed.recipientAccount ?? parsed.recipientWallet ?? null,
    parsed.transactionDate ?? null
  );
  if (isDup) {
    return {
      code: 'DUPLICATE',
      score: 0,
      reasons: ['معاملة مكررة — تم استخدام هذه المعاملة مسبقاً'],
      canAutoConfirm: false,
    };
  }

  // ─── 5. التحقق من رقم المُرسِل (Vodafone Cash) ──────────────────────────
  if (order.expectedSenderPhone && parsed.senderPhone) {
    const normExp = normalizePhone(order.expectedSenderPhone);
    const normGot = normalizePhone(parsed.senderPhone);
    if (normExp && normGot && normExp === normGot) {
      score += 15;
      reasons.push('رقم المُرسِل متطابق');
    } else {
      score -= 10;
      reasons.push('رقم المُرسِل مختلف');
    }
  }

  // ─── 6. التحقق من اسم المُرسِل ───────────────────────────────────────────
  if (order.expectedSenderName && parsed.senderName) {
    const normExp = order.expectedSenderName.trim().toLowerCase();
    const normGot = parsed.senderName.trim().toLowerCase();
    if (normExp === normGot || normGot.includes(normExp) || normExp.includes(normGot)) {
      score += 10;
      reasons.push('اسم المُرسِل متطابق');
    }
  }

  // ─── 7. التحقق من محفظة المستلم (Vodafone Cash) ─────────────────────────
  if (order.expectedRecipientWallet && parsed.recipientWallet) {
    if (normalizePhone(order.expectedRecipientWallet) === normalizePhone(parsed.recipientWallet)) {
      score += 10;
      reasons.push('محفظة المستلم متطابقة');
    }
  }

  // ─── 8. التحقق من حساب المستلم (InstaPay) ────────────────────────────────
  if (order.expectedRecipientAccount && parsed.recipientAccount) {
    const expLast4 = order.expectedRecipientAccount.slice(-4);
    const gotLast4 = parsed.recipientAccount.replace(/x/gi, '').slice(-4);
    if (expLast4 === gotLast4) {
      score += 10;
      reasons.push('حساب المستلم متطابق (آخر 4 أرقام)');
    }
  }

  // ─── 9. نافذة الوقت ───────────────────────────────────────────────────────
  if (order.createdAt && parsed.occurredAt) {
    const windowHrs = order.maxSearchWindowHours ?? 24;
    const orderTime = new Date(order.createdAt).getTime();
    const txTime = new Date(parsed.occurredAt).getTime();
    const diffHrs = (txTime - orderTime) / 3_600_000;
    if (diffHrs >= -1 && diffHrs <= windowHrs) {
      score += 5;
      reasons.push('الوقت ضمن النافذة المسموحة');
    } else {
      score -= 15;
      reasons.push(`المعاملة خارج نافذة البحث (${Math.round(diffHrs)} ساعة)`);
    }
  }

  score = Math.min(100, Math.max(0, score));

  if (score >= 80) {
    return { code: 'MATCH', score, reasons, canAutoConfirm: true };
  }
  if (score >= 50) {
    return { code: 'PARTIAL_MATCH', score, reasons, canAutoConfirm: false };
  }
  return { code: 'NO_MATCH', score, reasons, canAutoConfirm: false };
}

function normalizePhone(phone: string): string | null {
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p) return null;
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  if (p.startsWith('20') && p.length === 12) p = '0' + p.slice(2);
  return p;
}
