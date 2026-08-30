// التحقق من مصادر رسائل SMS قبل معالجتها
// يتحقق من قاعدة البيانات المحلية — لا يحتاج إنترنت
//
// منطق التحقق:
//   - إذا لم يُضَف أي مصدر بعد → يسمح بالمرور (fallback mode)
//   - إذا يوجد مصادر مضافة → يتحقق أن المرسل في القائمة ومفعَّل
//   - هذا يضمن أن الوكيل يعمل فور التثبيت، والتحقق يُفعَّل تدريجياً

import { isSourceVerified, getProviderSources } from '@/services/localSmsIndex';
import type { SmsMessage } from '@/types/agent';
import type { SourceVerificationResult } from '@/types/provider';

/**
 * يتحقق من أن المرسل (originatingAddress) مصدر موثوق ومفعّل.
 *
 * إذا لم يكن هناك أي مصدر مضاف لهذا المزوّد بعد →
 *   يعيد ok=true (fallback mode) حتى يُضيف المستخدم مصادر.
 * إذا يوجد مصادر مضافة →
 *   يتحقق أن المرسل في القائمة ومفعَّل.
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

  // fallback: إذا لا يوجد أي مصدر مضاف → اسمح بالمرور
  const allSources = await getProviderSources(provider);
  if (allSources.length === 0) {
    return {
      ok: true,
      provider,
      sourceId,
      reason: 'وضع الاستقبال الكامل — لم تُضَف مصادر بعد',
    };
  }

  // يوجد مصادر → تحقق أن هذا المصدر موثّق ومفعّل
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
