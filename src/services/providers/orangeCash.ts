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

export function looksLikeOrangeCashSms(body: string): boolean {
  const lower = body.toLowerCase();
  const normalized = normalizeArabic(body);
  return (
    lower.includes('orange cash') ||
    lower.includes('orange money') ||
    normalized.includes('اورانج كاش') ||
    normalized.includes('أورانج كاش') ||
    normalized.includes('اورانج موني') ||
    normalized.includes('أورانج موني') ||
    normalized.includes('محفظة اورانج')
  );
}

export function parseOrangeCashSms(message: string): ProviderParseResult | null {
  const body = message.trim();
  if (!looksLikeOrangeCashSms(body)) return null;

  const normalized = normalizeArabic(body);

  const amountMatch = normalized.match(/(?:مبلغ|amount)[\s:]*([\d,]+\.?\d*)/i);
  const senderPhoneMatch = normalized.match(/(?:من رقم|من|من\s+)[\s:]*([\d+\s().-]{7,})/);
  const senderNameMatch = normalized.match(/(?:باسم|بإسم)[\s:]*([^.,\d][^.\n,]{2,40})/);
  const recipientWalletMatch = normalized.match(/(?:رقم\s+المحفظة|محفظة|محفظتك)[\s:]*([\d+\s().-]{7,})/);
  const transactionIdMatch = normalized.match(/(?:رقم\s+(?:العملية|المعاملة)|Transaction\s*ID|Transaction\s*No|رقم\s+التحويل)[\s:]*([A-Za-z0-9]{4,})/);

  if (!amountMatch || !transactionIdMatch) return null;

  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (Number.isNaN(amount)) return null;

  return {
    provider: 'orange_cash',
    transactionId: transactionIdMatch[1].trim(),
    transactionType: 'incoming_payment',
    amount,
    currency: 'EGP',
    senderPhone: senderPhoneMatch ? normalizePhone(senderPhoneMatch[1]) : null,
    senderName: senderNameMatch ? senderNameMatch[1].trim() : null,
    recipientWallet: recipientWalletMatch ? normalizePhone(recipientWalletMatch[1]) : null,
    recipientAccount: null,
    balanceAfterTransaction: null,
    balanceBeforeTransaction: null,
    transactionDate: null,
    transferMethod: null,
    occurredAt: parseOccurredAt(body) ?? new Date().toISOString(),
    rawMessage: body,
    normalizedMessage: normalizeMessage(body),
    sourceVerification: 'unverified',
    parserId: 'orange-cash-v1',
    parserVersion: '1.0.0',
    messageSource: null,
    messageReceivedAt: null,
  };
}
