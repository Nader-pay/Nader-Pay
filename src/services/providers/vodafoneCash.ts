import type { ProviderParseResult } from '@/types/provider';

const VODAFONE_CASH_KEYWORDS = [
  'Vodafone Cash',
  'Vodafone cash',
  'محفظة فودافون',
  'فودافون كاش',
  'VodafoneCash',
];

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;

function normalizeArabic(text: string): string {
  return text
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\u200B-\u200F/g, '')
    .trim();
}

function normalizeMessage(body: string): string {
  return body
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200F]/g, '')
    .trim();
}

function normalizePhone(phone: string): string | null {
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p) return null;
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  if (p.startsWith('20') && p.length === 12) p = '0' + p.slice(2);
  return p;
}

function parseOccurredAt(dateText: string | null): string | null {
  if (!dateText) return null;
  const match = dateText.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (!match) return null;

  const [, hours, minutes, , day, month, year] = match;
  let fullYear = parseInt(year, 10);
  if (fullYear < 100) {
    fullYear += 2000;
  }
  const date = new Date(
    fullYear,
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hours, 10),
    parseInt(minutes, 10)
  );
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function looksLikeVodafoneCashSms(body: string): boolean {
  const lower = body.toLowerCase();
  const normalized = normalizeArabic(body);
  return (
    lower.includes('تم استلام') ||
    lower.includes('محفظتك') ||
    lower.includes('vodafone cash') ||
    normalized.includes('فودافون كاش') ||
    normalized.includes('محفظة') ||
    VODAFONE_CASH_KEYWORDS.some((k) => normalized.includes(k.toLowerCase()) || body.includes(k))
  );
}

export function parseVodafoneCashSms(message: string): ProviderParseResult | null {
  const body = message.trim();
  if (!looksLikeVodafoneCashSms(body)) return null;

  const normalized = normalizeArabic(body);

  const amountMatch = normalized.match(/(?:مبلغ(?:\s+قدره)?|amount)[\s:]*([\d,]+\.?\d*)/i);
  const senderPhoneMatch = normalized.match(/(?:من رقم|من)\s*[:\s]*([\d+\s().-]{7,})/);
  const senderNameMatch = normalized.match(/(?:باسم|بإسم)\s*[:\s]*([^.,\d][^.\n,]{2,40})/);
  const recipientWalletMatch = normalized.match(/(?:محفظتك|رقم\s+المحفظة|محفظة)[\s:]*([\d+\s().-]{7,})/);
  const dateMatch = normalized.match(/(?:تاريخ\s+العملية|التاريخ)[\s:]*([\d]{1,2}[:\d]{2,4}\s+[\d]{1,2}[\/-][\d]{1,2}[\/-][\d]{2,4})/);
  const transactionIdMatch = normalized.match(/(?:رقم\s+(?:العملية|المعاملة)|Transaction\s*ID|Transaction\s*No)[\s:]*([A-Za-z0-9]{4,})/);

  if (!amountMatch || !transactionIdMatch) {
    return null;
  }

  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (Number.isNaN(amount)) return null;

  const senderPhone = senderPhoneMatch ? normalizePhone(senderPhoneMatch[1]) : null;
  const recipientWallet = recipientWalletMatch ? normalizePhone(recipientWalletMatch[1]) : null;
  const senderName = senderNameMatch ? senderNameMatch[1].trim() : null;
  const occurredAt = parseOccurredAt(dateMatch ? dateMatch[1] : null);

  return {
    provider: 'vodafone_cash',
    transactionId: transactionIdMatch[1].trim(),
    amount,
    currency: 'EGP',
    senderPhone,
    senderName,
    recipientWallet,
    recipientAccount: null,
    occurredAt: occurredAt ?? new Date().toISOString(),
    rawMessage: body,
    normalizedMessage: normalizeMessage(body),
    sourceVerification: 'unverified',
  };
}
