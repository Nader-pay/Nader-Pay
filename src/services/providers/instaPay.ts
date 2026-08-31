import type { ProviderParseResult } from '@/types/provider';

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

function normalizePhone(phone: string): string | null {
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p) return null;
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  if (p.startsWith('20') && p.length === 12) p = '0' + p.slice(2);
  return p;
}

function normalizeMessage(body: string): string {
  return body
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200F]/g, '')
    .trim();
}

function parseOccurredAt(body: string): string | null {
  const normalized = normalizeArabic(body);
  const match = normalized.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (!match) return null;

  const [, hours, minutes, , day, month, year] = match;
  let fullYear = parseInt(year, 10);
  if (fullYear < 100) fullYear += 2000;
  const date = new Date(fullYear, parseInt(month, 10) - 1, parseInt(day, 10), parseInt(hours, 10), parseInt(minutes, 10));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function looksLikeInstaPaySms(body: string): boolean {
  const lower = body.toLowerCase();
  const normalized = normalizeArabic(body);
  return (
    lower.includes('instapay') ||
    lower.includes('ipn') ||
    normalized.includes('انستا باي') ||
    normalized.includes('إنستا باي') ||
    normalized.includes('انستاباي') ||
    normalized.includes('إنستاباي')
  );
}

export function parseInstaPaySms(message: string): ProviderParseResult | null {
  const body = message.trim();
  if (!looksLikeInstaPaySms(body)) return null;

  const normalized = normalizeArabic(body);

  const amountMatch = normalized.match(/(?:مبلغ|amount|value)[\s:]*([\d,]+\.?\d*)/i);
  const senderPhoneMatch = normalized.match(/(?:من رقم|من|from\s*number)[\s:]*([\d+\s().-]{7,})/i);
  const senderNameMatch = normalized.match(/(?:من|from)[\s:]*([A-Za-z\u0600-\u06FF\s]{2,40})/i);
  const recipientAccountMatch = normalized.match(/(?:إلى حساب|to account|account\s*number)[\s:]*([\d+\s().-]{7,})/i);
  const transactionIdMatch = normalized.match(/(?:رقم\s+(?:العملية|المعاملة|التحويل)|Transaction\s*ID|Ref\s*No|IPN)[\s:]*([A-Za-z0-9]{4,})/i);

  if (!amountMatch || !transactionIdMatch) return null;

  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (Number.isNaN(amount)) return null;

  return {
    provider: 'insta_pay',
    transactionId: transactionIdMatch[1].trim(),
    amount,
    currency: 'EGP',
    senderPhone: senderPhoneMatch ? normalizePhone(senderPhoneMatch[1]) : null,
    senderName: senderNameMatch ? senderNameMatch[1].trim() : null,
    recipientWallet: null,
    recipientAccount: recipientAccountMatch ? normalizePhone(recipientAccountMatch[1]) : null,
    occurredAt: parseOccurredAt(body) ?? new Date().toISOString(),
    rawMessage: body,
    normalizedMessage: normalizeMessage(body),
    sourceVerification: 'unverified',
  };
}
