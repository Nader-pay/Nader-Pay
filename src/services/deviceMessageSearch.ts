/**
 * Device Message Search Service
 * ───────────────────────────────
 * البحث في رسائل الهاتف الحقيقية عن معاملة مطابقة.
 *
 * يدعم 3 طرق بحث مستقلة:
 *  1. searchByTransactionId — رقم العملية (أقوى identifier)
 *  2. searchBySenderPhone   — رقم الهاتف الذي أرسل الأموال
 *  3. searchByParsedResult  — بحث تدريجي من parsed transaction
 *
 * يقرأ من Trusted Source أولاً، ثم كل الرسائل إذا لم يجد.
 * لا يعتبر نتيجة ناجحة إلا بعد Parse + Validate.
 */

import type { ProviderName } from '@/types/agent';
import type { ProviderParseResult } from '@/types/provider';
import { readMessagesFromSources, readExistingPaymentMessages } from './smsReader';
import type { SmsMessage } from '@/types/agent';

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
  /** Trusted Source identifier — يُقيّد البحث عليه أولاً */
  trustedSourceId?: string | null;
  /** الحد الأقصى للرسائل المقروءة */
  maxMessages?: number;
};

export type TxIdSearchOptions = {
  provider: ProviderName;
  transactionId: string;
  trustedSourceId?: string | null;
  maxMessages?: number;
};

export type PhoneSearchOptions = {
  provider: ProviderName;
  senderPhone: string;
  trustedSourceId?: string | null;
  maxMessages?: number;
};

export type TxIdSearchResult = {
  found: boolean;
  status: 'EXACT_MATCH' | 'INVALID_PAYMENT_MESSAGE' | 'NO_MATCH' | 'INSUFFICIENT_EVIDENCE';
  match?: DeviceMessageMatch;
  reason?: string;
};

export type PhoneSearchResult = {
  found: boolean;
  status: 'FOUND' | 'NO_MATCH' | 'NO_INCOMING_PAYMENT';
  matches: DeviceMessageMatch[];
  reason?: string;
};

// ─── قراءة الرسائل مع تقديم Trusted Source ─────────────────────────────────

async function loadMessages(
  trustedSourceId: string | null | undefined,
  maxCount: number
): Promise<SmsMessage[]> {
  if (trustedSourceId) {
    try {
      const msgs = await readMessagesFromSources([trustedSourceId], maxCount);
      if (msgs.length > 0) return msgs;
    } catch { /* fallback */ }
  }
  return readExistingPaymentMessages(maxCount);
}

// ─── 1. البحث برقم العملية ───────────────────────────────────────────────────

/**
 * البحث برقم العملية (Transaction ID).
 * يبحث في Trusted Source أولاً.
 * يُعيد EXACT_MATCH فقط إذا Parse الرسالة وثبت أنها Incoming Payment.
 */
