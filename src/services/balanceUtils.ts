/**
 * balanceUtils.ts
 * ════════════════════════════════════════════════════════════════
 * دوال مساعدة خالصة (Pure) لاستخراج وتحقق الرصيد من نصوص Vodafone Cash.
 * لا تعتمد على React Native أو أي بيئة نظام — قابلة للاختبار في Node.
 *
 * مُصدَّرة من هنا وتُستخدم في balanceBeforeEnricher.ts.
 * ════════════════════════════════════════════════════════════════
 */

// ─── تطبيع النصوص ──────────────────────────────────────────────────────────

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;

export function normalizeArabicText(text: string): string {
  return text
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u200B-\u200F\u202A-\u202E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** تحويل أرقام عربية/فارسية → إنجليزية */
export function toEnDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

export function normalizeText(text: string): string {
  return normalizeArabicText(toEnDigits(text));
}

// ─── صيغ الرصيد المدعومة ────────────────────────────────────────────────────
//
// يدعم (per spec §2 + حالات حقيقية من رسائل VF-Cash):
//   A. رصيدك الحالي 83924.6
//   B. رصيد حسابك الحالي في فودافون كاش 84007.90   ← الصيغة التي كانت تفشل
//   C. رصيد محفظتك الحالي 84317.1 جنيه
//   D. رصيد حسابك في فودافون كاش الحالي 84007.90
//   E. رصيد حسابك الحالي (بدون "في ...")
//   F. الرصيد الحالي
//   G. رصيدك
//   H. رصيد حسابك (بدون "الحالي")
//   I. رصيد محفظتك (بدون "الحالي")
//   + دعم الفاصلة المنقوطة "؛"، ":" ، مسافة، أو مباشرةً بعد الـ label
//
// التصحيح الأساسي (B):
//   "رصيد حسابك الحالي في فودافون كاش ..." — كلمة "الحالي" تأتي قبل "في"
//   الـ Regex القديم توقعها بعد "فودافون كاش" → فشل. الحل: فرع مستقل.

export const BALANCE_LABEL_PATTERN =
  /(?:رصيدك\s+الحالي|رصيد\s+حسابك\s+الحالي(?:\s+(?:في|بـ)\s+(?:[^\d\s]+(?:\s+[^\d\s]+){0,4}))?\s*|رصيد\s+حسابك(?:\s+في\s+(?:[^\d\s]+(?:\s+[^\d\s]+){0,4}))?\s*(?:الحالي\s*)?|رصيد\s+محفظتك\s*(?:الحالي\s*)?|الرصيد\s+الحالي|رصيدك\s*)\s*[:\s؛]?\s*([\d,]+(?:\.\d+)?)/i;

/**
 * استخرج قيمة الرصيد وعبارة الدليل من نص رسالة.
 * يعيد { value, evidenceText } أو null.
 */
export function extractBalanceEvidence(
  body: string
): { value: number; evidenceText: string } | null {
  if (!body?.trim()) return null;
  const norm = normalizeText(body);
  const m = norm.match(BALANCE_LABEL_PATTERN);
  if (!m) return null;

  const raw = toEnDigits(m[1]).replace(/,/g, '');
  const value = parseFloat(raw);
  if (isNaN(value) || value <= 0) return null;

  return { value, evidenceText: m[0].trim() };
}

/** للتوافق مع الكود القديم */
export function extractBalanceFromMessage(body: string): number | null {
  return extractBalanceEvidence(body)?.value ?? null;
}

// ─── Balance Flow Validation ────────────────────────────────────────────────

export type BalanceFlowValidation =
  | 'BALANCE_FLOW_VALID'
  | 'BALANCE_FLOW_MISMATCH'
  | 'BALANCE_FLOW_UNKNOWN';

export function validateBalanceFlow(
  balanceBefore: number,
  amount: number | null,
  balanceAfter: number | null
): BalanceFlowValidation {
  if (amount === null || balanceAfter === null) return 'BALANCE_FLOW_UNKNOWN';
  // tolerance = 1.0 EGP لتغطية رسوم / ضرائب صغيرة (per spec §11)
  const tolerance = 1.0;
  return Math.abs(balanceBefore + amount - balanceAfter) <= tolerance
    ? 'BALANCE_FLOW_VALID'
    : 'BALANCE_FLOW_MISMATCH';
}

// ─── فحص نوع رسالة VF ───────────────────────────────────────────────────────

export type BalanceEvidenceType =
  | 'incoming_payment'
  | 'outgoing_payment'
  | 'recharge'
  | 'balance_update'
  | 'other_financial';

export function detectMessageType(body: string): BalanceEvidenceType {
  const norm = normalizeArabicText(body).toLowerCase();
  if (norm.includes('تم استلام') || norm.includes('received')) return 'incoming_payment';
  if (
    norm.includes('تم ارسال') || norm.includes('تم إرسال') ||
    norm.includes('تم تحويل') || norm.includes('تحويل') ||
    norm.includes('دفع') || norm.includes('تم الدفع')
  ) return 'outgoing_payment';
  if (norm.includes('شحن') || norm.includes('recharge')) return 'recharge';
  if (norm.includes('رصيد حسابك') || norm.includes('رصيدك الحالي')) return 'balance_update';
  return 'other_financial';
}

/**
 * هل الرسالة من Vodafone Cash؟
 * تدعم جميع صيغ VF-Cash المعروفة (per spec §6 + §20):
 *  - رسائل بها "vodafone cash" أو "فودافون كاش"
 *  - رسائل الرصيد المستقلة: "رصيدك الحالي" / "رصيد حسابك" / "رصيد محفظتك"
 *  - رسائل Recharge: "شحن" + "رصيد"
 */
export function isVodafoneCashMessage(body: string): boolean {
  const lower = body.toLowerCase();
  const norm = normalizeArabicText(body);
  return (
    lower.includes('vodafone cash') ||
    lower.includes('vodafonecash') ||
    norm.includes('فودافون كاش') ||
    norm.includes('فودافون') ||
    norm.includes('محفظتك') ||
    // رسائل الرصيد المستقلة (Spec Pattern A/B/C): رصيدك الحالي / رصيد حسابك / رصيد محفظتك
    norm.includes('رصيدك الحالي') ||
    norm.includes('رصيد حسابك') ||
    norm.includes('رصيد محفظتك') ||
    (norm.includes('شحن') && norm.includes('رصيد'))
  );
}

/**
 * هل الرسالة صالحة كـ Balance Evidence؟
 */
export function isValidBalanceEvidenceMessage(body: string): boolean {
  if (!isVodafoneCashMessage(body)) return false;
  if (!extractBalanceEvidence(body)) return false;
  const lower = body.toLowerCase();
  const norm = normalizeArabicText(body);
  // ─── كشف الرسائل الترويجية فقط — لا نرفض رسائل الشحن الحقيقية ───────────
  // رسائل 'تم شحن ... وخصم X من محفظتك' ليست ترويجية — الخصم هنا اسم عملية مالية
  // نرفض فقط: خصم% (نسبة مئوية) أو "عرض خصم" أو "استمتع بخصم"
  const isPromoDiscount =
    /خصم\s*\d+\s*%/.test(norm) ||
    /عرض\s+خصم/.test(norm) ||
    /استمتع\s+بخصم/.test(norm) ||
    /احصل\s+على\s+خصم/.test(norm);
  const isPromo =
    isPromoDiscount ||
    lower.includes('عرض') ||
    lower.includes('congratulation') ||
    (norm.includes('استمتع') && !norm.includes('رصيد')) ||
    (norm.includes('احصل') && !norm.includes('رصيد'));
  return !isPromo;
}
