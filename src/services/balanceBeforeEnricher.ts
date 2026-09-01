/**
 * balanceBeforeEnricher.ts
 * ════════════════════════════════════════════════════════════════
 * يحسب balanceBefore لعملية Vodafone Cash من الرسالة المالية
 * الحقيقية السابقة الموجودة في نفس Trusted Source.
 *
 * القواعد:
 *  1. يبحث فقط داخل Trusted SMS Source الخاص بـ Provider.
 *  2. يستخدم فقط رسائل سابقة (أقدم من transactionDateTime).
 *  3. يستخرج "رصيدك الحالي" من رسائل مالية صالحة (Incoming أو Balance).
 *  4. يأخذ الأقرب زمنياً قبل العملية.
 *  5. لا يخمّن — إذا لم يجد رسالة صالحة يُعيد null.
 *  6. لا يستخدم رسالة لاحقة للعملية كـ balanceBefore.
 * ════════════════════════════════════════════════════════════════
 */

import type { SmsMessage } from '@/types/agent';
import { readMessagesFromSources } from './smsReader';

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

function toEnDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/**
 * استخرج "رصيدك الحالي" من نص رسالة مالية.
 * يعمل مع رسائل Incoming Payment وBalance-only.
 * لا يعمل مع رسائل عروض أو غير مالية.
 */
export function extractBalanceFromMessage(body: string): number | null {
  if (!body?.trim()) return null;
  const norm = normalizeArabic(toEnDigits(body));
  const m = norm.match(/(?:رصيدك\s+الحالي|الرصيد\s+الحالي|رصيدك)\s*[:\s]\s*([\d,]+(?:\.\d+)?)/i);
  if (!m) return null;
  const val = parseFloat(toEnDigits(m[1]).replace(/,/g, ''));
  return isNaN(val) ? null : val;
}

/**
 * هل الرسالة مالية صالحة لاستخراج الرصيد منها؟
 * (رسالة Incoming أو Balance-only من Vodafone Cash)
 */
function isFinancialVFMessage(body: string): boolean {
  const lower = body.toLowerCase();
  const norm = normalizeArabic(body);
  // يجب أن تكون من Vodafone Cash
  const isVF =
    lower.includes('vodafone cash') ||
    lower.includes('vodafonecash') ||
    norm.includes('فودافون كاش') ||
    norm.includes('محفظتك');
  if (!isVF) return false;
  // يجب أن تحتوي على رصيد
  return extractBalanceFromMessage(body) !== null;
}

/**
 * البحث عن balanceBefore من رسائل Trusted Source السابقة.
 *
 * @param sourceId      - معرّف الـ Trusted SMS Source
 * @param beforeIso     - ISO timestamp للعملية الحالية (نبحث عن رسائل أقدم منه)
 * @param maxMessages   - الحد الأقصى للرسائل المقروءة
 *
 * @returns الرصيد من آخر رسالة مالية صالحة قبل العملية، أو null
 */
export async function findBalanceBefore(
  sourceId: string | null,
  beforeIso: string,
  maxMessages = 200
): Promise<number | null> {
  if (process.env.EXPO_OS !== 'android') return null;
  if (!sourceId) return null;

  const beforeTs = new Date(beforeIso).getTime();
  if (isNaN(beforeTs)) return null;

  let messages: SmsMessage[];
  try {
    messages = await readMessagesFromSources([sourceId], maxMessages);
  } catch {
    return null;
  }

  // فلتر: أقدم من العملية الحالية فقط، وتحتوي على رصيد
  const candidates = messages
    .filter((msg) => {
      const ts = new Date(msg.date).getTime();
      return !isNaN(ts) && ts < beforeTs && isFinancialVFMessage(msg.body);
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // الأحدث أولاً

  if (candidates.length === 0) return null;

  // أقرب رسالة مالية قبل العملية
  return extractBalanceFromMessage(candidates[0].body);
}

/**
 * إثراء ProviderParseResult بـ balanceBefore من Trusted Source.
 * تُستخدم بعد Parse الرسالة مباشرة قبل بناء NormalizedTransaction.
 */
export async function enrichWithBalanceBefore<T extends { balanceBeforeTransaction: number | null; occurredAt: string }>(
  parsed: T,
  sourceId: string | null
): Promise<T> {
  if (parsed.balanceBeforeTransaction !== null) return parsed; // مُعيَّن مسبقاً
  const balanceBefore = await findBalanceBefore(sourceId, parsed.occurredAt);
  return { ...parsed, balanceBeforeTransaction: balanceBefore };
}