export async function searchByTransactionId(
  opts: TxIdSearchOptions
): Promise<TxIdSearchResult> {
  if (process.env.EXPO_OS !== 'android') {
    return { found: false, status: 'NO_MATCH', reason: 'البحث متاح على Android فقط' };
  }
  const txId = opts.transactionId.trim();
  if (!txId) return { found: false, status: 'NO_MATCH', reason: 'رقم العملية فارغ' };

  const messages = await loadMessages(opts.trustedSourceId, opts.maxMessages ?? 300);
  const { parseMessage } = await import('./providers');

  for (const msg of messages) {
    if (!msg.body.includes(txId)) continue;

    // وُجدت رسالة تحتوي على الرقم — يجب Parse + Validate
    const reparsed = parseMessage(msg.body);
    if (!reparsed) {
      return {
        found: false,
        status: 'INVALID_PAYMENT_MESSAGE',
        reason: 'الرسالة تحتوي على رقم العملية لكن لا يمكن تحليلها كـ Incoming Payment',
      };
    }
    if (reparsed.provider !== opts.provider) {
      return {
        found: false,
        status: 'INVALID_PAYMENT_MESSAGE',
        reason: `الرسالة لـ Provider مختلف: ${reparsed.provider}`,
      };
    }
    if (reparsed.transactionType !== 'incoming_payment') {
      return {
        found: false,
        status: 'INSUFFICIENT_EVIDENCE',
        reason: `الرسالة موجودة لكنها ليست Incoming Payment (النوع: ${reparsed.transactionType})`,
      };
    }
    if (reparsed.transactionId !== txId) {
      return {
        found: false,
        status: 'INSUFFICIENT_EVIDENCE',
        reason: `رقم العملية المستخرج (${reparsed.transactionId}) لا يطابق المطلوب (${txId})`,
      };
    }
    return {
      found: true,
      status: 'EXACT_MATCH',
      match: {
        originalBody: msg.body,
        sender: msg.originatingAddress,
        receivedAt: msg.date,
        transactionOccurredAt: reparsed.occurredAt,
        parsedTransaction: reparsed,
        matchStrength: 'exact',
        matchReasons: ['رقم العملية متطابق تماماً', 'رسالة Incoming Payment صالحة'],
      },
    };
  }

  return { found: false, status: 'NO_MATCH', reason: `لم يُعثر على رقم العملية ${txId} في رسائل الهاتف` };
}

// ─── 2. البحث برقم الهاتف ────────────────────────────────────────────────────

/**
 * البحث برقم الهاتف الذي أرسل الأموال.
 * يُعيد كل Incoming Payments من هذا الرقم.
 * يُشغّل Parser على كل مرشح — لا text search فقط.
 */
export async function searchBySenderPhone(
  opts: PhoneSearchOptions
): Promise<PhoneSearchResult> {
  if (process.env.EXPO_OS !== 'android') {
    return { found: false, status: 'NO_MATCH', matches: [], reason: 'البحث متاح على Android فقط' };
  }
  const phone = normalizePhone(opts.senderPhone.trim());
  if (!phone) {
    return { found: false, status: 'NO_MATCH', matches: [], reason: 'رقم الهاتف غير صالح' };
  }

  const messages = await loadMessages(opts.trustedSourceId, opts.maxMessages ?? 300);
  const { parseMessage } = await import('./providers');
  const matches: DeviceMessageMatch[] = [];

  for (const msg of messages) {
    // فلترة مبدئية: الرسالة يجب أن تحتوي على جزء من الرقم
    if (!msg.body.includes(phone.slice(-8))) continue;

    const reparsed = parseMessage(msg.body);
    if (!reparsed) continue;
    if (reparsed.provider !== opts.provider) continue;
    if (reparsed.transactionType !== 'incoming_payment') continue;

    const parsedPhone = reparsed.senderPhone;
    if (!parsedPhone) continue;
    if (!phonesMatch(parsedPhone, phone)) continue;

    matches.push({
      originalBody: msg.body,
      sender: msg.originatingAddress,
      receivedAt: msg.date,
      transactionOccurredAt: reparsed.occurredAt,
      parsedTransaction: reparsed,
      matchStrength: 'exact',
      matchReasons: [`رقم الهاتف ${phone} متطابق`, 'رسالة Incoming Payment صالحة'],
    });
  }

  if (matches.length === 0) {
    // هل يوجد رسائل تحتوي الرقم لكن ليست Incoming Payment؟
    const hasPhone = messages.some((m) => m.body.includes(phone.slice(-8)));
    return {
      found: false,
      status: hasPhone ? 'NO_INCOMING_PAYMENT' : 'NO_MATCH',
      matches: [],
      reason: hasPhone
        ? `يوجد رسائل من ${phone} لكن لا Incoming Payment فيها`
        : `لم يُعثر على رسائل من ${phone}`,
    };
  }

  // ترتيب: الأحدث أولاً
  matches.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  return { found: true, status: 'FOUND', matches };
}

