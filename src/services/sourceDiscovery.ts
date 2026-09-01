import { readAllInboxMessages } from './smsReader';
import { detectProvider } from './providers';
import type { ProviderName, SmsMessage } from '@/types/agent';

export type SmsSource = {
  sourceId: string;
  displayName: string;
  sourceType: 'sms';
  messageCount: number;
  lastMessageAt: string;
  lastMessageSummary: string;
  providerHint: ProviderName;
  rawMessages: SmsMessage[];
};

// ─── Message Classification ────────────────────────────────────────────────────

export type MessageClass =
  | 'TRANSACTION'       // مبلغ + رقم عملية
  | 'BALANCE'           // رصيد بدون معاملة
  | 'OTHER_FINANCIAL'   // مالية لكن لا تحتوي Transaction
  | 'NON_FINANCIAL';    // ترويجية أو غير مالية

const TRANSACTION_KW = ['تم استلام', 'تم ارسال', 'تم إرسال', 'received', 'sent', 'payment', 'رقم العملية', 'transaction'];
const BALANCE_KW     = ['رصيد', 'balance'];
const FINANCIAL_KW   = ['مبلغ', 'جنيه', 'egp', 'شحن', 'دفع', 'تحويل', 'إيداع', 'خصم'];

export function classifyMessage(body: string): MessageClass {
  const b = body.toLowerCase();
  const hasTxId = /(?:رقم العملية|transaction[:\s#]|رقم المعامله)[:\s#]*[\d٠-٩]{6,}/i.test(body);
  const hasAmount = /(?:مبلغ|amount)[:\s]*[\d٠-٩.,]+/i.test(body) ||
                    /[\d٠-٩.,]+\s*(?:جنيه|egp)/i.test(body);

  if (hasTxId && hasAmount) return 'TRANSACTION';
  if (BALANCE_KW.some((k) => b.includes(k))) return 'BALANCE';
  if (FINANCIAL_KW.some((k) => b.includes(k))) return 'OTHER_FINANCIAL';
  if (TRANSACTION_KW.some((k) => b.includes(k))) return 'TRANSACTION';
  return 'NON_FINANCIAL';
}

// ─── Verification Result ───────────────────────────────────────────────────────

/**
 * نتيجة توثيق مفصلة — Source Identity مستقل عن Parser.
 *
 * Source Identity Verification:
 *   VERIFIED = المصدر له رسائل وهويته واضحة
 *   UNVERIFIED = المصدر فارغ أو غير معروف
 *
 * Message Access:
 *   AVAILABLE = قرأنا الرسائل
 *   UNAVAILABLE = خطأ قراءة أو صفر رسائل
 *
 * Transaction Sample:
 *   FOUND = وجدنا رسالة Transaction مناسبة
 *   NOT_FOUND = لم نجد — وهذا مقبول ولا يعني فشل المصدر
 *
 * Parser Validation:
 *   PASSED = Parser استخرج amount + transactionId
 *   FAILED = Parser فشل في رسالة Transaction موجودة
 *   NOT_TESTED = لا يوجد Transaction sample
 */
export type SmsSourceVerificationResult = {
  // هوية المصدر
  identityStatus: 'VERIFIED' | 'UNVERIFIED';
  rawSourceId: string;
  normalizedSourceId: string;
  messageCount: number;

  // الوصول للرسائل
  messageAccessStatus: 'AVAILABLE' | 'UNAVAILABLE';

  // تصنيف الرسائل
  classificationSummary: {
    transaction: number;
    balance: number;
    otherFinancial: number;
    nonFinancial: number;
  };

  // عينة Parser
  transactionSampleStatus: 'FOUND' | 'NOT_FOUND';
  transactionSampleBody?: string;

  // Parser
  parserStatus: 'PASSED' | 'FAILED' | 'NOT_TESTED';
  parserDetails: string;

  // النتيجة الإجمالية
  passed: boolean;
  reason: string;

  // للتوافق مع الكود القديم
  sampleCount: number;
  successCount: number;
};

/**
 * اكتشاف مصادر SMS المحتملة. تقرأ **كل** رسائل الـ inbox من Android SMS Provider،
 * تجمّعها حسب المرسل/العنوان، وتصفّفها حسب Provider.
 *
 * مهم: نستخدم readAllInboxMessages وليس readExistingPaymentMessages
 * لأن الأخيرة تُفلتر رسائل المصادر غير المعروفة مسبقاً — مما يمنع اكتشاف
 * مصادر جديدة كـ VF-Cash وBanque Misr قبل توثيقها.
 */
export async function discoverSmsSources(): Promise<SmsSource[]> {
  if (process.env.EXPO_OS === 'web') {
    return [];
  }

  // قراءة كل الرسائل بدون فلترة لاكتشاف جميع المصادر
  const messages = await readAllInboxMessages(500);
  const bySource = new Map<string, SmsMessage[]>();

  for (const message of messages) {
    const key = normalizeSender(message.originatingAddress);
    const list = bySource.get(key);
    if (list) {
      list.push(message);
    } else {
      bySource.set(key, [message]);
    }
  }

  const sources: SmsSource[] = [];
  for (const [sourceId, list] of bySource) {
    const sorted = [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latest = sorted[0];
    // اكتشاف Provider من أكثر الرسائل تطابقاً (وليس فقط الأخيرة)
    const providerHint = detectDominantProvider(sorted.slice(0, 10));

    sources.push({
      sourceId,
      displayName: sourceId,
      sourceType: 'sms',
      messageCount: sorted.length,
      lastMessageAt: latest.date,
      lastMessageSummary: truncate(latest.body, 80),
      providerHint,
      rawMessages: sorted.slice(0, 10),
    });
  }

  return sources.sort((a, b) => b.messageCount - a.messageCount);
}

/**
 * حدد Provider السائد من مجموعة رسائل.
 * يستخدم تصويت الأغلبية بدلاً من أخذ أول رسالة فقط.
 */
function detectDominantProvider(messages: SmsMessage[]): ProviderName {
  const counts = new Map<ProviderName, number>();
  for (const m of messages) {
    const p = detectProvider(m.body);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best: ProviderName = 'unknown';
  let bestCount = 0;
  for (const [p, c] of counts) {
    if (p !== 'unknown' && c > bestCount) {
      best = p;
      bestCount = c;
    }
  }
  return best;
}

/**
 * توثيق مصدر SMS — Flow المُصلَح (المرحلة 5):
 *
 * 1. Source Identity Verification  — مستقل عن Parser
 * 2. Message Access                — هل نستطيع قراءة الرسائل؟
 * 3. Message Classification        — TRANSACTION/BALANCE/OTHER/NON
 * 4. Transaction Sample Search     — ابحث عن رسالة Transaction مناسبة فقط
 * 5. Parser Validation             — شغّل Parser على sample إن وُجد
 *
 * القاعدة الجوهرية: NOT_FOUND sample ≠ INVALID source
 * مصدر بـ 171 رسالة Recharge+Balance يُوثَّق حتى لو لم تُوجد Transaction sample.
 */
export async function verifySourceWithParser(
  source: SmsSource,
  provider: ProviderName
): Promise<SmsSourceVerificationResult> {
  const { parseMessage } = await import('./providers');

  // ── 1. Source Identity ──────────────────────────────────────────────────────
  const identityStatus: SmsSourceVerificationResult['identityStatus'] =
    source.messageCount > 0 && source.sourceId.length > 0 ? 'VERIFIED' : 'UNVERIFIED';

  // ── 2. Message Access ───────────────────────────────────────────────────────
  // نستخدم rawMessages (تصل لـ 10 كعينة) ونكمّل من readAllInboxMessages عند الحاجة
  const allMessages = source.rawMessages;
  const messageAccessStatus: SmsSourceVerificationResult['messageAccessStatus'] =
    allMessages.length > 0 ? 'AVAILABLE' : 'UNAVAILABLE';

  // ── 3. تصنيف الرسائل ────────────────────────────────────────────────────────
  const summary = { transaction: 0, balance: 0, otherFinancial: 0, nonFinancial: 0 };
  for (const m of allMessages) {
    const cls = classifyMessage(m.body);
    if (cls === 'TRANSACTION')     summary.transaction++;
    else if (cls === 'BALANCE')    summary.balance++;
    else if (cls === 'OTHER_FINANCIAL') summary.otherFinancial++;
    else                           summary.nonFinancial++;
  }

  if (__DEV__) {
    console.log(`[sourceDiscovery] تصنيف ${source.sourceId}:`, summary);
  }

  // ── 4. Transaction Sample ───────────────────────────────────────────────────
  // ابحث عن رسالة TRANSACTION فقط — لا تأخذ آخر رسالة عشوائية
  const txMessages = allMessages.filter((m) => classifyMessage(m.body) === 'TRANSACTION');
  const transactionSampleStatus: SmsSourceVerificationResult['transactionSampleStatus'] =
    txMessages.length > 0 ? 'FOUND' : 'NOT_FOUND';
  const sampleMsg = txMessages[0];

  if (__DEV__) {
    console.log(`[sourceDiscovery] Transaction sample:`, transactionSampleStatus,
      sampleMsg ? sampleMsg.body.slice(0, 80) : '—');
  }

  // ── 5. Parser Validation ────────────────────────────────────────────────────
  let parserStatus: SmsSourceVerificationResult['parserStatus'] = 'NOT_TESTED';
  let parserDetails = 'لا توجد رسالة Transaction لاختبار الـ Parser.';
  let successCount = 0;

  if (sampleMsg) {
    const parsed = parseMessage(sampleMsg.body);
    if (parsed && parsed.provider === provider && parsed.amount && parsed.transactionId) {
      parserStatus = 'PASSED';
      parserDetails = `تم استخراج المبلغ ${parsed.amount} جنيه ورقم العملية ${parsed.transactionId}.`;
      successCount = 1;
    } else {
      // حاول على بقية رسائل Transaction
      let tried = 1;
      for (const m of txMessages.slice(1, 5)) {
        tried++;
        const p2 = parseMessage(m.body);
        if (p2 && p2.provider === provider && p2.amount && p2.transactionId) {
          parserStatus = 'PASSED';
          parserDetails = `تم استخراج المبلغ ${p2.amount} جنيه ورقم العملية ${p2.transactionId} (من رسالة ${tried}).`;
          successCount = 1;
          break;
        }
      }
      if (parserStatus !== 'PASSED') {
        parserStatus = 'FAILED';
        parserDetails = `الـ Parser لم يستخرج amount+transactionId من ${Math.min(txMessages.length, 5)} رسالة Transaction.`;
      }
    }
  }

  // ── النتيجة الإجمالية ────────────────────────────────────────────────────────
  // المصدر يُوثَّق إذا:
  //   - هويته محددة (identityStatus = VERIFIED)
  //   - يمكن قراءة رسائله (messageAccessStatus = AVAILABLE)
  // Parser failure أو NOT_FOUND sample لا يُفشل المصدر
  const passed = identityStatus === 'VERIFIED' && messageAccessStatus === 'AVAILABLE';

  let reason: string;
  if (!passed) {
    reason = identityStatus === 'UNVERIFIED'
      ? 'المصدر غير معروف أو فارغ — يرجى اختيار مصدر آخر.'
      : 'تعذّرت قراءة رسائل المصدر — تحقق من صلاحية SMS.';
  } else if (parserStatus === 'PASSED') {
    reason = `مصدر موثَّق ✓ — الهوية مؤكدة، قراءة الرسائل ناجحة، Parser اختُبر بنجاح.`;
  } else if (parserStatus === 'NOT_TESTED') {
    reason = `مصدر موثَّق ✓ — الهوية مؤكدة، قراءة الرسائل ناجحة. لا توجد رسالة Transaction حالياً لاختبار الـ Parser.`;
  } else {
    reason = `مصدر موثَّق ✓ — الهوية مؤكدة، قراءة الرسائل ناجحة. Parser لم يتعرف على رسائل Transaction الحالية.`;
  }

  return {
    identityStatus,
    rawSourceId: source.sourceId,
    normalizedSourceId: normalizeSender(source.sourceId),
    messageCount: source.messageCount,
    messageAccessStatus,
    classificationSummary: summary,
    transactionSampleStatus,
    transactionSampleBody: sampleMsg?.body.slice(0, 120),
    parserStatus,
    parserDetails,
    passed,
    reason,
    sampleCount: txMessages.length,
    successCount,
  };
}

function normalizeSender(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, '');
}

function truncate(text: string, length: number): string {
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
