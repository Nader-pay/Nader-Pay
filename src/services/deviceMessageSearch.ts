/**
 * Device Message Search Service
 * ───────────────────────────────
 * البحث في رسائل الهاتف عن معاملة مطابقة باستخدام identifiers المتاحة.
 * يدعم البحث التدريجي: يبدأ بأقوى identifier ثم يتوسع تدريجياً.
 * لا يُعدّل الرسالة الأصلية — يُعيدها كما وصلت.
 */

import type { ProviderName } from '@/types/agent';
import type { ProviderParseResult } from '@/types/provider';
import { readExistingPaymentMessages } from './smsReader';

export type DeviceMessageMatch = {
  /** الرسالة الأصلية كما وصلت بدون تعديل */
  originalBody: string;
  /** المُرسِل / المصدر */
  sender: string;
  /** وقت وصول الرسالة */
  receivedAt: string;
  /** وقت العملية المستخرج من النص */
  transactionOccurredAt: string | null;
  /** المعاملة المُحللة */
  parsedTransaction: ProviderParseResult;
  /** مدى قوة التطابق */
  matchStrength: 'exact' | 'strong' | 'partial';
  /** الأسباب التي أدت للتطابق */
  matchReasons: string[];
};

export type DeviceSearchOptions = {
  provider: ProviderName;
  parsed: ProviderParseResult;
  /** الحد الأقصى للرسائل المقروءة */
  maxMessages?: number;
};

/**
 * ابحث في رسائل الهاتف عن معاملة تطابق الـ parsed transaction.
 * ترتيب البحث التدريجي:
 *   Vodafone Cash: transactionId → senderPhone → amount+senderPhone → amount+senderName → amount+wallet
 *   InstaPay:      amount+account+date → amount+date → amount+transferMethod
 */
export async function searchDeviceMessages(
  opts: DeviceSearchOptions
): Promise<DeviceMessageMatch[]> {
  if (process.env.EXPO_OS !== 'android') return [];

  const messages = await readExistingPaymentMessages(opts.maxMessages ?? 200);
  const { parseMessage } = await import('./providers');
  const results: DeviceMessageMatch[] = [];

  for (const msg of messages) {
    const reparsed = parseMessage(msg.body);
    if (!reparsed) continue;
    if (reparsed.provider !== opts.provider) continue;

    const strength = computeMatchStrength(opts.parsed, reparsed, opts.provider);
    if (!strength) continue;

    results.push({
      originalBody: msg.body,
      sender: msg.originatingAddress,
      receivedAt: msg.date,
      transactionOccurredAt: reparsed.occurredAt,
      parsedTransaction: reparsed,
      matchStrength: strength.level,
      matchReasons: strength.reasons,
    });
  }

  // رتّب: exact أولاً ثم strong ثم partial
  const order = { exact: 0, strong: 1, partial: 2 };
  return results.sort((a, b) => order[a.matchStrength] - order[b.matchStrength]);
}

function computeMatchStrength(
  target: ProviderParseResult,
  candidate: ProviderParseResult,
  provider: ProviderName
): { level: 'exact' | 'strong' | 'partial'; reasons: string[] } | null {
  const reasons: string[] = [];
  let score = 0;

  if (provider === 'vodafone_cash') {
    // transactionId — أقوى identifier
    if (
      target.transactionId &&
      candidate.transactionId &&
      target.transactionId === candidate.transactionId
    ) {
      return { level: 'exact', reasons: ['رقم العملية متطابق تماماً'] };
    }
    // senderPhone + amount
    if (target.senderPhone && candidate.senderPhone && target.senderPhone === candidate.senderPhone) {
      score += 40;
      reasons.push('رقم المُرسِل متطابق');
    }
    if (target.amount === candidate.amount) {
      score += 30;
      reasons.push('المبلغ متطابق');
    }
    if (target.senderName && candidate.senderName) {
      const n1 = target.senderName.trim().toLowerCase();
      const n2 = candidate.senderName.trim().toLowerCase();
      if (n1 === n2 || n1.includes(n2) || n2.includes(n1)) {
        score += 20;
        reasons.push('اسم المُرسِل متطابق');
      }
    }
    if (target.recipientWallet && candidate.recipientWallet && target.recipientWallet === candidate.recipientWallet) {
      score += 10;
      reasons.push('محفظة المستلم متطابقة');
    }
    if (score >= 70) return { level: 'strong', reasons };
    if (score >= 30) return { level: 'partial', reasons };
    return null;
  }

  if (provider === 'insta_pay') {
    // amount + receiverAccount + date — الثلاثة معاً = exact
    const amtMatch = target.amount === candidate.amount;
    const accMatch =
      target.recipientAccount &&
      candidate.recipientAccount &&
      target.recipientAccount.slice(-4) === candidate.recipientAccount.replace(/x/gi, '').slice(-4);
    const dateMatch =
      target.transactionDate &&
      candidate.transactionDate &&
      target.transactionDate === candidate.transactionDate;

    if (amtMatch && accMatch && dateMatch) {
      return { level: 'exact', reasons: ['المبلغ + الحساب + التاريخ متطابقة'] };
    }
    if (amtMatch) { score += 40; reasons.push('المبلغ متطابق'); }
    if (accMatch)  { score += 35; reasons.push('آخر 4 أرقام الحساب متطابقة'); }
    if (dateMatch) { score += 25; reasons.push('تاريخ العملية متطابق'); }

    if (score >= 75) return { level: 'strong', reasons };
    if (score >= 40) return { level: 'partial', reasons };
    return null;
  }

  // بقية الـ providers
  if (target.transactionId && candidate.transactionId && target.transactionId === candidate.transactionId) {
    return { level: 'exact', reasons: ['رقم العملية متطابق'] };
  }
  if (target.amount === candidate.amount) {
    return { level: 'partial', reasons: ['المبلغ متطابق'] };
  }
  return null;
}
