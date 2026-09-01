import type { ProviderParseResult } from '@/types/provider';

// ─────────────────────────────────────────────────────────────────────────────
// Vodafone Cash Parser — v2
// مخصص فقط لرسائل Vodafone Cash التي تمثل استلام أموال.
// صارم: يرفض رسائل الرصيد وحده / العروض / أي رسالة لا تحتوي على معرّف عملية.
// ─────────────────────────────────────────────────────────────────────────────

export const VF_CASH_PARSER_ID = 'vodafone-cash-incoming-v2';
export const VF_CASH_PARSER_VERSION = '2.0.0';

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;

function normalizeArabic(text: string): string {
  return text
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u200B-\u200F]/g, '')
    .trim();
}

function normalizeMessage(body: string): string {
  return body.replace(/\s+/g, ' ').replace(/[\u200B-\u200F]/g, '').trim();
}

function normalizePhone(phone: string): string | null {
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p) return null;
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  if (p.startsWith('20') && p.length === 12) p = '0' + p.slice(2);
  if (!/^0\d{9,10}$/.test(p)) return null;
  return p;
}

function toEnDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

function parseOccurredAt(dateText: string | null): string | null {
  if (!dateText) return null;
  const norm = toEnDigits(dateText);
  const match = norm.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (!match) return null;
  const [, hours, minutes, , day, month, year] = match;
  let fullYear = parseInt(year, 10);
  if (fullYear < 100) fullYear += 2000;
  const date = new Date(
    fullYear,
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hours, 10),
    parseInt(minutes, 10)
  );
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** هل تبدو الرسالة من Vodafone Cash؟ */
export function looksLikeVodafoneCashSms(body: string): boolean {
  const norm = normalizeArabic(body);
  const lower = body.toLowerCase();
  return (
    lower.includes('vodafone cash') ||
    lower.includes('vodafonecash') ||
    norm.includes('فودافون كاش') ||
    norm.includes('محفظة فودافون') ||
    norm.includes('محفظتك')
  );
}

/**
 * ─── فلتر صارم: لا تعتبر الرسالة payment إلا إذا كانت "استلام أموال" ───────
 * يرفض:
 *  - رسائل الرصيد الحالي فقط (بدون "تم استلام")
 *  - رسائل العروض والتسويق
 *  - رسائل إشعار الإرسال (sent) لا الاستلام (received)
 */
function isIncomingPaymentMessage(body: string, norm: string): boolean {
  const normLower = norm.toLowerCase();

  // يجب أن تحتوي على كلمة "تم استلام" أو ما يعادلها
  if (!norm.includes('تم استلام') && !normLower.includes('received')) {
    return false;
  }

  // رفض رسائل الرصيد وحدها
  if (
    (norm.includes('رصيدك') || norm.includes('رصيد')) &&
    !norm.includes('تم استلام')
  ) {
    return false;
  }

  // رفض رسائل العروض والتسويق
  const promoKeywords = ['عرض', 'احصل على', 'خصم', 'مجانا', 'مجاناً', 'دوشجي', 'استمتع', 'ادفع'];
  if (promoKeywords.some((k) => norm.includes(k)) && !norm.includes('تم استلام')) {
    return false;
  }

  // رفض رسائل إرسال الأموال (sent)
  if (norm.includes('تم ارسال') || norm.includes('تم إرسال') || norm.includes('قمت بتحويل')) {
    return false;
  }

  return true;
}

/**
 * Parse رسالة Vodafone Cash — مخصص لرسائل استلام الأموال فقط.
 *
 * نموذج صالح:
 *   "تم استلام مبلغ 400 جنيه من رقم 01030951228 المسجل بإسم Wessam A Ahmed Ali
 *    على رقم محفظتك 01097273680.
 *    رصيدك الحالي: 84324.60 جنيه
 *    تاريخ العملية: 00:15 26-08-21
 *    رقم العملية: 022896233255"
 */
