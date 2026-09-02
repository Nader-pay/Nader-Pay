/**
 * Verification Test Lab Service
 * ─────────────────────────────
 * يسمح للمستخدم باختبار الـ Parser بـ 3 طرق:
 *  1. تحليل رسالة كاملة (الطريقة الأصلية)
 *  2. البحث برقم العملية في رسائل الهاتف
 *  3. البحث برقم الهاتف في رسائل الهاتف
 *
 * يعرض الحقول المستخرجة + BalanceEvidence كاملة + Balance Flow Validation.
 * مستقل عن UI.
 */

import type { ProviderName } from '@/types/agent';
import type { ProviderParseResult } from '@/types/provider';
import { parseMessageWithProvider, getParserInfo } from './providers';
import { looksLikeVodafoneCashSms } from './providers/vodafoneCash';
import { looksLikeInstaPaySms } from './providers/instaPay';
import {
  findBalanceEvidence,
  validateBalanceFlow as _validateBalanceFlow,
  type BalanceEvidence,
  type BalanceFlowValidation,
  type BalanceDiagnosticInfo,
} from './balanceBeforeEnricher';
import {
  searchByTransactionId,
  searchBySenderPhone,
  type TxIdSearchResult,
  type PhoneSearchResult,
} from './deviceMessageSearch';

// ─── الحقول المتوقعة لكل Provider ──────────────────────────────────────────

const EXPECTED_FIELDS: Record<ProviderName, (keyof ProviderParseResult)[]> = {
  vodafone_cash: [
    'transactionId', 'amount', 'currency', 'senderPhone',
    'senderName', 'recipientWallet', 'balanceAfterTransaction',
    'transactionDate', 'occurredAt',
  ],
  insta_pay: [
    'amount', 'currency', 'recipientAccount',
    'transactionDate', 'transferMethod',
  ],
  orange_cash: ['amount', 'currency', 'transactionId'],
  bank_transfer: ['amount', 'currency', 'transactionId'],
  unknown: [],
};

// ─── أسباب الرفض ──────────────────────────────────────────────────────────────

function detectRejectionReason(body: string, provider: ProviderName): string {
  const norm = body.toLowerCase();
  const isVFLooking = looksLikeVodafoneCashSms(body);
  const isIPLooking = looksLikeInstaPaySms(body);

  if (provider === 'vodafone_cash') {
    if (!isVFLooking) return 'الرسالة لا تنتمي لـ Vodafone Cash (لا تحتوي على كلمات مفتاحية: محفظة / vodafone cash).';
    if (!norm.includes('تم استلام') && !norm.includes('received'))
      return 'الرسالة لا تمثل استلام أموال — يجب أن تحتوي على "تم استلام". رسائل الرصيد والعروض مرفوضة.';
    if (norm.includes('تم ارسال') || norm.includes('تم إرسال'))
      return 'رسالة إرسال أموال وليست استلام — مرفوضة.';
    if (!body.match(/رقم\s*(?:العملية|المعاملة)/))
      return 'لم يُعثر على رقم العملية — مطلوب للتحقق (مثال: "رقم العملية: 022896233255").';
    if (!body.match(/(?:مبلغ|مبلغ\s+قدره)/))
      return 'لم يُعثر على المبلغ في الرسالة.';
    const hasDate = body.match(/(?:تاريخ\s+(?:العملية|المعاملة))\s*[:\s]\s*(\d{2}[\-\/]\d{2}[\-\/]\d{2,4}\s+\d{2}:\d{2}|\d{2}:\d{2}\s+\d{2}[\-\/]\d{2}[\-\/]\d{2,4})/);
    if (!hasDate)
      return 'لم يُعثر على تاريخ العملية بصيغة صحيحة. الصيغ المدعومة: "YY-MM-DD HH:MM" أو "HH:MM DD-MM-YY".';
    return 'فشل استخراج البيانات — تنسيق الرسالة غير متوقع.';
  }

  if (provider === 'insta_pay') {
    if (!isIPLooking) return 'الرسالة لا تنتمي لـ InstaPay / Banque Misr (لا تحتوي على: instapay / اضافة مبلغ / التحويل اللحظي).';
    if (!body.match(/(?:مبلغ|amount)/i))
      return 'لم يُعثر على المبلغ (مثال: "مبلغ 300EGP").';
    if (!body.match(/(?:الى\s+حساب|حساب\s+رقم|to account)/i))
      return 'لم يُعثر على رقم الحساب المستلم (مثال: "الى حساب رقم xxx4449").';
    return 'فشل استخراج البيانات — تنسيق الرسالة غير متوقع.';
  }

  return `الرسالة لا تنتمي لـ ${provider} أو تنسيقها غير مدعوم.`;
}

