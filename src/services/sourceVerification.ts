// التحقق من مصادر رسائل SMS قبل معالجتها
// يتحقق من قاعدة البيانات المحلية — لا يحتاج إنترنت

import { isSourceVerified } from '@/services/localSmsIndex';
import type { SmsMessage } from '@/types/agent';
import type { SourceVerificationResult } from '@/types/provider';

/**
 * يتحقق من أن المرسل (originatingAddress) مصدر موثوق ومفعّل
 * لمزوّد معيّن (مثل vodafone_cash).
 * يعيد { ok: true } إذا كان المصدر موثّقًا ومفعّلًا، أو { ok: false } مع السبب.
 */
export async function verifyMessageSource(
  message: SmsMessage,
  provider: string
): Promise<SourceVerificationResult> {
  const sourceId = normalizeAddress(message.originatingAddress);

  if (!sourceId) {
    return {
      ok: false,
      provider,
      sourceId: message.originatingAddress,
      reason: 'عنوان المرسل فارغ أو غير صالح',
    };
  }

  const verified = await isSourceVerified(provider, sourceId);

  if (!verified) {
    return {
      ok: false,
      provider,
      sourceId,
      reason: `المصدر "${sourceId}" غير موثّق لـ ${provider}`,
    };
  }

  return {
    ok: true,
    provider,
    sourceId,
  };
}

/**
 * تطبيع عنوان المرسل: إزالة المسافات وتوحيد الأرقام
 */
function normalizeAddress(address: string): string | null {
  if (!address) return null;
  // Sender name (مثل VFCash أو Vodafone)
  const trimmed = address.trim();
  if (trimmed.length === 0) return null;
  return trimmed;
}