export function parseVodafoneCashSms(message: string): ProviderParseResult | null {
  const body = message.trim();
  if (!looksLikeVodafoneCashSms(body)) return null;

  const normalized = normalizeArabic(toEnDigits(body));

  // ─── فلتر صارم: استلام أموال فقط ────────────────────────────────────────
  if (!isIncomingPaymentMessage(body, normalized)) return null;

  // ─── المبلغ ──────────────────────────────────────────────────────────────
  const amountMatch = normalized.match(
    /(?:تم\s+استلام\s+مبلغ|استلام\s+مبلغ|مبلغ\s+قدره|مبلغ)\s+([\d,]+(?:\.\d+)?)/i
  );
  if (!amountMatch) return null;
  const amount = parseFloat(toEnDigits(amountMatch[1]).replace(/,/g, ''));
  if (isNaN(amount) || amount <= 0) return null;

  // ─── رقم العملية (مطلوب) ─────────────────────────────────────────────────
  const transactionIdMatch = normalized.match(
    /(?:رقم\s+(?:العملية|المعاملة)|Transaction\s*(?:ID|No))\s*[:\s]\s*([0-9]{6,})/i
  );
  if (!transactionIdMatch) return null;
  const transactionId = toEnDigits(transactionIdMatch[1]).trim();

  // ─── رقم المُرسِل ─────────────────────────────────────────────────────────
  const senderPhoneRaw = normalized.match(
    /(?:من\s+رقم|من)\s+([0-9+\s().-]{7,})/
  );
  const senderPhone = senderPhoneRaw
    ? normalizePhone(toEnDigits(senderPhoneRaw[1]))
    : null;

  // ─── اسم المُرسِل ─────────────────────────────────────────────────────────
  const senderNameMatch = normalized.match(
    /(?:المسجل\s+(?:بإسم|باسم|بإسم)|بإسم|باسم)\s+([^\n.،,\d][^\n.،,]{1,60})/
  );
  const senderName = senderNameMatch ? senderNameMatch[1].trim() : null;

  // ─── محفظة المستلم ────────────────────────────────────────────────────────
  const recipientWalletMatch = normalized.match(
    /(?:على\s+رقم\s+محفظتك|محفظتك|رقم\s+المحفظة)\s+([0-9+\s().-]{7,})/
  );
  const recipientWallet = recipientWalletMatch
    ? normalizePhone(toEnDigits(recipientWalletMatch[1]))
    : null;

  // ─── الرصيد بعد العملية ───────────────────────────────────────────────────
  const balanceMatch = normalized.match(
    /(?:رصيدك\s+الحالي|الرصيد)\s*[:\s]\s*([\d,]+(?:\.\d+)?)/i
  );
  const balanceAfterTransaction = balanceMatch
    ? parseFloat(toEnDigits(balanceMatch[1]).replace(/,/g, ''))
    : null;

  // ─── تاريخ/وقت العملية ───────────────────────────────────────────────────
  const dateMatch = normalized.match(
    /(?:تاريخ\s+(?:العملية|المعاملة)|التاريخ)\s*[:\s]\s*([\d]{1,2}[:\d]{2,4}\s+[\d]{1,2}[\/-][\d]{1,2}[\/-][\d]{2,4})/
  );
  const occurredAt = parseOccurredAt(dateMatch ? dateMatch[1] : null) ?? new Date().toISOString();

  return {
    provider: 'vodafone_cash',
    transactionId,
    transactionType: 'incoming_payment',
    amount,
    currency: 'EGP',
    senderPhone,
    senderName,
    recipientWallet,
    recipientAccount: null,
    balanceAfterTransaction: balanceAfterTransaction ?? null,
    transactionDate: occurredAt.slice(0, 10),
    transferMethod: null,
    occurredAt,
    rawMessage: body,
    normalizedMessage: normalizeMessage(body),
    sourceVerification: 'unverified',
    parserId: VF_CASH_PARSER_ID,
    parserVersion: VF_CASH_PARSER_VERSION,
    messageSource: null,
    messageReceivedAt: null,
  };
}
