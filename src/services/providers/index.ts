import type { ProviderParser, ProviderParseResult, ProviderName, SourceVerificationStatus } from '@/types/provider';
import { parseVodafoneCashSms, looksLikeVodafoneCashSms } from './vodafoneCash';
import { parseOrangeCashSms, looksLikeOrangeCashSms } from './orangeCash';
import { parseInstaPaySms, looksLikeInstaPaySms } from './instaPay';
import { parseBankTransferSms, looksLikeBankTransferSms } from './bankTransfer';

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

function verifySourceForProvider(provider: ProviderName, body: string): SourceVerificationStatus {
  switch (provider) {
    case 'vodafone_cash':
      return verifyVodafoneSource(body);
    case 'orange_cash':
      return verifyOrangeSource(body);
    case 'insta_pay':
      return verifyInstaPaySource(body);
    case 'bank_transfer':
      return verifyBankTransferSource(body);
    default:
      return 'unverified';
  }
}

function verifyVodafoneSource(body: string): SourceVerificationStatus {
  const normalized = normalizeArabic(body);
  const hasBrand =
    normalized.toLowerCase().includes('vodafone') ||
    normalized.includes('فودافون') ||
    normalized.includes('محفظة');
  return hasBrand ? 'verified' : 'unverified';
}

function verifyOrangeSource(body: string): SourceVerificationStatus {
  const normalized = normalizeArabic(body);
  const hasBrand =
    normalized.toLowerCase().includes('orange') ||
    normalized.includes('اورانج') ||
    normalized.includes('أورانج');
  return hasBrand ? 'verified' : 'unverified';
}

function verifyInstaPaySource(body: string): SourceVerificationStatus {
  const normalized = normalizeArabic(body);
  const hasBrand =
    normalized.toLowerCase().includes('instapay') ||
    normalized.toLowerCase().includes('ipn') ||
    normalized.includes('انستا') ||
    normalized.includes('إنستا');
  return hasBrand ? 'verified' : 'unverified';
}

function verifyBankTransferSource(body: string): SourceVerificationStatus {
  const normalized = normalizeArabic(body);
  const hasBankTerms =
    normalized.includes('تحويل') ||
    normalized.includes('حوالة') ||
    normalized.includes('رصيد') ||
    normalized.includes('حساب');
  return hasBankTerms ? 'partial' : 'unverified';
}

function wrapWithVerification(parseFn: () => ProviderParseResult | null): ProviderParseResult | null {
  const result = parseFn();
  if (!result) return null;
  result.sourceVerification = verifySourceForProvider(result.provider, result.rawMessage);
  return result;
}

const providers: ProviderParser[] = [
  {
    name: 'vodafone_cash',
    detect: (body) => looksLikeVodafoneCashSms(body),
    parse: (body) => {
      const tx = parseVodafoneCashSms(body);
      return tx ? { ...tx, sourceVerification: verifySourceForProvider('vodafone_cash', body) } : null;
    },
    verifySource: (body) => verifyVodafoneSource(body),
  },
  {
    name: 'orange_cash',
    detect: (body) => looksLikeOrangeCashSms(body),
    parse: (body) => wrapWithVerification(() => parseOrangeCashSms(body)),
    verifySource: (body) => verifyOrangeSource(body),
  },
  {
    name: 'insta_pay',
    detect: (body) => looksLikeInstaPaySms(body),
    parse: (body) => wrapWithVerification(() => parseInstaPaySms(body)),
    verifySource: (body) => verifyInstaPaySource(body),
  },
  {
    name: 'bank_transfer',
    detect: (body) => looksLikeBankTransferSms(body),
    parse: (body) => wrapWithVerification(() => parseBankTransferSms(body)),
    verifySource: (body) => verifyBankTransferSource(body),
  },
];

export function detectProvider(body: string): ProviderName {
  for (const p of providers) {
    if (p.detect(body)) return p.name;
  }
  return 'unknown';
}

export function parseMessage(body: string): ProviderParseResult | null {
  for (const p of providers) {
    if (p.detect(body)) {
      const tx = p.parse(body);
      if (tx) return tx;
    }
  }
  return null;
}

export function getProvider(name: ProviderName): ProviderParser | undefined {
  return providers.find((p) => p.name === name);
}

export function listProviders(): ProviderName[] {
  return providers.map((p) => p.name);
}

export function normalizeMessageForIndex(body: string): string {
  return normalizeMessage(body);
}

export { normalizeArabic, normalizeMessage };
