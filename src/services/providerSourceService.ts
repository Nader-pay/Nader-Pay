import {
  checkSmsPermission,
  requestSmsPermission,
  readExistingPaymentMessages,
} from './smsReader';
import { detectProvider, getProvider } from './providers';
import {
  getVerifiedProviderSource,
  saveProviderSource,
  updateProviderSourceVerification,
  revokeProviderSource,
  updateProviderSourceLastMessage,
  logSourceVerification,
  getProviderSources,
  deleteProviderSource,
} from '@/lib/database';
import { getIndexedSmsMessagesByProvider } from './localSmsIndex';
import type {
  ProviderName,
  ProviderSource,
  SourceType,
  DiscoveredSmsSource,
  SourceMetadata,
} from '@/types/provider';
import type { SmsMessage } from '@/types/agent';

const PARSER_VERSION = '1.0.0';

export type ProviderSourceStatus = {
  providerId: ProviderName;
  status: 'unverified' | 'verified' | 'failed' | 'discovering' | 'verifying' | 'selected';
  source: ProviderSource | null;
  smsReady: boolean;
  parserReady: boolean;
  lastMessageAt: string | null;
  lastMessageSummary: string | null;
  lastVerificationAt: string | null;
  lastVerificationResult: string | null;
  error: string | null;
};

export type DiscoveryResult = {
  permissionGranted: boolean;
  sources: DiscoveredSmsSource[];
  error: string | null;
};

function looksLikePhone(value: string): boolean {
  return /\d/.test(value);
}

function isShortCode(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 && digits.length <= 6;
}

export function detectSourceType(value: string): SourceType {
  const trimmed = value.trim();
  if (!trimmed) return 'unknown';
  if (looksLikePhone(trimmed)) {
    return isShortCode(trimmed) ? 'short_code' : 'phone';
  }
  return 'sender_name';
}

export function normalizeSourceAddress(value: string, type: SourceType): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (type === 'phone') {
    let digits = trimmed.replace(/\D/g, '');
    if (digits.startsWith('20') && digits.length === 12) {
      digits = '0' + digits.slice(2);
    } else if (digits.startsWith('+20')) {
      digits = '0' + digits.slice(3);
    } else if (digits.startsWith('0020')) {
      digits = '0' + digits.slice(4);
    } else if (digits.startsWith('02') && digits.length === 11) {
      // landline
      digits = digits;
    }
    return digits;
  }
  return trimmed.toLowerCase();
}

export function normalizeSourceId(value: string): { sourceId: string; sourceType: SourceType } {
  const type = detectSourceType(value);
  return { sourceId: normalizeSourceAddress(value, type), sourceType: type };
}

function truncateMessage(body: string, max = 120): string {
  if (body.length <= max) return body;
  return body.slice(0, max).trim() + '…';
}

function sourceLabelFromAddress(address: string, type: SourceType): string {
  if (type === 'phone') return address;
  if (type === 'short_code') return `رمز قصير: ${address}`;
  return address;
}

export function detectSourceProvider(body: string): ProviderName {
  return detectProvider(body);
}

export async function getProviderSourceStatus(
  providerId: ProviderName
): Promise<ProviderSourceStatus> {
  const [smsReady, verified, rawSources] = await Promise.all([
    checkSmsPermission(),
    getVerifiedProviderSource(providerId),
    getProviderSources(providerId),
  ]);

  const parser = getProvider(providerId);
  const parserReady = Boolean(parser);

  if (verified) {
    const metadata = parseMetadata(verified.source_metadata);
    return {
      providerId,
      status: 'verified',
      source: rowToProviderSource(verified, metadata),
      smsReady,
      parserReady,
      lastMessageAt: verified.last_message_at ?? null,
      lastMessageSummary: verified.last_message_summary ?? null,
      lastVerificationAt: verified.last_verification_at ?? null,
      lastVerificationResult: verified.last_verification_result ?? null,
      error: null,
    };
  }

  const failed = rawSources.find((s) => s.last_verification_result?.startsWith('failed'));
  if (failed) {
    const metadata = parseMetadata(failed.source_metadata);
    return {
      providerId,
      status: 'failed',
      source: rowToProviderSource(failed, metadata),
      smsReady,
      parserReady,
      lastMessageAt: failed.last_message_at ?? null,
      lastMessageSummary: failed.last_message_summary ?? null,
      lastVerificationAt: failed.last_verification_at ?? null,
      lastVerificationResult: failed.last_verification_result ?? null,
      error: failed.last_verification_result ?? null,
    };
  }

  return {
    providerId,
    status: 'unverified',
    source: null,
    smsReady,
    parserReady,
    lastMessageAt: null,
    lastMessageSummary: null,
    lastVerificationAt: null,
    lastVerificationResult: null,
    error: null,
  };
}

