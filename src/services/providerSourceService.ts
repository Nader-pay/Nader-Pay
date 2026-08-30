import { getProviderSources, saveProviderSource, revokeProviderSource } from '@/lib/database';
import type { ProviderName } from '@/types/agent';

export type ProviderSourceStatus =
  | 'unverified'
  | 'discovering'
  | 'selected'
  | 'verifying'
  | 'verified'
  | 'failed';

export type ProviderSource = {
  id: string;
  providerId: string;
  providerName: string;
  sourceId: string;
  sourceType: string;
  sourceMetadata: Record<string, unknown> | null;
  parserVersion: string | null;
  receivingAccount: string | null;
  approvedSenderIdentifiers: string[];
  messagePatterns: string[];
  verified: boolean;
  enabled: boolean;
  status: ProviderSourceStatus;
  lastMessageAt: string | null;
  lastMessageSummary: string | null;
  lastVerificationAt: string | null;
  lastVerificationResult: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listProviderSources(providerId?: string): Promise<ProviderSource[]> {
  const rows = await getProviderSources(providerId);
  return rows.map(mapRow);
}

export async function listVerifiedSources(): Promise<ProviderSource[]> {
  const rows = await getProviderSources();
  return rows.map(mapRow).filter((s) => s.verified && s.status === 'verified');
}

export async function getProviderSourceById(id: string): Promise<ProviderSource | null> {
  const rows = await getProviderSources();
  return rows.map(mapRow).find((s) => s.id === id) ?? null;
}

export async function getVerifiedSourceForProvider(providerId: ProviderName): Promise<ProviderSource | null> {
  const rows = await getProviderSources();
  return (
    rows
      .map(mapRow)
      .find((s) => s.providerId === providerId && s.verified && s.status === 'verified') ?? null
  );
}

export async function setProviderSourceStatus(
  id: string,
  status: ProviderSourceStatus,
  extra?: Partial<ProviderSource>
): Promise<void> {
  const existing = await getProviderSourceById(id);
  if (!existing) return;
  await saveProviderSource({
    id,
    providerId: existing.providerId,
    providerName: existing.providerName,
    sourceId: existing.sourceId,
    sourceType: existing.sourceType,
    sourceMetadata: existing.sourceMetadata ?? undefined,
    parserVersion: existing.parserVersion ?? undefined,
    receivingAccount: existing.receivingAccount ?? undefined,
    approvedSenderIdentifiers: existing.approvedSenderIdentifiers,
    messagePatterns: existing.messagePatterns,
    verified: status === 'verified',
    enabled: status === 'verified' || status === 'selected' || status === 'verifying',
    status,
    lastMessageAt: extra?.lastMessageAt ?? existing.lastMessageAt,
    lastMessageSummary: extra?.lastMessageSummary ?? existing.lastMessageSummary,
    lastVerificationAt: extra?.lastVerificationAt ?? existing.lastVerificationAt,
    lastVerificationResult: extra?.lastVerificationResult ?? existing.lastVerificationResult,
  });
}

export async function upsertProviderSource(source: ProviderSource): Promise<void> {
  await saveProviderSource({
    id: source.id,
    providerId: source.providerId,
    providerName: source.providerName,
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    sourceMetadata: source.sourceMetadata ?? undefined,
    parserVersion: source.parserVersion ?? undefined,
    receivingAccount: source.receivingAccount ?? undefined,
    approvedSenderIdentifiers: source.approvedSenderIdentifiers,
    messagePatterns: source.messagePatterns,
    verified: source.verified,
    enabled: source.enabled,
    status: source.status,
    lastMessageAt: source.lastMessageAt,
    lastMessageSummary: source.lastMessageSummary,
    lastVerificationAt: source.lastVerificationAt,
    lastVerificationResult: source.lastVerificationResult,
  });
}

export async function revokeSource(id: string): Promise<void> {
  await revokeProviderSource(id);
}

function mapRow(row: {
  id: string;
  provider_id: string;
  provider_name: string;
  source_id: string;
  source_type: string;
  source_metadata: string | null;
  parser_version: string | null;
  receiving_account: string | null;
  approved_sender_identifiers: string | null;
  message_patterns: string | null;
  verified: number;
  enabled: number;
  status: string;
  last_message_at: string | null;
  last_message_summary: string | null;
  last_verification_at: string | null;
  last_verification_result: string | null;
  created_at: string;
  updated_at: string;
}): ProviderSource {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    sourceId: row.source_id,
    sourceType: row.source_type,
    sourceMetadata: parseJson(row.source_metadata),
    parserVersion: row.parser_version,
    receivingAccount: row.receiving_account,
    approvedSenderIdentifiers: parseArray(row.approved_sender_identifiers),
    messagePatterns: parseArray(row.message_patterns),
    verified: row.verified === 1,
    enabled: row.enabled === 1,
    status: (row.status as ProviderSourceStatus) ?? 'unverified',
    lastMessageAt: row.last_message_at,
    lastMessageSummary: row.last_message_summary,
    lastVerificationAt: row.last_verification_at,
    lastVerificationResult: row.last_verification_result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
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
