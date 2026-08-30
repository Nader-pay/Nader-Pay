import type { AgentSettings, ProviderName } from '@/types/agent';

export type SourceVerificationResult =
  | { ok: true; provider: ProviderName }
  | { ok: false; reason: string; provider?: ProviderName };

const PROVIDER_HINTS: Record<ProviderName, string[]> = {
  vodafone_cash: ['vodafone cash', 'فودافون كاش', 'فودافون'],
  orange_cash: ['orange cash', 'أورانج كاش', 'orange'],
  insta_pay: ['instapay', 'insta pay', 'ipn'],
  bank_transfer: ['bank', 'بنك', 'transfer', 'تحويل'],
  unknown: [],
};

/**
 * تحقق من مصدر رسالة SMS: المزود مفعّل، العنوان/المُرسل مطابق، وإما نمط أو قاعدة معروفة.
 */
export function verifyMessageSource(
  message: { body: string; originatingAddress: string },
  settings: AgentSettings
): SourceVerificationResult {
  const bodyLower = message.body.toLowerCase();
  const sender = message.originatingAddress?.toLowerCase() || '';

  // Fallback mode: لو التحقق من المصدر مطفيّ أو مفيش قواعد/أنماط مضبوطة،
  // نسمح للرسالة تعدي عشان التطبيق يشتغل من أول تثبيت من غير مصادر مضافة.
  const providers: ProviderName[] = ['vodafone_cash', 'orange_cash', 'insta_pay', 'bank_transfer'];
  const hasConfiguredRules = providers.some((p) => {
    const config = settings.providers[p];
    return config?.enabled && (config.sourceRules.length > 0 || config.messagePatterns.length > 0);
  });

  if (!settings.requireSourceVerification || !hasConfiguredRules) {
    return { ok: true, provider: 'unknown' };
  }

  for (const p of providers) {
    const config = settings.providers[p];
    if (!config || !config.enabled) continue;

    // 1) Detect by sender hints
    const hints = PROVIDER_HINTS[p] || [];
    const hintMatch = hints.some((id) => sender.includes(id) || bodyLower.includes(id));

    // 2) Explicit source rules
    const ruleMatch = config.sourceRules.some((rule) => {
      const value = rule.value.toLowerCase();
      if (rule.type === 'phone') {
        const senderDigits = sender.replace(/\D/g, '');
        const ruleDigits = value.replace(/\D/g, '');
        if (rule.match === 'exact') return senderDigits === ruleDigits;
        if (rule.match === 'prefix') return senderDigits.startsWith(ruleDigits);
        return senderDigits.includes(ruleDigits);
      }
      if (rule.match === 'exact') return sender === value;
      if (rule.match === 'prefix') return sender.startsWith(value);
      return sender.includes(value);
    });

    // 3) Message patterns (case-insensitive, use exact regex if supported)
    const patternMatch = config.messagePatterns.some((pattern) => {
      try {
        const re = new RegExp(pattern, 'i');
        return re.test(message.body);
      } catch {
        return message.body.toLowerCase().includes(pattern.toLowerCase());
      }
    });

    if (hintMatch || ruleMatch || patternMatch) {
      return { ok: true, provider: p };
    }
  }

  return {
    ok: false,
    reason: 'الرسالة لا تطابق أي مصدر موثوق مفعّل. تحقق من رقم/اسم المُرسل وقواعد المزود.',
  };
}
