import type { ProviderParseResult } from '@/types/provider';

// ─────────────────────────────────────────────────────────────────────────────
// InstaPay / Banque Misr Parser — v2
// مستقل تماماً عن Vodafone Cash Parser.
// يدعم رسائل Banque Misr التي لا تحتوي على transactionId ولا senderPhone.
// ─────────────────────────────────────────────────────────────────────────────

export const INSTAPAY_PARSER_ID = 'instapay-banquemisr-v2';
export const INSTAPAY_PARSER_VERSION = '2.0.0';

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

/** تحويل الأرقام العربية/الإنجليزية إلى إنجليزية */
function toEnDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/** تحليل تاريخ من نمط dd-MMM-yyyy أو dd/mm/yyyy */
function parseInstaPayDate(text: string): string | null {
  const norm = toEnDigits(text.trim());

  // نمط: 13-AUG-2026 أو 13-Aug-26
  const engMatch = norm.match(/(\d{1,2})[\-\/]([A-Za-z]{3})[\-\/](\d{2,4})/);
  if (engMatch) {
    const MONTHS: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const day = parseInt(engMatch[1], 10);
    const mon = MONTHS[engMatch[2].toLowerCase()];
    let year = parseInt(engMatch[3], 10);
    if (year < 100) year += 2000;
    if (mon === undefined) return null;
    // استخدام Date.UTC لتجنب timezone offset
    const ts = Date.UTC(year, mon, day);
    if (isNaN(ts)) return null;
    return new Date(ts).toISOString().slice(0, 10);
  }

  // نمط: dd/mm/yyyy أو dd-mm-yyyy
  const numMatch = norm.match(/(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{2,4})/);
  if (numMatch) {
    let year = parseInt(numMatch[3], 10);
    if (year < 100) year += 2000;
    // استخدام Date.UTC لتجنب timezone offset
    const ts = Date.UTC(year, parseInt(numMatch[2], 10) - 1, parseInt(numMatch[1], 10));
    if (isNaN(ts)) return null;
    return new Date(ts).toISOString().slice(0, 10);
  }

  return null;
}

/**
 * هل تبدو الرسالة من InstaPay أو Banque Misr (تحويل لحظي)؟
 * لا تُطابق رسائل Vodafone Cash أو OrangeCash.
 */
export function looksLikeInstaPaySms(body: string): boolean {
  const lower = body.toLowerCase();
  const norm = normalizeArabic(body);
  return (
    lower.includes('instapay') ||
    lower.includes('instant') ||
    norm.includes('اضافة مبلغ') ||
    norm.includes('التحويل اللحظي') ||
    norm.includes('تحويل لحظي') ||
    norm.includes('banque misr') ||
    norm.includes('بنك مصر') ||
    lower.includes('ipn')
  );
}

/**
 * Parse رسالة InstaPay / Banque Misr.
 *
 * نموذج رسالة:
 *   "تم اضافة مبلغ 300EGP الى حساب رقم xxx4449 فى 13-AUG-2026 عن طريق التحويل اللحظي"
 *
 * لا يبحث عن senderPhone أو senderName لأن هذا النوع من الرسائل لا يوفرهما.
 * يُنتج fingerprint محدد من amount + receiverAccount + date.
 */
