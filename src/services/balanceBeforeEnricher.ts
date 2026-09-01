/**
 * balanceBeforeEnricher.ts
 * ════════════════════════════════════════════════════════════════
 * يحسب Balance Before لعملية Vodafone Cash من الرسالة المالية
 * السابقة الأقرب زمنياً التي تحتوي على Evidence حقيقية للرصيد.
 *
 * القواعد الكاملة (per spec):
 *  1. يبحث فقط داخل Trusted SMS Source (نفس المصدر).
 *  2. يستخدم فقط رسائل سابقة للعملية الحالية (ts < currentTs).
 *  3. يدعم 8+ صيغ رصيد من Vodafone Cash.
 *  4. يأخذ الأقرب زمنياً — ليس أي رصيد قديم.
 *  5. لا يخمّن — إذا لم يجد رسالة صالحة يُعيد null.
 *  6. لا يستخدم الرسالة الحالية نفسها (بـ ID أو timestamp).
 *  7. يفرّق بين Amount/TransactionID/Balance.
 *  8. يعيد BalanceEvidence كاملة (metadata + validation).
 *  9. يدعم Arabic/English digits + RTL + مسافات متباينة.
 * 10. يسجّل Diagnostics واضحة (لا يسجّل بيانات حساسة زائدة).
 * 11. يستخدم messageReceivedAt (وقت SMS Content Provider) كمرجع أساسي.
 * 12. يدعم رسائل Recharge + Outgoing + BalanceUpdate كـ Evidence.
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

// ─── صيغ الرصيد المدعومة (8+ صيغ per spec) ──────────────────────────────────
//   1. رصيدك الحالي
//   2. رصيد حسابك
//   3. رصيد حسابك في فودافون كاش الحالي
//   4. رصيد محفظتك الحالي
//   5. رصيد محفظتك
//   6. رصيد حسابك الحالي
//   7. الرصيد الحالي
//   8. رصيدك
//   + دعم الفاصلة المنقوطة "؛" وعدم وجود فاصل واضح بعد الـ label

const BALANCE_LABEL_PATTERN =
  /(?:رصيدك\s+الحالي|رصيد\s+حسابك(?:\s+في\s+(?:فودافون\s+)?(?:كاش|فودافون\s+كاش))?\s*(?:الحالي)?|رصيد\s+محفظتك\s*(?:الحالي)?|رصيد\s+حسابك\s+الحالي|الرصيد\s+الحالي|رصيدك)\s*[:\s؛]\s*([\d,]+(?:\.\d+)?)/i;

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
 * @param sourceId                 - معرّف الـ Trusted SMS Source
 * @param currentMessageId         - ID الرسالة الحالية (لمنع اختيار نفسها)
 * @param currentMessageReceivedAt - وقت استلام الرسالة الحالية من SMS Content Provider (ISO)
 *                                   يُستخدم كمرجع أساسي للمقارنة الزمنية.
 *                                   إذا كان null يُستخدم transactionOccurredAt.
 * @param transactionOccurredAt    - وقت العملية المستخرج من نص الرسالة (ISO) — للـ Diagnostics
 * @param balanceAfter             - الرصيد بعد العملية (للتحقق الحسابي)
 * @param amount                   - مبلغ العملية (للتحقق الحسابي)
 * @param maxMessages              - الحد الأقصى للرسائل المقروءة
 */
export async function findBalanceEvidence(
  sourceId: string | null,
  currentMessageId: string | null,
  currentMessageReceivedAt: string,
  balanceAfter: number | null = null,
  amount: number | null = null,
  maxMessages = 500,
  transactionOccurredAt?: string | null
): Promise<BalanceEvidence | null> {
  if (process.env.EXPO_OS !== 'android') return null;
  if (!sourceId) {
    log('sourceId غير متوفر — لا يمكن البحث');
    return null;
  }

  // ── المرجع الزمني: messageReceivedAt أولاً، ثم transactionOccurredAt ─────
  const currentTs = new Date(currentMessageReceivedAt).getTime();
  if (isNaN(currentTs)) {
    // محاولة ثانية مع transactionOccurredAt
    if (transactionOccurredAt) {
      const fallbackTs = new Date(transactionOccurredAt).getTime();
      if (!isNaN(fallbackTs)) {
        log('messageReceivedAt غير صالح — استخدام transactionOccurredAt كمرجع');
        return _doFindBalanceEvidence(
          sourceId, currentMessageId, fallbackTs,
          balanceAfter, amount, maxMessages
        );
      }
    }
    logWarn('كلا الـ timestamps غير صالحَين: receivedAt=%s occurredAt=%s',
      currentMessageReceivedAt, transactionOccurredAt ?? '—');
    return null;
  }

  log(
    'بدء البحث: source=%s currentMsgId=%s refTs=%s',
    sourceId, currentMessageId ?? 'none', currentMessageReceivedAt
  );

  return _doFindBalanceEvidence(
    sourceId, currentMessageId, currentTs,
    balanceAfter, amount, maxMessages
  );
}

