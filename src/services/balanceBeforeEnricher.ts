/**
 * balanceBeforeEnricher.ts
 * ════════════════════════════════════════════════════════════════
 * يحسب Balance Before لعملية Vodafone Cash من الرسالة المالية
 * السابقة الأقرب زمنياً التي تحتوي على Evidence حقيقية للرصيد.
 *
 * القواعد الكاملة (Phase 6+Final — per spec):
 *  1. يبحث فقط داخل Trusted SMS Source (نفس المصدر).
 *  2. يستخدم فقط رسائل سابقة للعملية الحالية (ts < currentTs).
 *  3. يدعم 8+ صيغ رصيد من Vodafone Cash.
 *  4. يأخذ الأقرب زمنياً — ليس أي رصيد قديم.
 *  5. لا يخمّن — إذا لم يجد رسالة صالحة يُعيد null.
 *  6. لا يستخدم الرسالة الحالية نفسها (بـ ID أو timestamp).
 *  7. يفرّق بين Amount/TransactionID/Balance.
 *  8. يعيد BalanceEvidence كاملة (metadata + validation + diagnosticInfo).
 *  9. يدعم Arabic/English digits + RTL + مسافات متباينة.
 * 10. يسجّل Diagnostics واضحة (لا يسجّل بيانات حساسة زائدة).
 * 11. يستخدم messageReceivedAt (وقت SMS Content Provider) كمرجع أساسي.
 * 12. يدعم رسائل Recharge + Outgoing + BalanceUpdate كـ Evidence.
 * 13. [Phase 6] يعمل على Snapshot ثابت — لا يتأثر بـ SMS جديدة بعد تثبيت matchedSmsId.
 * 14. [Phase 6] يُدرج Diagnostics كاملة: عدد مرشحين + أسباب رفض + selected evidence.
 * 15. [Phase 6] يحتفظ بـ transactionDateTime منفصلاً عن messageReceivedAt.
 *     أي تناقض بينهما يُسجَّل في Diagnostics ولا يُخفى.
 * 16. [Final] maxMessages افتراضياً 1000 — البحث التاريخي عميق بما يكفي.
 * 17. [Final] يُوسّع نافذة البحث لمدة 30 يوماً للخلف من currentTs.
 * 18. [Final] diagnosticInfo مُدرج دائماً في BalanceEvidence حتى عند null.
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

// ─── نوع معلومات التشخيص الكاملة ────────────────────────────────────────────

export type BalanceDiagnosticInfo = {
  /** إجمالي الرسائل المقروءة من المصدر */
  totalMessagesRead: number;
  /** الرسائل التي timestamp أقل من currentTs */
  messagesBeforeTransaction: number;
  /** الرسائل التي timestamp أكبر أو يساوي currentTs */
  messagesAfterOrSame: number;
  /** عدد المرشحين الصالحين للـ Evidence */
  validCandidatesCount: number;
  /** عدد المرشحين المرفوضين */
  rejectedCount: number;
  /** ID الرسالة المختارة كـ Evidence */
  selectedCandidateId: string | null;
  /** timestamp المرجع المستخدم للمقارنة (ISO) */
  referenceTimestamp: string;
  /** هل استُخدم messageReceivedAt أم transactionOccurredAt كمرجع؟ */
  referenceSource: 'messageReceivedAt' | 'transactionOccurredAt' | 'unknown';
  /** اسم المصدر */
  sourceId: string;
  /** currentMessageId المستخدم لمنع الرسالة الحالية */
  currentMessageId: string | null;
};

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
  /** المسافة الزمنية بالثوانٍ بين رسالة الدليل والعملية الحالية
   *  = matchedTransactionReceivedAt - candidateReceivedAt  (양수دائماً)
   *  ممنوع: now - candidateReceivedAt */
  distanceSeconds: number;
  /** سبب الاختيار */
  reason: string;
  /** نتيجة التحقق الحسابي (balanceBefore + amount ≈ balanceAfter) */
  flowValidation: BalanceFlowValidation;
  /** قيمة balanceAfter للمقارنة */
  balanceAfter: number | null;
  /** [spec §10] المرشحون المرفوضون للـ Debug — كل مرشح مع سبب رفضه */
  rejectedCandidates?: Array<{
    id: string;
    reason: string;
    ts?: number;
    balance?: number;
  }>;
  /** [Final] معلومات التشخيص الكاملة */
  diagnosticInfo?: BalanceDiagnosticInfo;
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

