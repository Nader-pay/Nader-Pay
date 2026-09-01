import { readAllInboxMessages, readExistingPaymentMessages } from './smsReader';
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