/** دالة البحث الداخلية — تقبل timestamp رقمياً مباشرة */
async function _doFindBalanceEvidence(
  sourceId: string,
  currentMessageId: string | null,
  currentTs: number,
  balanceAfter: number | null,
  amount: number | null,
  maxMessages: number
): Promise<BalanceEvidence | null> {
  let messages: SmsMessage[];
  try {
    messages = await readAllFromSource(sourceId, maxMessages);
  } catch (err) {
    logWarn('فشل قراءة رسائل المصدر %s: %s', sourceId, String(err));
    return null;
  }

  log(
    'تم قراءة %d رسالة من المصدر %s — البحث عن رصيد سابق لـ ts=%d',
    messages.length, sourceId, currentTs
  );

  // ── فلترة وجمع المرشحين ──────────────────────────────────────────────────
  const rejectedReasons: Array<{ id: string; reason: string }> = [];
  const candidates: Array<{ msg: SmsMessage; msgTs: number; evidence: { value: number; evidenceText: string } }> = [];

  for (const msg of messages) {
    // ① منع الرسالة الحالية بـ ID
    if (currentMessageId && msg.id === currentMessageId) {
      rejectedReasons.push({ id: msg.id, reason: 'CURRENT_MESSAGE — الرسالة الحالية محظورة' });
      continue;
    }

    const msgTs = new Date(msg.date).getTime();

    // ② منع الرسائل اللاحقة وغير المعروفة التاريخ
    if (isNaN(msgTs)) {
      rejectedReasons.push({ id: msg.id, reason: 'INVALID_TIMESTAMP — وقت الرسالة غير صالح' });
      continue;
    }
    if (msgTs >= currentTs) {
      // ② ب: الرسالة التي لها نفس الـ timestamp والـ ID مختلف — قد تكون الرسالة الحالية
      if (currentMessageId == null && msgTs === currentTs) {
        rejectedReasons.push({ id: msg.id, reason: 'CURRENT_MESSAGE — نفس الـ timestamp بدون ID' });
        continue;
      }
      rejectedReasons.push({ id: msg.id, reason: `FUTURE_MESSAGE — ts=${msgTs} >= currentTs=${currentTs}` });
      continue;
    }

    // ③ Source filtering — رسائل VF Cash فقط
    if (!isVodafoneCashMessage(msg.body)) {
      rejectedReasons.push({ id: msg.id, reason: 'SOURCE_MISMATCH — ليست رسالة Vodafone Cash' });
      continue;
    }

    // ④ Balance Evidence validation
    if (!isValidBalanceEvidenceMessage(msg.body)) {
      rejectedReasons.push({ id: msg.id, reason: 'NO_BALANCE_EVIDENCE — لا تحتوي Balance صالح' });
      continue;
    }

    const evidence = extractBalanceEvidence(msg.body);
    if (!evidence) {
      rejectedReasons.push({ id: msg.id, reason: 'INVALID_BALANCE_FORMAT — فشل استخراج قيمة الرصيد' });
      continue;
    }

    candidates.push({ msg, msgTs, evidence });
  }

  log(
    'الفلترة: %d مرشح صالح من %d رسالة (%d مرفوضة)',
    candidates.length, messages.length, rejectedReasons.length
  );

  if (candidates.length === 0) {
    log('لم يُعثر على رسالة سابقة تحتوي Balance Evidence — NO_PREVIOUS_BALANCE_EVIDENCE');
    if (__DEV__) {
      // عرض أسباب الرفض (بدون نصوص SMS الكاملة)
      const sample = rejectedReasons.slice(0, 8);
      for (const r of sample) log('  مرفوض [%s]: %s', r.id, r.reason);
      if (rejectedReasons.length > 8) log('  ... و%d أخرى', rejectedReasons.length - 8);
    }
    return null;
  }

  // ── اختيار الأقرب زمنياً (الأحدث قبل العملية) ─────────────────────────────
  // ترتيب تنازلي بـ msgTs → الأول هو الأقرب
  candidates.sort((a, b) => b.msgTs - a.msgTs);
  const best = candidates[0];
  const distanceSeconds = Math.round((currentTs - best.msgTs) / 1000);
  const msgType = detectMessageType(best.msg.body);

  log(
    'اختيار الرسالة: id=%s type=%s distance=%ds balance=%s',
    best.msg.id, msgType, distanceSeconds, best.evidence.value
  );

  const flowValidation = validateBalanceFlow(best.evidence.value, amount, balanceAfter);
  log(
    'Balance Flow: %s + %s = %s (expected %s) => %s',
    best.evidence.value, amount ?? '?',
    amount !== null ? best.evidence.value + amount : '?',
    balanceAfter ?? '?',
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
 * يستخدم messageReceivedAt كمرجع زمني.
 */
export async function findBalanceBefore(
  sourceId: string | null,
  currentMessageReceivedAt: string,
  maxMessages = 500
): Promise<number | null> {
  const ev = await findBalanceEvidence(sourceId, null, currentMessageReceivedAt, null, null, maxMessages);
  return ev?.balanceBefore ?? null;
}

/**
 * إثراء ProviderParseResult بـ balanceBeforeTransaction من Trusted Source.
 * يستخدم messageReceivedAt كمرجع أساسي للبحث الزمني.
 */
export async function enrichWithBalanceBefore<T extends {
  balanceBeforeTransaction: number | null;
  occurredAt: string;
  messageReceivedAt?: string | null;
  transactionId?: string;
  amount?: number;
  balanceAfterTransaction?: number | null;
}>(
  parsed: T,
  sourceId: string | null,
  currentMessageId?: string | null
): Promise<T> {
  if (parsed.balanceBeforeTransaction !== null) return parsed;

  // المرجع الزمني: messageReceivedAt أولاً، fallback لـ occurredAt
  const refTime = parsed.messageReceivedAt ?? parsed.occurredAt;

  const ev = await findBalanceEvidence(
    sourceId,
    currentMessageId ?? null,
    refTime,
    parsed.balanceAfterTransaction ?? null,
    parsed.amount ?? null,
    500,
    parsed.occurredAt
  );
  return { ...parsed, balanceBeforeTransaction: ev?.balanceBefore ?? null };
}
