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

/**
 * تحليل تاريخ Vodafone Cash — يدعم الصيغ التالية:
 *
 *   DD-MM-YY HH:MM   (مثال: "21-08-26 00:15" → 21 أغسطس 2026 الساعة 00:15)
 *                    ← الصيغة الشائعة في رسائل VF-Cash الحقيقية
 *                    ← الترتيب: DD=21, MM=08, YY=26 (ليس YY-MM-DD!)
 *
 *   HH:MM DD/MM/YY   (مثال: "00:15 26/08/21" → 26 أغسطس 2021)
 *                    ← صيغة قديمة (الساعة أولاً)
 *
 *   DD/MM/YYYY HH:MM (مثال: "26/08/2026 00:15")
 *   YYYY-MM-DD HH:MM (مثال: "2026-08-21 00:15")
 *                    ← صيغ بديلة بسنة رباعية
 *
 * ⚠️  تحذير مهم — سبب الخطأ السابق:
 *   "21-08-26 00:15" كان يُفسَّر خطأً كـ YY-MM-DD (2021-08-26).
 *   الصحيح هو DD-MM-YY (2026-08-21). الرقمان الأولان هو اليوم دائماً.
 *
 * يستخدم Date.UTC لتجنب مشاكل timezone.
 */
function parseOccurredAt(dateText: string | null): string | null {
  if (!dateText) return null;
  const norm = toEnDigits(dateText.trim());

  // ── الصيغة الشائعة: DD-MM-YY HH:MM ──────────────────────────────────────
  // مثال: "21-08-26 00:15" → DD=21, MM=08, YY=26 → 2026-08-21T00:15:00Z
  // ⚠️ الترتيب DD-MM-YY وليس YY-MM-DD
  const shortFmt = norm.match(/^(\d{2})[\-\/](\d{2})[\-\/](\d{2})\s+(\d{2}):(\d{2})/);
  if (shortFmt) {
    const [, dd, mm, yy, hh, min] = shortFmt;
    const fullYear = 2000 + parseInt(yy, 10);
    const ts = Date.UTC(fullYear, parseInt(mm, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(min, 10));
    if (!isNaN(ts)) return new Date(ts).toISOString();
  }

  // ── صيغة بسنة رباعية: DD/MM/YYYY HH:MM أو YYYY-MM-DD HH:MM ─────────────
  const fullDate = norm.match(/(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})\s+(\d{2}):(\d{2})/);
  if (fullDate) {
    const [, d, m, y, h, min] = fullDate;
    const ts = Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(min, 10));
    if (!isNaN(ts)) return new Date(ts).toISOString();
  }

  // ── الصيغة القديمة: HH:MM DD/MM/YY (الساعة أولاً) ───────────────────────
  // مثال: "00:15 26/08/21" → 2021-08-26T00:15:00Z
  const oldFmt = norm.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (oldFmt) {
    const [, hours, minutes, , day, month, year] = oldFmt;
    let fullYear = parseInt(year, 10);
    if (fullYear < 100) fullYear += 2000;
    const ts = Date.UTC(fullYear, parseInt(month, 10) - 1, parseInt(day, 10), parseInt(hours, 10), parseInt(minutes, 10));
    if (!isNaN(ts)) return new Date(ts).toISOString();
  }

  return null;
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
  // بعد normalizeArabic: ة→ه ، فـ "العملية"→"العمليه" و"المعاملة"→"المعامله"
  const transactionIdMatch = normalized.match(
    /(?:رقم\s+(?:العمليه|العملية|المعامله|المعاملة)|Transaction\s*(?:ID|No))\s*[:\s]\s*([0-9]{6,})/i
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
  // بعد normalizeArabic: "بإسم"→"بإسم" (لا تغيير)، "باسم"→"باسم"
  // "المسجل" تبقى كما هي، "بإسم" قد تصبح "بإسم"
  const senderNameMatch = normalized.match(
    /(?:المسجل\s+(?:بإسم|بإسم|باسم)|بإسم|باسم)\s+([^\n.،,\d][^\n.،,]{1,60})/
  );
  const senderName = senderNameMatch ? senderNameMatch[1].trim() : null;

  // ─── محفظة المستلم ────────────────────────────────────────────────────────
  // "محفظتك" لا تتغير بـ normalizeArabic
  // الـ regex يأخذ الأرقام فقط (بدون . في النهاية)
  const recipientWalletMatch = normalized.match(
    /(?:على\s+رقم\s+محفظتك|محفظتك|رقم\s+المحفظه|رقم\s+المحفظة)\s+([0-9]{7,15})/
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
  // "العملية"→"العمليه"، "المعاملة"→"المعامله" بعد normalize
  // يدعم: "تاريخ العملية: 21-08-26 00:15" و "تاريخ العملية: 00:15 26-08-21"
  const dateMatch = normalized.match(
    /(?:تاريخ\s+(?:العمليه|العملية|المعامله|المعاملة)|التاريخ)\s*[:\s]\s*([\d]{2}[\-\/][\d]{2}[\-\/][\d]{2,4}\s+[\d]{2}:[\d]{2}|[\d]{1,2}:[\d]{2}(?::[\d]{2})?\s+[\d]{1,2}[\/-][\d]{1,2}[\/-][\d]{2,4})/
  );
  // إذا لم يُعثر على تاريخ في الرسالة → نستخدم epoch بدلاً من new Date()
  // حتى لا يصبح "الآن" مرجعاً زمنياً خاطئاً لحساب Balance Before.
  // epoch (1970-01-01) يضمن أن لا رسالة سابقة ستُختار كـ Evidence
  // لأنها ستكون أحدث منه دائماً → BalanceBefore = null (آمن).
  const occurredAt = parseOccurredAt(dateMatch ? dateMatch[1] : null) ?? '1970-01-01T00:00:00.000Z';

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
    // balanceBeforeTransaction يُحسب خارج الـ parser (من الرسالة السابقة الموثوقة)
    balanceBeforeTransaction: null,
    transactionDate: occurredAt.slice(0, 10),
    transferMethod: null,
    occurredAt,
    rawMessage: body,
    normalizedMessage: normalizeMessage(body),
    sourceVerification: 'unverified',
    parserId: VF_CASH_PARSER_ID,
    parserVersion: VF_CASH_PARSER_VERSION,
    messageSource: null,
    messageReceivedAt: null,  // يُملأ من الخارج عبر parseVodafoneCashSmsWithMeta
  };
}

/**
 * Parse رسالة Vodafone Cash مع بيانات SMS Content Provider الكاملة.
 * يُستخدم في مسار الـ Balance Before Enrichment حيث نحتاج messageReceivedAt
 * كمرجع زمني دقيق (وقت استلام الرسالة الفعلي من الشبكة).
 *
 * @param message   - نص الرسالة
 * @param smsId     - ID الرسالة من SMS Content Provider
 * @param receivedAt - وقت الاستلام (ISO) من SMS Content Provider
 */
export function parseVodafoneCashSmsWithMeta(
  message: string,
  smsId: string | null,
  receivedAt: string | null
): import('@/types/provider').ProviderParseResult | null {
  const result = parseVodafoneCashSms(message);
  if (!result) return null;
  return {
    ...result,
    messageReceivedAt: receivedAt,
    // messageSource يحمل smsId للـ Balance Before Enrichment
    messageSource: smsId,
  };
}
