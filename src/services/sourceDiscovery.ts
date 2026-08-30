import { readExistingPaymentMessages } from './smsReader';
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

/**
 * اكتشاف مصادر SMS المحتملة. تقرأ الرسائل من Android SMS Provider،
 * تجمّعها حسب المرسل، وتصفّفها حسب Provider.
 * لا تُعامَل الرسائل كملفات؛ نستخدم بيانات Android SMS Provider فقط.
 */
export async function discoverSmsSources(): Promise<SmsSource[]> {
  if (process.env.EXPO_OS === 'web') {
    return [];
  }

  const messages = await readExistingPaymentMessages(500);
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
    const providerHint = detectProvider(latest.body);

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
 * تجربة توثيق مصدر مباشرة: نفحص رسائل المصدر بالـ Parser الخاص بالـ Provider.
 * نحسب نسبة النجاح ونُرجع النتيجة.
 */
export async function verifySourceWithParser(
  source: SmsSource,
  provider: ProviderName
): Promise<{ passed: boolean; reason: string; sampleCount: number; successCount: number }> {
  const { parseMessage } = await import('./providers');
  let successCount = 0;
  const samples = source.rawMessages.slice(0, 5);
  for (const message of samples) {
    const parsed = parseMessage(message.body);
    if (parsed && parsed.provider === provider) {
      if (parsed.amount && parsed.transactionId) {
        successCount += 1;
      }
    }
  }

  if (successCount === 0) {
    return {
      passed: false,
      reason: 'لم يتمكن الـ Parser من استخراج المبلغ ورقم العملية من رسائل المصدر.',
      sampleCount: samples.length,
      successCount: 0,
    };
  }

  const ratio = successCount / samples.length;
  if (ratio >= 0.5) {
    return {
      passed: true,
      reason: `تم التعرف على ${successCount}/${samples.length} رسائل بنجاح.`,
      sampleCount: samples.length,
      successCount,
    };
  }

  return {
    passed: false,
    reason: `نسبة النجاح منخفضة (${Math.round(ratio * 100)}%). يرجى اختيار مصدر آخر.`,
    sampleCount: samples.length,
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
