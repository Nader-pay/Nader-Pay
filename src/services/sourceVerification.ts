import { getVerifiedProviderSources } from '@/lib/database';
import type { ProviderName } from '@/types/agent';

export type SourceVerificationResult =
  | { ok: true; provider: ProviderName }
  | { ok: false; reason: string; provider?: ProviderName };

export type VerifiedSource = {
  providerId: string;
  sourceId: string;
  sourceType: string;
  sourceMetadata?: string | null;
};

const PROVIDER_HINTS: Record<ProviderName, string[]> = {
  vodafone_cash: ['vodafone cash', 'فودافون كاش', 'فودافون'],
  orange_cash: ['orange cash', 'أورانج كاش', 'orange'],
  insta_pay: ['instapay', 'insta pay', 'ipn'],
  bank_transfer: ['bank', 'بنك', 'transfer', 'تحويل'],
  unknown: [],
};

/**
 * تحقق من مصدر رسالة SMS ضد مصادر موثقة في قاعدة البيانات.
 * لا يُعتمد على الإعدادات فقط؛ لا يُمرر إلا إذا وُجد مصدر موثق للـ Provider.
 */
export async function verifyMessageSource(
  message: { body: string; originatingAddress: string },
  requireSourceVerification: boolean
): Promise<SourceVerificationResult> {
  if (!requireSourceVerification) {
    return { ok: true, provider: 'unknown' };
  }

  const verified = await getVerifiedProviderSources();
  if (verified.length === 0) {
    return {
      ok: false,
      reason: 'لا يوجد مصدر SMS موثق. يرجى توثيق مصدر من شاشة مصادر الدفع أولاً.',
    };
  }

  const sender = normalizeSender(message.originatingAddress);
  const bodyLower = message.body.toLowerCase();

  for (const source of verified) {
    const sourceId = normalizeSender(source.source_id);
    const providerId = source.provider_id as ProviderName;

    // 1) Match by sender address
    if (sender && sourceId && sender.includes(sourceId)) {
      return { ok: true, provider: providerId };
    }

    // 2) Match by approved sender identifiers
    const approved = parseArray(source.approved_sender_identifiers);
    if (approved.some((id) => sender.includes(normalizeSender(id)) || bodyLower.includes(id.toLowerCase()))) {
      return { ok: true, provider: providerId };
    }

    // 3) Match by message patterns
    const patterns = parseArray(source.message_patterns);
    if (patterns.some((p) => matchPattern(message.body, p))) {
      return { ok: true, provider: providerId };
    }

    // 4) Fallback provider hints
    const hints = PROVIDER_HINTS[providerId] ?? [];
    if (hints.some((h) => sender.includes(h) || bodyLower.includes(h))) {
      return { ok: true, provider: providerId };
    }
  }

  return {
    ok: false,
    reason: 'الرسالة لا تأتي من مصدر موثق. سيتم تسجيلها كمصدر غير موثوق.',
  };
}

function normalizeSender(address: string): string {
  return (address ?? '').toLowerCase().replace(/\D/g, '');
}

function parseArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function matchPattern(body: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(body);
  } catch {
    return body.toLowerCase().includes(pattern.toLowerCase());
  }
}
