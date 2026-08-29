import type { ProviderName, SourceVerificationResult } from '@/types/provider';
import { detectProvider } from './providers';
import {
  getVerifiedProviderSource,
  updateProviderSourceLastMessage,
} from '@/lib/database';
import { detectSourceType, normalizeSourceAddress } from './providerSourceService';

/**
 * تحقق من مصدر رسالة SMS: تحديد المزود من نص الرسالة، ثم التأكد من أن المُرسل
 * يطابق المصدر الموثق المخزن في قاعدة البيانات. لا يعتمد على الإعدادات القديمة
 * ولا يعتبر أي مزود مفعّلًا افتراضيًا.
 */
export async function verifyMessageSource(
  message: { body: string; originatingAddress: string; date?: string },
  provider?: ProviderName
): Promise<SourceVerificationResult> {
  const detected = provider ?? detectProvider(message.body);

  if (detected === 'unknown') {
    return {
      ok: false,
      reason: 'لا يمكن تحديد المزود من نص الرسالة.',
    };
  }

  const verified = await getVerifiedProviderSource(detected);
  if (!verified) {
    return {
      ok: false,
      reason: `المزود ${detected} لا يملك مصدر SMS موثق. يرجى توثيق المصدر أولاً.`,
      provider: detected,
    };
  }

  const sourceType = (verified.source_type as 'phone' | 'sender_name' | 'short_code') ?? 'unknown';
  const normalizedSender = normalizeSourceAddress(message.originatingAddress, sourceType);

  if (normalizedSender !== verified.source_id) {
    return {
      ok: false,
      reason: `المُرسل ${message.originatingAddress} لا يطابق المصدر الموثق ${verified.source_id}.`,
      provider: detected,
      sourceId: verified.source_id,
    };
  }

  if (message.date) {
    await updateProviderSourceLastMessage(
      detected,
      verified.source_id,
      message.date,
      message.body.slice(0, 120)
    );
  }

  return {
    ok: true,
    provider: detected,
    sourceId: verified.source_id,
  };
}