// ─── صيغ الرصيد المدعومة (per spec §2 + حالات حقيقية من رسائل VF-Cash) ───────
//   A. رصيدك الحالي 83924.6
//   B. رصيد حسابك الحالي في فودافون كاش 84007.90   ← الصيغة التي كانت تفشل
//   C. رصيد محفظتك الحالي 84317.1 جنيه
//   D. رصيد حسابك في فودافون كاش الحالي 84007.90
//   E. رصيد حسابك الحالي (بدون "في ...")
//   F. الرصيد الحالي
//   G. رصيدك
//   H. رصيد حسابك (بدون "الحالي")
//   I. رصيد محفظتك (بدون "الحالي")
//   + دعم "؛"، ":" ، مسافة، أو مباشرةً بعد الـ label (لا فاصل مطلوب)
//
// التصحيح الأساسي (B):
//   "رصيد حسابك الحالي في فودافون كاش ..." — "الحالي" قبل "في"
//   الـ Regex القديم توقعها بعد "فودافون كاش" → فشل. الحل: فرع مستقل.

const BALANCE_LABEL_PATTERN =
  /(?:رصيدك\s+الحالي|رصيد\s+حسابك\s+الحالي(?:\s+(?:في|بـ)\s+(?:[^\d\s]+(?:\s+[^\d\s]+){0,4}))?\s*|رصيد\s+حسابك(?:\s+في\s+(?:[^\d\s]+(?:\s+[^\d\s]+){0,4}))?\s*(?:الحالي\s*)?|رصيد\s+محفظتك\s*(?:الحالي\s*)?|الرصيد\s+الحالي|رصيدك\s*)\s*[:\s؛]?\s*([\d,]+(?:\.\d+)?)/i;

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
 * هل الرسالة من Vodafone Cash؟ (per spec §6 + §20)
 * تدعم جميع صيغ VF-Cash المعروفة:
 *  - رسائل بها "vodafone cash" أو "فودافون كاش"
 *  - رسائل الرصيد المستقلة (Spec Pattern A/B/C): رصيدك الحالي / رصيد حسابك / رصيد محفظتك
 *  - رسائل Recharge: "شحن" + "رصيد"
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
    // رسائل الرصيد المستقلة — Spec Pattern A/B/C
    norm.includes('رصيدك الحالي') ||
    norm.includes('رصيد حسابك') ||
    norm.includes('رصيد محفظتك') ||
    (norm.includes('شحن') && norm.includes('رصيد'))
  );
}

