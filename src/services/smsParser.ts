import type { ParsedTransaction } from '@/types/agent';
import { createHash } from '@/lib/hash';
import { parseMessage, detectProvider } from './providers';

export function parseVodafoneCashSms(message: string): ParsedTransaction | null {
  const tx = parseMessage(message);
  return tx && tx.provider === 'vodafone_cash' ? tx : null;
}

export function looksLikeVodafoneCashSms(body: string): boolean {
  return detectProvider(body) === 'vodafone_cash';
}

export function parseAnySms(message: string): ParsedTransaction | null {
  return parseMessage(message);
}

export function detectSmsProvider(body: string): ParsedTransaction['provider'] {
  return detectProvider(body);
}

export function createMessageHash(message: string): string {
  return createHash(message);
}
