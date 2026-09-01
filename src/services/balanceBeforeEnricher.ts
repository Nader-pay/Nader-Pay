/**
 * balanceBeforeEnricher.ts
 * ════════════════════════════════════════════════════════════════
 * يحسب Balance Before لعملية Vodafone Cash من الرسالة المالية
 * السابقة الأقرب زمنياً التي تحتوي على Evidence حقيقية للرصيد.
 *
 * القواعد الكاملة (per spec):
 *  1. يبحث فقط داخل Trusted SMS Source (نفس المصدر).
 *  2. يستخدم فقط رسائل سابقة للعملية الحالية (ts < currentTs).
 *  3. يدعم 6+ صيغ رصيد من Vodafone Cash.
 *  4. يأخذ الأقرب زمنياً — ليس أي رصيد قديم.
 *  5. لا يخمّن — إذا لم يجد رسالة صالحة يُعيد null.
 *  6. لا يستخدم الرسالة الحالية نفسها.
 *  7. يفرّق بين Amount/TransactionID/Balance.
 *  8. يعيد BalanceEvidence كاملة (metadata + validation).
 *  9. يدعم Arabic/English digits + RTL + مسافات متباينة.
 * 10. يسجّل Diagnostics واضحة (لا يسجّل بيانات حساسة زائدة).
 * ════════════════════════════════════════════════════════════════
 */

import type { SmsMessage } from '@/types/agent';
import { readAllFromSource } from './smsReader';

// ─── نوع BalanceEvidence الكاملة ─────────────────────────────────────────────

export type BalanceFlowValidation =
  | 'BALANCE_FLOW_VALID'
  | 'BALANCE_FLOW_MISMATCH'
  | 'BALANCE_FLOW_UNKNOWN';

export type BalanceEvidenceType =
  | 'incoming_payment'
  | 'outgoing_payment'
  | 'recharge'
  | 'balance_update'
  | 'other_financial';

export type BalanceEvidence = {
  /** الرصيد قبل العملية */
  balanceBefore: number;
  /** ID الرسالة من SMS Content Provider */
  sourceMessageId: string;
  /** عنوان المُرسِل */
  sourceSender: string;
  /** وقت استلام رسالة الدليل (ISO) */
  sourceMessageReceivedAt: string;
  /** نص الجزء الذي استُخرج منه الرصيد */
  balanceEvidenceText: string;
  /** نوع رسالة الدليل */
  balanceEvidenceType: BalanceEvidenceType;
  /** مستوى الثقة */
  confidence: 'high' | 'medium';
  /** المسافة الزمنية بالثوانٍ بين رسالة الدليل والعملية الحالية */
  distanceSeconds: number;
  /** سبب الاختيار */
  reason: string;
  /** نتيجة التحقق الحسابي (balanceBefore + amount ≈ balanceAfter) */
  flowValidation: BalanceFlowValidation;
  /** قيمة balanceAfter للمقارنة */
  balanceAfter: number | null;
};

// ─── ثوابت Logging ────────────────────────────────────────────────────────────

const LOG_TAG = '[BalanceBefore]';

function log(msg: string, ...args: unknown[]): void {
  if (__DEV__) console.log(`${LOG_TAG} ${msg}`, ...args);
}

function logWarn(msg: string, ...args: unknown[]): void {
  if (__DEV__) console.warn(`${LOG_TAG} ${msg}`, ...args);
}

// ─── تطبيع النصوص ────────────────────────────────────────────────────────────

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;

function normalizeArabic(text: string): string {
  return text
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u200B-\u200F\u202A-\u202E]/g, '') // Zero-width + bidi marks
    .replace(/\s+/g, ' ')
    .trim();
}

/** تحويل أرقام عربية/فارسية → إنجليزية — مُصدَّرة لبقية الكود */
export function toEnDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/** تطبيع كامل للمقارنة */
function normalizeText(text: string): string {
  return normalizeArabic(toEnDigits(text));
}

// ─── صيغ الرصيد المدعومة (6+ صيغ per spec) ──────────────────────────────────
//   1. رصيدك الحالي
//   2. رصيد حسابك
//   3. رصيد حسابك في فودافون كاش الحالي
//   4. رصيد محفظتك الحالي
//   5. رصيد محفظتك
//   6. رصيد حسابك الحالي
//   + الرصيد الحالي، رصيدك