export function parseInstaPaySms(message: string): ProviderParseResult | null {
  const body = message.trim();
  if (!looksLikeInstaPaySms(body)) return null;

  // ─── استبعاد رسائل العروض والتسويق ─────────────────────────────────────
  const lowerBody = body.toLowerCase();
  if (
    lowerBody.includes('عرض') && !lowerBody.includes('اضافة') ||
    lowerBody.includes('احصل على') ||
    lowerBody.includes('خصم') ||
    lowerBody.includes('مجاناً') ||
    lowerBody.includes('مجانا')
  ) {
    return null;
  }

  const norm = normalizeArabic(toEnDigits(body));

  // ─── المبلغ ─────────────────────────────────────────────────────────────
  // نمط: "مبلغ 300EGP" أو "مبلغ 300 EGP" أو "مبلغ 300 جنيه"
  const amountMatch =
    norm.match(/(?:مبلغ|amount)\s+([\d,]+(?:\.\d+)?)\s*(?:egp|EGP|جنيه|ج\.م|LE)?/i) ||
    norm.match(/([\d,]+(?:\.\d+)?)\s*EGP/i);
  if (!amountMatch) return null;

  const amount = parseFloat(toEnDigits(amountMatch[1]).replace(/,/g, ''));
  if (isNaN(amount) || amount <= 0) return null;

  // ─── حساب المستلم ───────────────────────────────────────────────────────
  // بعد normalizeArabic: "الى"→"الي"، "إلى"→"الي" — يجب مطابقة الشكل المُعيَّر
  // نمط: "الي حساب رقم xxx4449" أو "لحساب رقم 1234" أو "حساب xxx4449"
  const accountMatch =
    norm.match(/(?:الي\s+حساب\s+(?:رقم\s+)?|لحساب\s+(?:رقم\s+)?)([xX\d]{4,20})/) ||
    norm.match(/(?:الى\s+حساب\s+(?:رقم\s+)?|to\s+account\s*(?:no\.?\s*)?)([xX\d]{4,20})/i) ||
    norm.match(/(?:حساب)\s+(?:رقم\s+)?([xX\d]{4,20})/);
  if (!accountMatch) return null;
  const receiverAccount = accountMatch[1].trim();

  // ─── التاريخ ─────────────────────────────────────────────────────────────
  const dateMatch = body.match(
    /(\d{1,2}[\-\/][A-Za-z]{3}[\-\/]\d{2,4})|(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})/
  );
  const transactionDate = dateMatch ? parseInstaPayDate(dateMatch[0]) : null;

  // ─── طريقة التحويل ───────────────────────────────────────────────────────
  const normLower = norm.toLowerCase();
  let transferMethod = 'instant_transfer';
  if (normLower.includes('تحويل لحظي') || normLower.includes('التحويل اللحظي') || normLower.includes('instant')) {
    transferMethod = 'instant_transfer';
  } else if (normLower.includes('حوالة')) {
    transferMethod = 'wire_transfer';
  }

  // ─── Fingerprint (بديل transactionId) ──────────────────────────────────
  // حتمي: amount + receiverAccount + date
  const fingerprint = buildInstaPayFingerprint(amount, receiverAccount, transactionDate ?? '');

  return {
    provider: 'insta_pay',
    transactionId: fingerprint,        // fingerprint محدد لمنع التكرار
    transactionType: 'incoming_payment',
    amount,
    currency: 'EGP',
    senderPhone: null,                 // InstaPay لا يوفر senderPhone
    senderName: null,                  // InstaPay لا يوفر senderName
    recipientWallet: null,
    recipientAccount: receiverAccount,
    transactionDate: transactionDate ?? null,
    transferMethod,
    occurredAt: transactionDate
      ? new Date(transactionDate).toISOString()
      : new Date().toISOString(),
    rawMessage: body,
    normalizedMessage: normalizeMessage(body),
    sourceVerification: 'unverified',
    parserId: INSTAPAY_PARSER_ID,
    parserVersion: INSTAPAY_PARSER_VERSION,
    // حقول غير متوفرة في هذا النوع من الرسائل
    balanceAfterTransaction: null,
    balanceBeforeTransaction: null,
    messageSource: null,
    messageReceivedAt: null,
  };
}

/**
 * Fingerprint حتمي لـ InstaPay — يعتمد على بيانات الرسالة فقط.
 * يُستخدم كـ transactionId بديل لمنع التكرار.
 */
export function buildInstaPayFingerprint(
  amount: number,
  receiverAccount: string,
  date: string
): string {
  const parts = [
    'instapay',
    String(Math.round(amount * 100)),
    receiverAccount.replace(/[^a-z0-9]/gi, '').toLowerCase(),
    date.replace(/\D/g, '').slice(0, 8),
  ];
  return parts.join(':');
}