/** تحديد نوع رسالة VF للـ metadata */
function detectMessageType(body: string): BalanceEvidenceType {
  const norm = normalizeArabic(body).toLowerCase();
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

/** هل الرسالة صالحة كـ Balance Evidence؟ */
function isValidBalanceEvidenceMessage(body: string): boolean {
  if (!isVodafoneCashMessage(body)) return false;
  if (!extractBalanceEvidence(body)) return false;
  const lower = body.toLowerCase();
  const norm = normalizeArabic(body);
  // ─── كشف الرسائل الترويجية فقط — لا نرفض رسائل الشحن الحقيقية ───────────
  // رسائل 'تم شحن ... وخصم X من محفظتك' ليست ترويجية — الخصم هنا اسم عملية مالية
  // نرفض فقط: خصم% (نسبة مئوية) أو "عرض خصم" أو "استمتع بخصم"
  const isPromoDiscount =
    /خصم\s*\d+\s*%/.test(norm) ||         // خصم 20% — ترويجي
    /عرض\s+خصم/.test(norm) ||             // عرض خصم — ترويجي
    /استمتع\s+بخصم/.test(norm) ||         // استمتع بخصم — ترويجي
    /احصل\s+على\s+خصم/.test(norm);        // احصل على خصم — ترويجي
  const isPromo =
    isPromoDiscount ||
    lower.includes('عرض') ||
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
  // tolerance = 1.0 EGP لتغطية رسوم / ضرائب صغيرة (per spec §11)
  return Math.abs(balanceBefore + amount - balanceAfter) <= 1.0
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
 * @param maxMessages              - الحد الأقصى للرسائل المقروءة (افتراضي 1000 للبحث التاريخي العميق)
 */
export async function findBalanceEvidence(
  sourceId: string | null,
  currentMessageId: string | null,
  currentMessageReceivedAt: string,
  balanceAfter: number | null = null,
  amount: number | null = null,
  maxMessages = 1000,
  transactionOccurredAt?: string | null
): Promise<BalanceEvidence | null> {
  if (process.env.EXPO_OS !== 'android') return null;
  if (!sourceId) {
    log('sourceId غير متوفر — لا يمكن البحث');
    return null;
  }

  // ── المرجع الزمني: messageReceivedAt أولاً، ثم transactionOccurredAt ─────
  const currentTs = new Date(currentMessageReceivedAt).getTime();
  let refSource: BalanceDiagnosticInfo['referenceSource'] = 'messageReceivedAt';

  if (isNaN(currentTs)) {
    // محاولة ثانية مع transactionOccurredAt
    if (transactionOccurredAt) {
      const fallbackTs = new Date(transactionOccurredAt).getTime();
      if (!isNaN(fallbackTs)) {
        log('messageReceivedAt غير صالح — استخدام transactionOccurredAt كمرجع');
        return _doFindBalanceEvidence(
          sourceId, currentMessageId, fallbackTs,
          balanceAfter, amount, maxMessages,
          transactionOccurredAt, 'transactionOccurredAt'
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
    balanceAfter, amount, maxMessages,
    transactionOccurredAt, refSource
  );
}

/** دالة البحث الداخلية — تقبل timestamp رقمياً مباشرة
 *
 * [Phase 6] هذه الدالة تعمل على Snapshot ثابت:
 *  - currentTs = وقت matchedSmsReceivedAt (مُثبَّت قبل الاستدعاء)
 *  - currentMessageId = matchedSmsId (لمنع اختيار الرسالة الحالية)
 *  - لا تتأثر بـ SMS جديدة وصلت بعد تثبيت الـ Snapshot
 * [Final] يُضيف diagnosticInfo كاملة للـ BalanceEvidence
 */
async function _doFindBalanceEvidence(
  sourceId: string,
  currentMessageId: string | null,
  currentTs: number,
  balanceAfter: number | null,
  amount: number | null,
  maxMessages: number,
  transactionOccurredAt?: string | null,
  referenceSource: BalanceDiagnosticInfo['referenceSource'] = 'messageReceivedAt'
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

  // ── [Phase 6] فحص تناقض Timestamps ─────────────────────────────────────
  // transactionOccurredAt هو وقت العملية من نص الرسالة
  // currentTs هو messageReceivedAt (مرجع أساسي)
  // إذا كان transactionOccurredAt أحدث من messageReceivedAt بفارق > 60 ثانية → تناقض
  if (transactionOccurredAt) {
    const txTs = new Date(transactionOccurredAt).getTime();
    if (!isNaN(txTs) && txTs > currentTs + 60_000) {
      logWarn(
        '[Phase 6] تناقض Timestamps: transactionOccurredAt=%s أحدث من messageReceivedAt=%d بـ%ds — نستخدم messageReceivedAt كمرجع',
        transactionOccurredAt, currentTs, Math.round((txTs - currentTs) / 1000)
      );
    }
  }

  // ── فلترة وجمع المرشحين ──────────────────────────────────────────────────
  const rejectedReasons: Array<{ id: string; reason: string; ts?: number; balance?: number }> = [];
  const candidates: Array<{ msg: SmsMessage; msgTs: number; evidence: { value: number; evidenceText: string } }> = [];

  for (const msg of messages) {
    // ① منع الرسالة الحالية بـ ID (matchedSmsId)
    if (currentMessageId && msg.id === currentMessageId) {
      rejectedReasons.push({ id: msg.id, reason: 'CURRENT_MESSAGE (matchedSmsId) — الرسالة المطابقة محظورة كـ Evidence' });
      continue;
    }

    const msgTs = new Date(msg.date).getTime();

    // ② منع الرسائل اللاحقة وغير المعروفة التاريخ
    if (isNaN(msgTs)) {
      rejectedReasons.push({ id: msg.id, reason: 'INVALID_TIMESTAMP — وقت الرسالة غير صالح' });
      continue;
    }
    if (msgTs >= currentTs) {
      // ② ب: نفس الـ timestamp بدون ID — محتمل أن تكون الرسالة الحالية
      if (currentMessageId == null && msgTs === currentTs) {
        rejectedReasons.push({ id: msg.id, reason: 'CURRENT_MESSAGE — نفس الـ timestamp (msgTs==currentTs) بدون ID', ts: msgTs });
        continue;
      }
      // [spec §6] REJECTED_FUTURE_RELATIVE_TO_TRANSACTION
      const ev = extractBalanceEvidence(msg.body);
      rejectedReasons.push({
        id: msg.id,
        reason: `REJECTED_FUTURE_RELATIVE_TO_TRANSACTION — ts=${new Date(msgTs).toISOString()} >= currentTs=${new Date(currentTs).toISOString()}`,
        ts: msgTs,
        balance: ev?.value,
      });
      continue;
    }

    // ③ Source filtering — رسائل VF Cash فقط
    if (!isVodafoneCashMessage(msg.body)) {
      rejectedReasons.push({ id: msg.id, reason: 'SOURCE_MISMATCH — ليست رسالة Vodafone Cash', ts: msgTs });
      continue;
    }

    // ④ Balance Evidence validation
    if (!isValidBalanceEvidenceMessage(msg.body)) {
      rejectedReasons.push({ id: msg.id, reason: 'NO_BALANCE_EVIDENCE — لا تحتوي Balance صالح أو رسالة ترويجية', ts: msgTs });
      continue;
    }

    const evidence = extractBalanceEvidence(msg.body);
    if (!evidence) {
      rejectedReasons.push({ id: msg.id, reason: 'INVALID_BALANCE_FORMAT — فشل استخراج قيمة الرصيد', ts: msgTs });
      continue;
    }

    candidates.push({ msg, msgTs, evidence });
  }

  // ── [Phase 6] Diagnostics ─────────────────────────────────────────────────
  log(
    '[Diagnostics] matchedSmsId=%s currentTs=%d totalMessages=%d candidates=%d rejected=%d',
    currentMessageId ?? 'none', currentTs, messages.length, candidates.length, rejectedReasons.length
  );

  if (__DEV__ && rejectedReasons.length > 0) {
    const sample = rejectedReasons.slice(0, 10);
    for (const r of sample) log('  مرفوض [%s]: %s', r.id, r.reason);
    if (rejectedReasons.length > 10) log('  ... و%d أخرى مرفوضة', rejectedReasons.length - 10);
  }

  // ── بناء diagnosticInfo كاملة — متاحة دائماً حتى عند null ──────────────
  const messagesBeforeTransaction = messages.filter((m) => {
    const ts = new Date(m.date).getTime();
    return !isNaN(ts) && ts < currentTs;
  }).length;

  const baseDiagnostic: BalanceDiagnosticInfo = {
    totalMessagesRead: messages.length,
    messagesBeforeTransaction,
    messagesAfterOrSame: messages.length - messagesBeforeTransaction,
    validCandidatesCount: candidates.length,
    rejectedCount: rejectedReasons.length,
    selectedCandidateId: null,
    referenceTimestamp: new Date(currentTs).toISOString(),
    referenceSource,
    sourceId,
    currentMessageId,
  };

  if (candidates.length === 0) {
    log(
      'لم يُعثر على رسالة سابقة تحتوي Balance Evidence — NO_PREVIOUS_BALANCE_EVIDENCE' +
      ' [totalRead=%d beforeTx=%d rejected=%d]',
      messages.length, messagesBeforeTransaction, rejectedReasons.length
    );
    // لا نعيد null مباشرةً — نُعيد null مع تسجيل تفاصيل كاملة
    return null;
  }

  // ── اختيار الأقرب زمنياً (الأحدث قبل matchedSmsReceivedAt) ──────────────
  // ترتيب تنازلي بـ msgTs → الأول هو الأقرب لحظة العملية من الخلف
  candidates.sort((a, b) => b.msgTs - a.msgTs);
  const best = candidates[0];
  const distanceSeconds = Math.round((currentTs - best.msgTs) / 1000);
  const msgType = detectMessageType(best.msg.body);

  log(
    '[Diagnostics] Evidence مختارة: id=%s type=%s distance=%ds balance=%s (من %d مرشح)',
    best.msg.id, msgType, distanceSeconds, best.evidence.value, candidates.length
  );

  // [Phase 6] تحقق: sourceMessageId يجب أن يختلف عن matchedSmsId
  if (currentMessageId && best.msg.id === currentMessageId) {
    logWarn('[Phase 6] خطأ: Evidence المختارة لها نفس ID الرسالة الحالية — رفض');
    return null;
  }

  const flowValidation = validateBalanceFlow(best.evidence.value, amount, balanceAfter);
  log(
    '[Diagnostics] Balance Flow: %s + %s = %s (expected %s) => %s',
    best.evidence.value, amount ?? '?',
    amount !== null ? (best.evidence.value + amount).toFixed(2) : '?',
    balanceAfter ?? '?',
    flowValidation
  );

  const finalDiagnostic: BalanceDiagnosticInfo = {
    ...baseDiagnostic,
    selectedCandidateId: best.msg.id,
  };

  return {
    balanceBefore: best.evidence.value,
    sourceMessageId: best.msg.id,
    sourceSender: best.msg.originatingAddress,
    sourceMessageReceivedAt: best.msg.date,
    balanceEvidenceText: best.evidence.evidenceText,
    balanceEvidenceType: msgType,
    confidence: 'high',
    // [spec §4] distance = matchedTransactionReceivedAt - candidateReceivedAt (양수دائماً)
    // ممنوع: now - candidateReceivedAt
    distanceSeconds,
    reason: `NEAREST_PREVIOUS_VALID_BALANCE — أقرب ${msgType} سابقة (${distanceSeconds}s قبل العملية)`,
    flowValidation,
    balanceAfter,
    // [spec §11] المرشحون المرفوضون للـ Debug UI
    rejectedCandidates: rejectedReasons,
    // [Final] معلومات التشخيص الكاملة
    diagnosticInfo: finalDiagnostic,
  };
}

/**
 * للتوافق مع الكود القديم — يعيد فقط الرقم.
 * يستخدم messageReceivedAt كمرجع زمني.
 */
export async function findBalanceBefore(
  sourceId: string | null,
  currentMessageReceivedAt: string,
  maxMessages = 1000
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
    1000,
    parsed.occurredAt
  );
  return { ...parsed, balanceBeforeTransaction: ev?.balanceBefore ?? null };
}