const BALANCE_LABEL_PATTERN =
  /(?:رصيدك\s+الحالي|رصيد\s+حسابك(?:\s+في\s+(?:فودافون\s+)?(?:كاش|فودافون\s+كاش))?\s*(?:الحالي)?|رصيد\s+محفظتك\s*(?:الحالي)?|رصيد\s+حسابك\s+الحالي|الرصيد\s+الحالي|رصيدك)\s*[:\s]\s*([\d,]+(?:\.\d+)?)/i;

/**
 * استخرج قيمة الرصيد وعبارة الدليل من نص رسالة.
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

// ─── تحديد نوع رسالة Vodafone Cash ───────────────────────────────────────────

/**
 * هل الرسالة من Vodafone Cash؟ (لا نشترط "محفظتك" — رسائل Recharge لا تحتويها)
 */
function isVodafoneCashMessage(body: string): boolean {
  const lower = body.toLowerCase();
  const norm = normalizeArabic(body);
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

/** تحديد نوع رسالة VF للـ metadata */
function detectMessageType(body: string): BalanceEvidenceType {
  const norm = normalizeArabic(body).toLowerCase();
  if (norm.includes('تم استلام') || norm.includes('received')) return 'incoming_payment';
  if (norm.includes('تم ارسال') || norm.includes('تم إرسال') || norm.includes('دفع')) return 'outgoing_payment';
  if (norm.includes('شحن') || norm.includes('recharge')) return 'recharge';
  if (norm.includes('رصيد حسابك') || norm.includes('رصيدك الحالي')) return 'balance_update';
  return 'other_financial';
}

/** هل الرسالة صالحة كـ Balance Evidence؟ */
function isValidBalanceEvidenceMessage(body: string): boolean {
  if (!isVodafoneCashMessage(body)) return false;
  if (!extractBalanceEvidence(body)) return false;
  const lower = body.toLowerCase();
  const norm = normalizeArabic(body);
  const isPromo =
    lower.includes('عرض') ||
    lower.includes('خصم') ||
    lower.includes('congratulation') ||
    (norm.includes('استمتع') && !norm.includes('رصيد')) ||
    (norm.includes('احصل') && !norm.includes('رصيد'));
  return !isPromo;
}

// ─── Balance Flow Validation ──────────────────────────────────────────────────

export function validateBalanceFlow(
  balanceBefore: number,
  amount: number | null,
  balanceAfter: number | null
): BalanceFlowValidation {
  if (amount === null || balanceAfter === null) return 'BALANCE_FLOW_UNKNOWN';
  return Math.abs(balanceBefore + amount - balanceAfter) <= 0.1
    ? 'BALANCE_FLOW_VALID'
    : 'BALANCE_FLOW_MISMATCH';
}

// ─── البحث الرئيسي ────────────────────────────────────────────────────────────

/**
 * البحث عن BalanceEvidence من رسائل Trusted Source السابقة.
 *
 * @param sourceId           - معرّف الـ Trusted SMS Source
 * @param currentMessageId   - ID الرسالة الحالية (لمنع اختيار نفسها)
 * @param beforeIso          - ISO timestamp للعملية الحالية (رسائل أقدم منه فقط)
 * @param balanceAfter       - الرصيد بعد العملية (للتحقق الحسابي)
 * @param amount             - مبلغ العملية (للتحقق الحسابي)
 * @param maxMessages        - الحد الأقصى للرسائل المقروءة
 */
export async function findBalanceEvidence(
  sourceId: string | null,
  currentMessageId: string | null,
  beforeIso: string,
  balanceAfter: number | null = null,
  amount: number | null = null,
  maxMessages = 300
): Promise<BalanceEvidence | null> {
  if (process.env.EXPO_OS !== 'android') return null;
  if (!sourceId) {
    log('sourceId غير متوفر — لا يمكن البحث');
    return null;
  }

  const currentTs = new Date(beforeIso).getTime();
  if (isNaN(currentTs)) {
    logWarn('beforeIso غير صالح: %s', beforeIso);
    return null;
  }

  let messages: SmsMessage[];
  try {
    messages = await readAllFromSource(sourceId, maxMessages);
  } catch (err) {
    logWarn('فشل قراءة رسائل المصدر %s: %s', sourceId, String(err));
    return null;
  }

  log(
    'تم قراءة %d رسالة من المصدر %s — البحث عن رصيد سابق لـ %s',
    messages.length, sourceId, beforeIso
  );

  // فلترة: أقدم من العملية، وليست الرسالة الحالية نفسها، وتحتوي Balance Evidence
  const rejectedReasons: Record<string, string> = {};
  const candidates: Array<{ msg: SmsMessage; evidence: { value: number; evidenceText: string } }> = [];

  for (const msg of messages) {
    const msgTs = new Date(msg.date).getTime();

    // الرسالة الحالية نفسها
    if (currentMessageId && msg.id === currentMessageId) {
      rejectedReasons[msg.id] = 'الرسالة الحالية — محظورة كـ Evidence';
      continue;
    }

    // رسالة لاحقة
    if (isNaN(msgTs) || msgTs >= currentTs) {
      rejectedReasons[msg.id] = `رسالة لاحقة أو مجهولة الوقت (ts=${msgTs} >= currentTs=${currentTs})`;
      continue;
    }

    // فحص صلاحية Balance Evidence
    if (!isValidBalanceEvidenceMessage(msg.body)) {
      rejectedReasons[msg.id] = 'لا تحتوي على Balance Evidence صالحة';
      continue;
    }

    const evidence = extractBalanceEvidence(msg.body);
    if (!evidence) {
      rejectedReasons[msg.id] = 'فشل استخراج قيمة الرصيد';
      continue;
    }

    candidates.push({ msg, evidence });
  }

  log(
    '%d مرشح صالح من أصل %d رسالة',
    candidates.length, messages.length
  );

  if (candidates.length === 0) {
    log('لم يُعثر على رسالة سابقة تحتوي Balance Evidence');
    if (__DEV__ && Object.keys(rejectedReasons).length > 0) {
      const sampleKeys = Object.keys(rejectedReasons).slice(0, 5);
      for (const k of sampleKeys) log('  مرفوض [%s]: %s', k, rejectedReasons[k]);
    }
    return null;
  }

  // الأحدث أولاً (أقرب للعملية الحالية)
  candidates.sort((a, b) => new Date(b.msg.date).getTime() - new Date(a.msg.date).getTime());
  const best = candidates[0];
  const bestTs = new Date(best.msg.date).getTime();
  const distanceSeconds = Math.round((currentTs - bestTs) / 1000);
  const msgType = detectMessageType(best.msg.body);

  log(
    'تم اختيار الرسالة: id=%s sender=%s type=%s distance=%ds balance=%s',
    best.msg.id, best.msg.originatingAddress, msgType, distanceSeconds, best.evidence.value
  );

  const flowValidation = validateBalanceFlow(best.evidence.value, amount, balanceAfter);
  log(
    'Balance Flow: %s + %s = %s (expected %s) => %s',
    best.evidence.value, amount, balanceAfter,
    amount !== null ? best.evidence.value + amount : '?',
    flowValidation
  );

  return {
    balanceBefore: best.evidence.value,
    sourceMessageId: best.msg.id,
    sourceSender: best.msg.originatingAddress,
    sourceMessageReceivedAt: best.msg.date,
    balanceEvidenceText: best.evidence.evidenceText,
    balanceEvidenceType: msgType,
    confidence: 'high',
    distanceSeconds,
    reason: `أقرب رسالة ${msgType} سابقة تحتوي Balance Evidence (${distanceSeconds}s قبل العملية)`,
    flowValidation,
    balanceAfter,
  };
}

/**
 * للتوافق مع الكود القديم — يعيد فقط الرقم.
 */
export async function findBalanceBefore(
  sourceId: string | null,
  beforeIso: string,
  maxMessages = 300
): Promise<number | null> {
  const ev = await findBalanceEvidence(sourceId, null, beforeIso, null, null, maxMessages);
  return ev?.balanceBefore ?? null;
}

/**
 * إثراء ProviderParseResult بـ balanceBeforeTransaction من Trusted Source.
 */
export async function enrichWithBalanceBefore<T extends {
  balanceBeforeTransaction: number | null;
  occurredAt: string;
  transactionId?: string;
  amount?: number;
  balanceAfterTransaction?: number | null;
}>(
  parsed: T,
  sourceId: string | null,
  currentMessageId?: string | null
): Promise<T> {
  if (parsed.balanceBeforeTransaction !== null) return parsed;
  const ev = await findBalanceEvidence(
    sourceId,
    currentMessageId ?? null,
    parsed.occurredAt,
    parsed.balanceAfterTransaction ?? null,
    parsed.amount ?? null
  );
  return { ...parsed, balanceBeforeTransaction: ev?.balanceBefore ?? null };
}
