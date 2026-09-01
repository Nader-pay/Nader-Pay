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

export function looksLikeBankTransferSms(body: string): boolean {
  const normalized = normalizeArabic(body);
  const transferKeywords = [
    'تم\s+التحويل',
    'حوالة',
    'تحويل\s+رصيد',
    'تم\s+استلام\s+حوالة',
    'إيداع',
    'ايداع',
    ' bank ',
    'bank transfer',
    'حساب',
    'account',
  ];
  return transferKeywords.some((k) => normalized.toLowerCase().includes(k) || normalized.match(new RegExp(k, 'i')));
}

export function parseBankTransferSms(message: string): ProviderParseResult | null {
  const body = message.trim();
  if (!looksLikeBankTransferSms(body)) return null;

  const normalized = normalizeArabic(body);

  const amountMatch = normalized.match(/(?:مبلغ|amount|value|مبلغ\s+قدره)[\s:]*([\d,]+\.?\d*)/i);
  const senderNameMatch = normalized.match(/(?:من|from|اسم\s+المرسل)[\s:]*([A-Za-z\u0600-\u06FF\s]{2,40})/i);
  const senderAccountMatch = normalized.match(/(?:من\s+حساب|from account|account\s*from)[\s:]*([\d+\s().-]{7,})/i);
  const recipientAccountMatch = normalized.match(/(?:إلى\s+حساب|to account|account\s*to)[\s:]*([\d+\s().-]{7,})/i);
  const transactionIdMatch = normalized.match(/(?:رقم\s+(?:العملية|المعاملة|التحويل)|Transaction\s*ID|Ref\s*No|رقم\s+الحوالة)[\s:]*([A-Za-z0-9]{4,})/i);

  if (!amountMatch || !transactionIdMatch) return null;

  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (Number.isNaN(amount)) return null;

  return {
    provider: 'bank_transfer',
    transactionId: transactionIdMatch[1].trim(),
    transactionType: 'incoming_payment',
    amount,
    currency: 'EGP',
    senderPhone: senderAccountMatch ? normalizePhone(senderAccountMatch[1]) : null,
    senderName: senderNameMatch ? senderNameMatch[1].trim() : null,
    recipientWallet: null,
    recipientAccount: recipientAccountMatch ? normalizePhone(recipientAccountMatch[1]) : null,
    balanceAfterTransaction: null,
    transactionDate: null,
    transferMethod: null,
    occurredAt: parseOccurredAt(body) ?? new Date().toISOString(),
    rawMessage: body,
    normalizedMessage: normalizeMessage(body),
    sourceVerification: 'unverified',
    parserId: 'bank-transfer-v1',
    parserVersion: '1.0.0',
    messageSource: null,
    messageReceivedAt: null,
  };
}