// ─── أنواع النتائج ────────────────────────────────────────────────────────────

export type TestLabResult = {
  valid: boolean;
  provider: ProviderName;
  transactionType: string | null;
  parserId: string;
  parserVersion: string;
  extractedFields: Partial<Record<keyof ProviderParseResult, unknown>>;
  missingFields: string[];
  rejectionReason: string | null;
  sourceIdentifier: string | null;
  /** الرصيد قبل العملية — من آخر رسالة مالية سابقة في Trusted Source */
  balanceBefore: number | null;
  /** الرصيد بعد العملية — من نص الرسالة */
  balanceAfter: number | null;
  /** المبلغ — من نص الرسالة */
  amount: number | null;
  /** BalanceEvidence كاملة مع metadata */
  balanceEvidence: BalanceEvidence | null;
  /** نتيجة التحقق الحسابي */
  flowValidation: BalanceFlowValidation;
  /** [Final] معلومات التشخيص الكاملة — متاحة حتى عند غياب Evidence */
  diagnosticInfo: import('./balanceBeforeEnricher').BalanceDiagnosticInfo | null;
  /** [Final] سبب غياب الرصيد قبل العملية — للعرض للمستخدم */
  noEvidenceReason: string | null;
};

export type TxIdLabResult = {
  searched: true;
  searchType: 'transaction_id';
  transactionId: string;
  status: TxIdSearchResult['status'];
  found: boolean;
  reason: string;
  match?: TestLabResult;
};

export type PhoneLabResult = {
  searched: true;
  searchType: 'sender_phone';
  senderPhone: string;
  status: PhoneSearchResult['status'];
  found: boolean;
  reason: string;
  matches: TestLabResult[];
};

// ─── 1. تحليل رسالة كاملة ────────────────────────────────────────────────────

export function analyzeMessageForProvider(
  body: string,
  provider: ProviderName,
  sourceIdentifier: string | null
): TestLabResult {
  const info = getParserInfo(provider);
  const parsed = parseMessageWithProvider(body, provider);

  if (!parsed) {
    return {
      valid: false,
      provider,
      transactionType: null,
      parserId: info?.parserId ?? `${provider}-parser`,
      parserVersion: info?.parserVersion ?? '—',
      extractedFields: {},
      missingFields: EXPECTED_FIELDS[provider].map(String),
      rejectionReason: detectRejectionReason(body, provider),
      sourceIdentifier,
      balanceBefore: null,
      balanceAfter: null,
      amount: null,
      balanceEvidence: null,
      flowValidation: 'BALANCE_FLOW_UNKNOWN',
      diagnosticInfo: null,
      noEvidenceReason: null,
    };
  }

  const expectedFields = EXPECTED_FIELDS[provider];
  const extracted: Partial<Record<keyof ProviderParseResult, unknown>> = {};
  const missing: string[] = [];

  for (const field of expectedFields) {
    const val = parsed[field];
    if (val !== null && val !== undefined && val !== '') {
      extracted[field] = val;
    } else {
      missing.push(String(field));
    }
  }

  return {
    valid: true,
    provider,
    transactionType: parsed.transactionType ?? null,
    parserId: parsed.parserId,
    parserVersion: parsed.parserVersion,
    extractedFields: extracted,
    missingFields: missing,
    rejectionReason: null,
    sourceIdentifier,
    balanceBefore: null,
    balanceAfter: parsed.balanceAfterTransaction ?? null,
    amount: parsed.amount ?? null,
    balanceEvidence: null,
    flowValidation: 'BALANCE_FLOW_UNKNOWN',
    diagnosticInfo: null,
    noEvidenceReason: null,
  };
}

/**
 * إثراء نتيجة التحليل بـ BalanceEvidence كاملة من Trusted Source (async).
 * يمرر currentMessageId و messageReceivedAt للبحث الزمني الصحيح.
 * [Final] يُضيف diagnosticInfo و noEvidenceReason للعرض الاحترافي.
 */