// ─── 3. البحث من parsed transaction (الطريقة الأصلية) ──────────────────────

/**
 * البحث التدريجي من نتيجة Parse.
 * Vodafone: transactionId → senderPhone → amount+phone → amount+wallet
 * InstaPay: amount+account+date → amount+date
 */
export async function searchDeviceMessages(
  opts: DeviceSearchOptions
): Promise<DeviceMessageMatch[]> {
  if (process.env.EXPO_OS !== 'android') return [];

  const messages = await loadMessages(opts.trustedSourceId, opts.maxMessages ?? 200);
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

  const order = { exact: 0, strong: 1, partial: 2 };
  return results.sort((a, b) => order[a.matchStrength] - order[b.matchStrength]);
}

// ─── Match Strength ──────────────────────────────────────────────────────────

function computeMatchStrength(
  target: ProviderParseResult,
  candidate: ProviderParseResult,
  provider: ProviderName
): { level: 'exact' | 'strong' | 'partial'; reasons: string[] } | null {
  const reasons: string[] = [];
  let score = 0;

  if (provider === 'vodafone_cash') {
    if (target.transactionId && candidate.transactionId && target.transactionId === candidate.transactionId) {
      return { level: 'exact', reasons: ['رقم العملية متطابق تماماً'] };
    }
    if (target.senderPhone && candidate.senderPhone && phonesMatch(target.senderPhone, candidate.senderPhone)) {
      score += 40; reasons.push('رقم المُرسِل متطابق');
    }
    if (target.amount === candidate.amount) { score += 30; reasons.push('المبلغ متطابق'); }
    if (target.senderName && candidate.senderName) {
      const n1 = target.senderName.trim().toLowerCase();
      const n2 = candidate.senderName.trim().toLowerCase();
      if (n1 === n2 || n1.includes(n2) || n2.includes(n1)) { score += 20; reasons.push('اسم المُرسِل متطابق'); }
    }
    if (target.recipientWallet && candidate.recipientWallet && target.recipientWallet === candidate.recipientWallet) {
      score += 10; reasons.push('محفظة المستلم متطابقة');
    }
    if (score >= 70) return { level: 'strong', reasons };
    if (score >= 30) return { level: 'partial', reasons };
    return null;
  }

  if (provider === 'insta_pay') {
    const amtMatch = target.amount === candidate.amount;
    const accMatch = target.recipientAccount && candidate.recipientAccount &&
      target.recipientAccount.slice(-4) === candidate.recipientAccount.replace(/x/gi, '').slice(-4);
    const dateMatch = target.transactionDate && candidate.transactionDate &&
      target.transactionDate === candidate.transactionDate;

    if (amtMatch && accMatch && dateMatch) return { level: 'exact', reasons: ['المبلغ + الحساب + التاريخ متطابقة'] };
    if (amtMatch) { score += 40; reasons.push('المبلغ متطابق'); }
    if (accMatch) { score += 35; reasons.push('آخر 4 أرقام الحساب متطابقة'); }
    if (dateMatch) { score += 25; reasons.push('تاريخ العملية متطابق'); }
    if (score >= 75) return { level: 'strong', reasons };
    if (score >= 40) return { level: 'partial', reasons };
    return null;
  }

  if (target.transactionId && candidate.transactionId && target.transactionId === candidate.transactionId) {
    return { level: 'exact', reasons: ['رقم العملية متطابق'] };
  }
  if (target.amount === candidate.amount) return { level: 'partial', reasons: ['المبلغ متطابق'] };
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizePhone(phone: string): string | null {
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p) return null;
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  if (p.startsWith('20') && p.length === 12) p = '0' + p.slice(2);
  if (!/^0\d{9,10}$/.test(p)) return null;
  return p;
}

function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb || na.slice(-8) === nb.slice(-8);
}



