// ─────────────────────────────────────────────────────────────────────────────
// Provider Parser Registry — كل Provider له parser مستقل بالكامل.
// لا global regexes مشتركة بين Vodafone Cash و InstaPay.
// ─────────────────────────────────────────────────────────────────────────────

import type { ProviderParser, ProviderParseResult, ProviderName, SourceVerificationStatus } from '@/types/provider';
import { parseVodafoneCashSms, looksLikeVodafoneCashSms, VF_CASH_PARSER_ID, VF_CASH_PARSER_VERSION } from './vodafoneCash';
import { parseOrangeCashSms, looksLikeOrangeCashSms } from './orangeCash';
import { parseInstaPaySms, looksLikeInstaPaySms, INSTAPAY_PARSER_ID, INSTAPAY_PARSER_VERSION } from './instaPay';
import { parseBankTransferSms, looksLikeBankTransferSms } from './bankTransfer';

export { VF_CASH_PARSER_ID, VF_CASH_PARSER_VERSION, INSTAPAY_PARSER_ID, INSTAPAY_PARSER_VERSION };

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;

export function normalizeArabic(text: string): string {
  return text
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u200B-\u200F]/g, '')
    .trim();
}

export function normalizeMessage(body: string): string {
  return body.replace(/\s+/g, ' ').replace(/[\u200B-\u200F]/g, '').trim();
}

/**
 * التوثيق الحقيقي يتم مقابل provider_sources في قاعدة البيانات (AgentContext/sourceVerification.ts).
 * الـ Parser لا يضع "verified" بناءً على نص الرسالة فقط.
 */
function unverified(): SourceVerificationStatus {
  return 'unverified';
}

/**
 * Orange Cash و Bank Transfer: parsers قابلة للإضافة لاحقاً.
 * تعيد نتيجة مع parserId/parserVersion صحيح.
 */
function wrapLegacyParser(
  parseFn: () => ProviderParseResult | null,
  parserId: string,
  parserVersion: string
): ProviderParseResult | null {
  const result = parseFn();
  if (!result) return null;
  return {
    ...result,
    sourceVerification: unverified(),
    parserId,
    parserVersion,
    transactionType: result.transactionType ?? 'unknown',
    balanceAfterTransaction: result.balanceAfterTransaction ?? null,
    transactionDate: result.transactionDate ?? null,
    transferMethod: result.transferMethod ?? null,
    messageSource: result.messageSource ?? null,
    messageReceivedAt: result.messageReceivedAt ?? null,
  };
}

const ORANGE_CASH_PARSER_ID = 'orange-cash-v1';
const ORANGE_CASH_PARSER_VERSION = '1.0.0';
const BANK_TRANSFER_PARSER_ID = 'bank-transfer-v1';
const BANK_TRANSFER_PARSER_VERSION = '1.0.0';

const providers: ProviderParser[] = [
  // ── Vodafone Cash — Parser مستقل v2 ──────────────────────────────────────
  {
    name: 'vodafone_cash',
    parserId: VF_CASH_PARSER_ID,
    parserVersion: VF_CASH_PARSER_VERSION,
    detect: (body) => looksLikeVodafoneCashSms(body),
    parse: (body) => parseVodafoneCashSms(body),
    verifySource: () => unverified(),
  },
  // ── Orange Cash — Parser placeholder (لا يُنشئ بيانات وهمية) ─────────────
  {
    name: 'orange_cash',
    parserId: ORANGE_CASH_PARSER_ID,
    parserVersion: ORANGE_CASH_PARSER_VERSION,
    detect: (body) => looksLikeOrangeCashSms(body),
    parse: (body) => wrapLegacyParser(() => parseOrangeCashSms(body), ORANGE_CASH_PARSER_ID, ORANGE_CASH_PARSER_VERSION),
    verifySource: () => unverified(),
  },
  // ── InstaPay / Banque Misr — Parser مستقل v2 ─────────────────────────────
  {
    name: 'insta_pay',
    parserId: INSTAPAY_PARSER_ID,
    parserVersion: INSTAPAY_PARSER_VERSION,
    detect: (body) => looksLikeInstaPaySms(body),
    parse: (body) => parseInstaPaySms(body),
    verifySource: () => unverified(),
  },
  // ── Bank Transfer — Parser placeholder ───────────────────────────────────
  {
    name: 'bank_transfer',
    parserId: BANK_TRANSFER_PARSER_ID,
    parserVersion: BANK_TRANSFER_PARSER_VERSION,
    detect: (body) => looksLikeBankTransferSms(body),
    parse: (body) => wrapLegacyParser(() => parseBankTransferSms(body), BANK_TRANSFER_PARSER_ID, BANK_TRANSFER_PARSER_VERSION),
    verifySource: () => unverified(),
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

/** Parse بـ provider محدد (للـ Test Lab) */
export function parseMessageWithProvider(body: string, provider: ProviderName): ProviderParseResult | null {
  const p = providers.find((x) => x.name === provider);
  if (!p) return null;
  return p.parse(body);
}

export function getProvider(name: ProviderName): ProviderParser | undefined {
  return providers.find((p) => p.name === name);
}

export function listProviders(): ProviderName[] {
  return providers.map((p) => p.name);
}

export function getParserInfo(name: ProviderName): { parserId: string; parserVersion: string } | null {
  const p = providers.find((x) => x.name === name);
  if (!p) return null;
  return { parserId: p.parserId ?? name, parserVersion: p.parserVersion ?? '1' };
}

export function normalizeMessageForIndex(body: string): string {
  return normalizeMessage(body);
}