export async function enrichTestLabResult(
  result: TestLabResult,
  sourceId: string | null,
  currentMessageId?: string | null,
  currentMessageReceivedAt?: string | null
): Promise<TestLabResult> {
  if (!result.valid || result.provider !== 'vodafone_cash') return result;

  // المرجع الزمني: messageReceivedAt أولاً، fallback لـ occurredAt
  const occurredAt = result.extractedFields.occurredAt as string | undefined;
  const refTime = currentMessageReceivedAt ?? occurredAt;
  if (!refTime) {
    return {
      ...result,
      noEvidenceReason: 'لا يوجد مرجع زمني لتحديد رسائل سابقة',
      diagnosticInfo: null,
    };
  }

  const evidence = await findBalanceEvidence(
    sourceId,
    currentMessageId ?? null,
    refTime,
    result.balanceAfter,
    result.amount,
    1000,         // maxMessages — عميق للبحث التاريخي
    occurredAt    // transactionOccurredAt للـ Diagnostics
  );

  const balanceBefore = evidence?.balanceBefore ?? null;
  const flowValidation = evidence
    ? evidence.flowValidation
    : 'BALANCE_FLOW_UNKNOWN';

  // بناء noEvidenceReason احترافية من diagnosticInfo
  let noEvidenceReason: string | null = null;
  const diag = evidence?.diagnosticInfo ?? null;
  if (balanceBefore === null && result.balanceAfter !== null) {
    if (!sourceId) {
      noEvidenceReason = 'لم يتم تحديد مصدر SMS موثوق — وثّق مصدراً أولاً من إعدادات مصادر الدفع';
    } else if (diag && diag.totalMessagesRead === 0) {
      noEvidenceReason = 'لا توجد رسائل في المصدر الموثوق';
    } else if (diag && diag.messagesBeforeTransaction === 0) {
      noEvidenceReason = `قُرئت ${diag.totalMessagesRead} رسالة — لا توجد رسائل سابقة لوقت العملية`;
    } else if (diag && diag.validCandidatesCount === 0 && diag.rejectedCount > 0) {
      noEvidenceReason = `قُرئت ${diag.totalMessagesRead} رسالة، ${diag.messagesBeforeTransaction} سابقة — جميعها مرفوضة (${diag.rejectedCount} رسالة بدون رصيد صالح)`;
    } else {
      noEvidenceReason = 'لم يُعثر على رسالة سابقة تحتوي رصيداً قابلاً للتحقق';
    }
  }

  return {
    ...result,
    balanceBefore,
    balanceEvidence: evidence,
    flowValidation,
    diagnosticInfo: diag,
    noEvidenceReason,
  };
}

// ─── 2. البحث برقم العملية ───────────────────────────────────────────────────

export async function searchByTxIdInDevice(
  transactionId: string,
  provider: ProviderName,
  sourceIdentifier: string | null
): Promise<TxIdLabResult> {
  const result = await searchByTransactionId({
    provider,
    transactionId: transactionId.trim(),
    trustedSourceId: sourceIdentifier,
    maxMessages: 400,
  });

  if (!result.found || !result.match) {
    return {
      searched: true,
      searchType: 'transaction_id',
      transactionId,
      status: result.status,
      found: false,
      reason: result.reason ?? 'لم يُعثر على رقم العملية',
    };
  }

  const labResult = analyzeMessageForProvider(
    result.match.originalBody,
    provider,
    result.match.sender
  );
  const enriched = await enrichTestLabResult(
    labResult,
    sourceIdentifier,
    result.match.smsId,          // currentMessageId — من SMS Content Provider (يمنع اختيار نفس الرسالة)
    result.match.receivedAt      // messageReceivedAt من SMS Content Provider
  );

  return {
    searched: true,
    searchType: 'transaction_id',
    transactionId,
    status: result.status,
    found: true,
    reason: `وُجدت رسالة تطابق رقم العملية ${transactionId}`,
    match: enriched,
  };
}

// ─── 3. البحث برقم الهاتف ────────────────────────────────────────────────────

export async function searchByPhoneInDevice(
  senderPhone: string,
  provider: ProviderName,
  sourceIdentifier: string | null
): Promise<PhoneLabResult> {
  const result = await searchBySenderPhone({
    provider,
    senderPhone: senderPhone.trim(),
    trustedSourceId: sourceIdentifier,
    maxMessages: 400,
  });

  if (!result.found || result.matches.length === 0) {
    return {
      searched: true,
      searchType: 'sender_phone',
      senderPhone,
      status: result.status,
      found: false,
      reason: result.reason ?? 'لم يُعثر على رسائل من هذا الرقم',
      matches: [],
    };
  }

  const labMatches: TestLabResult[] = [];
  for (const m of result.matches.slice(0, 10)) {
    const labResult = analyzeMessageForProvider(m.originalBody, provider, m.sender);
    const enriched = await enrichTestLabResult(
      labResult,
      sourceIdentifier,
      m.smsId,       // currentMessageId — من SMS Content Provider (يمنع اختيار نفس الرسالة)
      m.receivedAt   // messageReceivedAt من SMS Content Provider
    );
    labMatches.push(enriched);
  }

  return {
    searched: true,
    searchType: 'sender_phone',
    senderPhone,
    status: result.status,
    found: true,
    reason: `وُجدت ${labMatches.length} رسالة من ${senderPhone}`,
    matches: labMatches,
  };
}

// (end of file)
