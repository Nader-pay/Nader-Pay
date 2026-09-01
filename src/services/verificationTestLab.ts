/**
 * Verification Test Lab Service
 * ─────────────────────────────
 * يسمح للمستخدم بلصق رسالة حقيقية وتحليلها بـ Parser الخاص بـ Provider معين.
 * يعرض جميع الحقول المستخرجة والمفقودة + سبب الرفض + parser version + source.
 * مستقل عن UI — يُستدعى من شاشة Test Lab.
 */

import type { ProviderName } from '@/types/agent';
import type { ProviderParseResult } from '@/types/provider';
import { parseMessageWithProvider, getParserInfo } from './providers';
import { looksLikeVodafoneCashSms } from './providers/vodafoneCash';
import { looksLikeInstaPaySms } from './providers/instaPay';

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

// ─── أسباب الرفض المحتملة ───────────────────────────────────────────────────

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
    // فحص تنسيق التاريخ تحديداً
    const hasDate = body.match(/(?:تاريخ\s+(?:العملية|المعاملة))\s*[:\s]\s*(\d{2}[\-\/]\d{2}[\-\/]\d{2,4}\s+\d{2}:\d{2}|\d{2}:\d{2}\s+\d{2}[\-\/]\d{2}[\-\/]\d{2,4})/);
    if (!hasDate)
      return 'لم يُعثر على تاريخ العملية بصيغة صحيحة. الصيغ المدعومة: "YY-MM-DD HH:MM" مثال (21-08-26 00:15) أو "HH:MM DD-MM-YY".';
    return 'فشل استخراج البيانات — تنسيق الرسالة غير متوقع. تأكد من وجود: تم استلام / المبلغ / رقم المحفظة / تاريخ العملية / رقم العملية.';
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

// ─── نتيجة التحليل ──────────────────────────────────────────────────────────

export type TestLabResult = {
  valid: boolean;
  provider: ProviderName;
  transactionType: string | null;
  parserId: string;
  parserVersion: string;
  /** الحقول التي تم استخراجها بنجاح */
  extractedFields: Partial<Record<keyof ProviderParseResult, unknown>>;
  /** الحقول التي لم يُعثر عليها */
  missingFields: string[];
  /** سبب الرفض إذا لم تكن رسالة دفع */
  rejectionReason: string | null;
  /** الـ source المستخدم في التحليل */
  sourceIdentifier: string | null;
};

/**
 * حلّل رسالة بـ Parser الخاص بـ Provider المحدد وأعد تقرير مفصّل.
 */
export function analyzeMessageForProvider(
  message: string,
  provider: ProviderName,
  sourceIdentifier?: string | null
): TestLabResult {
  const parserInfo = getParserInfo(provider) ?? { parserId: provider, parserVersion: '1' };
  const parsed: ProviderParseResult | null = parseMessageWithProvider(message, provider);

  if (!parsed) {
    return {
      valid: false,
      provider,
      transactionType: null,
      parserId: parserInfo.parserId,
      parserVersion: parserInfo.parserVersion,
      extractedFields: {},
      missingFields: EXPECTED_FIELDS[provider].map(String),
      rejectionReason: detectRejectionReason(message, provider),
      sourceIdentifier: sourceIdentifier ?? null,
    };
  }

  // الحقول المستخرجة
  const extractedFields: Partial<Record<keyof ProviderParseResult, unknown>> = {};
  const missingFields: string[] = [];

  for (const field of EXPECTED_FIELDS[provider]) {
    const val = parsed[field];
    if (val !== null && val !== undefined && val !== '') {
      extractedFields[field] = val;
    } else {
      missingFields.push(String(field));
    }
  }

  return {
    valid: true,
    provider,
    transactionType: parsed.transactionType ?? null,
    parserId: parsed.parserId,
    parserVersion: parsed.parserVersion,
    extractedFields,
    missingFields,
    rejectionReason: null,
    sourceIdentifier: sourceIdentifier ?? null,
  };
}
