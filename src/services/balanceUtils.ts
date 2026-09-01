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
// يدعم (per spec):
//   1. رصيدك الحالي
//   2. رصيد حسابك
//   3. رصيد حسابك في فودافون كاش الحالي
//   4. رصيد محفظتك الحالي
//   5. رصيد محفظتك
//   6. رصيد حسابك الحالي
//   7. الرصيد الحالي
//   8. رصيدك
//   + دعم الفاصلة المنقوطة "؛" وغياب الفاصل بعد الـ label

export const BALANCE_LABEL_PATTERN =
  /(?:رصيدك\s+الحالي|رصيد\s+حسابك(?:\s+في\s+(?:فودافون\s+)?(?:كاش|فودافون\s+كاش))?\s*(?:الحالي)?|رصيد\s+محفظتك\s*(?:الحالي)?|رصيد\s+حسابك\s+الحالي|الرصيد\s+الحالي|رصيدك)\s*[:\s؛]\s*([\d,]+(?:\.\d+)?)/i;

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
  const tolerance = 0.1;
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
  if (norm.includes('تم ارسال') || norm.includes('تم إرسال') || norm.includes('دفع')) return 'outgoing_payment';
  if (norm.includes('شحن') || norm.includes('recharge')) return 'recharge';
  if (norm.includes('رصيد حسابك') || norm.includes('رصيدك الحالي')) return 'balance_update';
  return 'other_financial';
}

/**
 * هل الرسالة من Vodafone Cash؟
 * لا نشترط "محفظتك" — رسائل Recharge لا تحتوي عليها.
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
    (norm.includes('شحن') && norm.includes('رصيد')) ||
    (norm.includes('رصيد حسابك') && norm.includes('فودافون'))
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
  const isPromo =
    lower.includes('عرض') ||
    lower.includes('خصم') ||
    lower.includes('congratulation') ||
    (norm.includes('استمتع') && !norm.includes('رصيد')) ||
    (norm.includes('احصل') && !norm.includes('رصيد'));
  return !isPromo;
}