export async function discoverSmsSources(
  providerId: ProviderName
): Promise<DiscoveryResult> {
  if (process.env.EXPO_OS === 'web') {
    return {
      permissionGranted: false,
      sources: [],
      error: 'اكتشاف مصادر SMS يتطلب جهاز Android',
    };
  }

  const permissionGranted = await checkSmsPermission();
  if (!permissionGranted) {
    return {
      permissionGranted: false,
      sources: [],
      error: 'لا توجد صلاحية قراءة SMS. يرجى السماح للتطبيق أولاً.',
    };
  }

  try {
    // اقرأ الرسائل من السجل المحلي (Android SMS Provider) - لا تتعامل معها كملفات
    const messages = await readExistingPaymentMessages(200);
    const providerMessages = messages.filter(
      (m) => detectProvider(m.body) === providerId
    );

    if (providerMessages.length === 0) {
      // حاول الاستعانة بالفهرس المحلي إذا كان موجودًا
      const indexed = await getIndexedSmsMessagesByProvider(providerId, 200);
      if (indexed.length > 0) {
        return {
          permissionGranted: true,
          sources: groupMessagesBySource(providerId, indexed),
          error: null,
        };
      }
      return {
        permissionGranted: true,
        sources: [],
        error: 'لم يتم العثور على رسائل لهذا المزود. تأكد من وجود رسائل SMS في الجهاز.',
      };
    }

    return {
      permissionGranted: true,
      sources: groupMessagesBySource(providerId, providerMessages),
      error: null,
    };
  } catch (err) {
    return {
      permissionGranted: true,
      sources: [],
      error: err instanceof Error ? err.message : 'فشل اكتشاف المصادر',
    };
  }
}

function groupMessagesBySource(
  providerId: ProviderName,
  messages: SmsMessage[]
): DiscoveredSmsSource[] {
  const groups = new Map<string, SmsMessage[]>();
  for (const m of messages) {
    const key = m.originatingAddress;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  const parser = getProvider(providerId);
  const results: DiscoveredSmsSource[] = [];

  for (const [address, msgs] of groups) {
    const sorted = msgs.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const last = sorted[0];
    const { sourceId, sourceType } = normalizeSourceId(address);
    const parsedCount = sorted.reduce((acc, m) => {
      if (!parser) return acc;
      return parser.parse(m.body) ? acc + 1 : acc;
    }, 0);
    const confidence =
      sorted.length > 0 ? Math.round((parsedCount / sorted.length) * 100) : 0;

    results.push({
      sourceId,
      sourceType,
      label: sourceLabelFromAddress(address, sourceType),
      messageCount: sorted.length,
      lastMessageAt: last.date,
      lastMessageBody: last.body,
      lastMessagePreview: truncateMessage(last.body),
      parserConfidence: confidence,
    });
  }

  return results.sort(
    (a, b) =>
      b.messageCount - a.messageCount ||
      (b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0) -
        (a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0)
  );
}

export async function verifyProviderSource(
  providerId: ProviderName,
  source: DiscoveredSmsSource,
  options?: { autoSelect?: boolean }
): Promise<{ ok: boolean; reason?: string }> {
  if (process.env.EXPO_OS === 'web') {
    return { ok: false, reason: 'يتطلب جهاز Android' };
  }

  const permissionGranted = await checkSmsPermission();
  if (!permissionGranted) {
    return { ok: false, reason: 'لا توجد صلاحية قراءة SMS' };
  }

  const parser = getProvider(providerId);
  if (!parser) {
    return { ok: false, reason: 'لا يوجد محلل للمزود' };
  }

  // ألغِ التوثيق القديم للمزود قبل توثيق المصدر الجديد
  await revokeProviderSource(providerId);
  await logSourceVerification(providerId, source.sourceId, 'revoke_old', 'ok', null, {
    reason: 'new_source_selected',
  });

  // اقرأ الرسائل من نفس المصدر
  const messages = await readExistingPaymentMessages(200);
  const sourceMessages = messages.filter(
    (m) =>
      detectProvider(m.body) === providerId &&
      sourceMatchesAddress(m.originatingAddress, source.sourceId, source.sourceType)
  );

  if (sourceMessages.length === 0) {
    await logSourceVerification(providerId, source.sourceId, 'verify', 'failed', 'no_messages', {
      source,
    });
    return {
      ok: false,
      reason: 'لم يتم العثور على رسائل من هذا المصدر.',
    };
  }

  // شغّل المحلل على الرسائل
  const parseResults = sourceMessages.map((m) => parser.parse(m.body));
  const successCount = parseResults.filter((r) => r !== null).length;
  const totalCount = parseResults.length;

  let passed = false;
  let reason = '';

  if (totalCount === 0) {
    passed = false;
    reason = 'لا توجد رسائل كافية للاختبار';
  } else if (totalCount === 1) {
    passed = successCount === 1;
    reason = passed
      ? 'نجح تحليل الرسالة الوحيدة'
      : 'فشل تحليل الرسالة الوحيدة - الصيغة غير مطابقة';
  } else if (totalCount <= 3) {
    passed = successCount >= 1;
    reason = passed
      ? `نجح تحليل ${successCount} من ${totalCount} رسائل`
      : `فشل تحليل جميع الرسائل (${totalCount})`;
  } else {
    const rate = successCount / totalCount;
    passed = rate >= 0.5;
    reason = passed
      ? `نجح تحليل ${successCount} من ${totalCount} رسالة (${Math.round(rate * 100)}%)`
      : `معدل النجاح منخفض: ${Math.round(rate * 100)}%`;
  }

  const lastMessage = sourceMessages.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )[0];
  const lastSummary = lastMessage ? truncateMessage(lastMessage.body) : null;

  const metadata: SourceMetadata = {
    label: source.label,
    displayName: source.label,
    examples: source.lastMessageBody ? [source.lastMessageBody] : [],
  };

  if (passed) {
    await saveProviderSource({
      providerId,
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      sourceMetadata: metadata,
      verified: true,
      enabled: true,
      lastVerificationAt: new Date().toISOString(),
      lastVerificationResult: reason,
      lastMessageAt: lastMessage ? lastMessage.date : null,
      lastMessageSummary: lastSummary,
      parserVersion: PARSER_VERSION,
    });
    await logSourceVerification(providerId, source.sourceId, 'verify', 'verified', reason, {
      source,
      successCount,
      totalCount,
    });
    return { ok: true, reason };
  }

  await saveProviderSource({
    providerId,
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    sourceMetadata: metadata,
    verified: false,
    enabled: true,
    lastVerificationAt: new Date().toISOString(),
    lastVerificationResult: `failed: ${reason}`,
    lastMessageAt: lastMessage ? lastMessage.date : null,
    lastMessageSummary: lastSummary,
    parserVersion: PARSER_VERSION,
  });
  await logSourceVerification(providerId, source.sourceId, 'verify', 'failed', reason, {
    source,
    successCount,
    totalCount,
  });

  return { ok: false, reason };
}

