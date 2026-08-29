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

function wrapWithUnverified(parseFn: () => ProviderParseResult | null): ProviderParseResult | null {
  const result = parseFn();
  if (!result) return null;
  result.sourceVerification = 'unverified';
  return result;
}

const providers: ProviderParser[] = [
  {
    name: 'vodafone_cash',
    detect: (body) => looksLikeVodafoneCashSms(body),
    parse: (body) => {
      const tx = parseVodafoneCashSms(body);
      return tx ? { ...tx, sourceVerification: 'unverified' as SourceVerificationStatus } : null;
    },
    verifySource: () => 'unverified' as SourceVerificationStatus,
  },
  {
    name: 'orange_cash',
    detect: (body) => looksLikeOrangeCashSms(body),
    parse: (body) => wrapWithUnverified(() => parseOrangeCashSms(body)),
    verifySource: () => 'unverified' as SourceVerificationStatus,
  },
  {
    name: 'insta_pay',
    detect: (body) => looksLikeInstaPaySms(body),
    parse: (body) => wrapWithUnverified(() => parseInstaPaySms(body)),
    verifySource: () => 'unverified' as SourceVerificationStatus,
  },
  {
    name: 'bank_transfer',
    detect: (body) => looksLikeBankTransferSms(body),
    parse: (body) => wrapWithUnverified(() => parseBankTransferSms(body)),
    verifySource: () => 'unverified' as SourceVerificationStatus,
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