export async function revokeAndResetProviderSource(
  providerId: ProviderName
): Promise<void> {
  await revokeProviderSource(providerId);
  const sources = await getProviderSources(providerId);
  for (const s of sources) {
    await logSourceVerification(providerId, s.source_id, 'revoke', 'revoked', null, {
      sourceType: s.source_type,
    });
  }
}

export async function changeProviderSource(
  providerId: ProviderName,
  source: DiscoveredSmsSource
): Promise<{ ok: boolean; reason?: string }> {
  // لا يرث التوثيق القديم
  await revokeAndResetProviderSource(providerId);
  return verifyProviderSource(providerId, source);
}

export async function updateVerifiedSourceLastMessage(
  providerId: ProviderName,
  sourceId: string,
  message: { date: string; body: string }
): Promise<void> {
  await updateProviderSourceLastMessage(
    providerId,
    sourceId,
    message.date,
    truncateMessage(message.body)
  );
}

export async function isSourceVerifiedForProvider(
  providerId: ProviderName,
  sourceAddress: string
): Promise<boolean> {
  const verified = await getVerifiedProviderSource(providerId);
  if (!verified) return false;
  const type = (verified.source_type as SourceType) ?? detectSourceType(sourceAddress);
  return sourceMatchesAddress(sourceAddress, verified.source_id, type);
}

function sourceMatchesAddress(
  address: string,
  sourceId: string,
  sourceType: SourceType
): boolean {
  const normalized = normalizeSourceAddress(address, sourceType);
  return normalized === sourceId;
}

function parseMetadata(raw: string): SourceMetadata {
  try {
    return JSON.parse(raw) as SourceMetadata;
  } catch {
    return {};
  }
}

function rowToProviderSource(
  row: {
    id: number;
    provider_id: string;
    source_id: string;
    source_type: string;
    source_metadata: string;
    verified: number;
    enabled: number;
    last_verification_at: string | null;
    last_verification_result: string | null;
    last_message_at: string | null;
    last_message_summary: string | null;
    parser_version: string | null;
    created_at: string;
    updated_at: string;
  },
  metadata: SourceMetadata
): ProviderSource {
  return {
    id: row.id,
    providerId: row.provider_id as ProviderName,
    sourceId: row.source_id,
    sourceType: row.source_type as SourceType,
    sourceMetadata: metadata,
    verified: row.verified === 1,
    enabled: row.enabled === 1,
    lastVerificationAt: row.last_verification_at,
    lastVerificationResult: row.last_verification_result,
    lastMessageAt: row.last_message_at,
    lastMessageSummary: row.last_message_summary,
    parserVersion: row.parser_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function requestSmsPermissionForDiscovery(): Promise<boolean> {
  return requestSmsPermission();
}

export { requestSmsPermission };
