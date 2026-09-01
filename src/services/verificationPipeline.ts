/**
 * verificationPipeline.ts — المرحلة الثانية
 * خط أنابيب التحقق الكامل من SMS/Notification حتى التأكيد الذري
 */

import { parseAnySms } from './smsParser';
import type { ParsedTransaction } from '@/types/agent';
import type { ProviderParseResult, ProviderName } from '@/types/provider';
import {
  validateSmsTrustedSource,
  validateNotificationTrustedSource,
  validateProviderIsolation,
  isProviderFullyConfigured,
} from './trustedSourceRuntime';
import {
  normalizeParseResult,
  buildPaymentEvidence,
  buildCanonicalTransaction,
  correlateEvidences,
  type NormalizedTransaction,
  type PaymentEvidence,
  type CanonicalTransaction,
} from './normalizedTransaction';
import {
  matchTransactionToOrders,
  claimTransactionForOrder,
  finalizeTransactionConfirmation,
  type ProductionMatchResult,
  type ProductionMatchCode,
} from './productionMatchingEngine';
import { transitionOrder, type TransactionStage } from './transactionLifecycle';
import {
  insertPaymentEvidence,
  updateEvidenceStatus,
  upsertCanonicalTransaction,
  insertAuditTrailEntry,
  getCanonicalByFingerprint,
  logEvent,
} from '@/lib/database';
import type { Order, SmsMessage } from '@/types/agent';

// ─── نتيجة خط الأنابيب ───────────────────────────────────────────────────────

export type PipelineOutcome =
  | { action: 'CONFIRMED';    orderId: string; matchCode: ProductionMatchCode; score: number; canonical: CanonicalTransaction }
  | { action: 'REVIEW';       orderId: string; matchCode: ProductionMatchCode; score: number; reasons: string[] }
  | { action: 'DUPLICATE';    fingerprint: string }
  | { action: 'NO_MATCH';     matchCode: ProductionMatchCode; reasons: string[] }
  | { action: 'SOURCE_REJECTED'; reason: string }
  | { action: 'PARSE_FAILED' }
  | { action: 'INSUFFICIENT_EVIDENCE' }
  | { action: 'PROVIDER_NOT_CONFIGURED'; provider: string };

// ─── Bridge: ParsedTransaction (legacy smsParser) → ProviderParseResult ──────

function bridgeToProviderParseResult(
  parsed: ParsedTransaction,
  rawMessage: string,
  receivedAt: string
): ProviderParseResult {
  return {
    provider: (parsed.provider ?? 'unknown') as ProviderName,
    transactionId: parsed.transactionId ?? `fp:${parsed.amount}:${parsed.occurredAt ?? receivedAt}`,
    transactionType: 'incoming_payment',
    amount: parsed.amount,
    currency: parsed.currency ?? 'EGP',
    senderPhone: parsed.senderPhone ?? null,
    senderName: parsed.senderName ?? null,
    recipientWallet: parsed.recipientWallet ?? null,
    recipientAccount: null,
    balanceAfterTransaction: null,
    transactionDate: (parsed.occurredAt ?? receivedAt).slice(0, 10),
    transferMethod: null,
    occurredAt: parsed.occurredAt ?? receivedAt,
    rawMessage,
    normalizedMessage: rawMessage.toLowerCase(),
    sourceVerification: 'unverified',
    parserId: (parsed as any).parserId ?? `${parsed.provider ?? 'unknown'}-legacy`,
    parserVersion: (parsed as any).parserVersion ?? '1.0',
    messageSource: null,
    messageReceivedAt: receivedAt,
    stage: 'initial',
  } as ProviderParseResult;
}

// ─── SMS Pipeline ─────────────────────────────────────────────────────────────

export async function processSmsMessage(
  message: SmsMessage,
  pendingOrders: Order[],
  opts: {
    requireSourceVerification: boolean;
    autoConfirm: boolean;
    maxAmountTolerance?: number;
    requireSenderPhone?: boolean;
  }
): Promise<PipelineOutcome> {
  const msgReceivedAt = message.date || new Date().toISOString();

  // 1. Trusted Source
  let sourceTrusted = false;
  let sourceId = message.originatingAddress;
  let trustedProvider: string = 'unknown';

  if (opts.requireSourceVerification) {
    const sourceResult = await validateSmsTrustedSource(message.originatingAddress, message.body);
    if (!sourceResult.trusted) {
      await logPipelineEvent('sms', 'SOURCE_REJECTED', message.originatingAddress, null, null);
      return { action: 'SOURCE_REJECTED', reason: sourceResult.reason };
    }
    sourceTrusted = true;
    sourceId = sourceResult.sourceId;
    trustedProvider = sourceResult.provider;
  } else {
    sourceTrusted = true;
  }

  // 2. Parse
  const parsed = parseAnySms(message.body);
  if (!parsed) return { action: 'PARSE_FAILED' };

  // 3. Provider Isolation
  if (opts.requireSourceVerification && trustedProvider !== 'unknown' && parsed.provider) {
    const isolation = validateProviderIsolation(trustedProvider as ProviderName, parsed.provider as ProviderName);
    if (!isolation.valid) {
      return { action: 'SOURCE_REJECTED', reason: isolation.reason ?? 'Provider isolation violation' };
    }
  }

  // 4. Provider Configured
  const configured = await isProviderFullyConfigured((parsed.provider ?? 'unknown') as ProviderName);
  if (!configured.configured) {
    return { action: 'PROVIDER_NOT_CONFIGURED', provider: parsed.provider ?? 'unknown' };
  }

  // 5. Bridge → Normalize
  const providerResult = bridgeToProviderParseResult(parsed, message.body, msgReceivedAt);
  const normalized = normalizeParseResult(providerResult, 'sms', sourceId, msgReceivedAt);
  const evidence = buildPaymentEvidence(normalized, 'sms');
  const canonical = buildCanonicalTransaction(evidence);

  // 6. Persist
  await persistEvidence(evidence, canonical);

  // 7. Match
  const matchResult = await matchTransactionToOrders(canonical, pendingOrders, {
    sourceTrusted,
    sourceId,
    amountTolerancePct: opts.maxAmountTolerance ? opts.maxAmountTolerance * 100 : 0,
    requireSenderPhone: opts.requireSenderPhone ?? false,
  });

  return applyMatchResult(matchResult, canonical, evidence, opts.autoConfirm, pendingOrders);
}

// ─── Notification Pipeline ────────────────────────────────────────────────────

export async function processNotificationMessage(
  packageIdentifier: string,
  notificationTitle: string,
  notificationBody: string,
  pendingOrders: Order[],
  opts: {
    requireSourceVerification: boolean;
    autoConfirm: boolean;
    existingSmsEvidence?: PaymentEvidence | null;
  }
): Promise<PipelineOutcome> {
  const receivedAt = new Date().toISOString();

  // 1. Trusted Source
  if (opts.requireSourceVerification) {
    const sourceResult = await validateNotificationTrustedSource(packageIdentifier, notificationBody);
    if (!sourceResult.trusted) {
      return { action: 'SOURCE_REJECTED', reason: sourceResult.reason };
    }
  }

  // 2. Parse
  const combinedText = `${notificationTitle} ${notificationBody}`;
  const parsed = parseAnySms(combinedText);
  if (!parsed) return { action: 'PARSE_FAILED' };

  // 3. Bridge → Normalize
  const providerResult = bridgeToProviderParseResult(parsed, combinedText, receivedAt);
  const normalized = normalizeParseResult(providerResult, 'notification', packageIdentifier, receivedAt);
  const notifEvidence = buildPaymentEvidence(normalized, 'notification');

  // 4. Correlation
  let canonical: CanonicalTransaction;
  if (opts.existingSmsEvidence) {
    const corrResult = correlateEvidences(opts.existingSmsEvidence, notifEvidence);
    canonical = corrResult.canLink
      ? buildCanonicalTransaction(opts.existingSmsEvidence, notifEvidence)
      : buildCanonicalTransaction(notifEvidence);
  } else {
    canonical = buildCanonicalTransaction(notifEvidence);
  }

  if (!canonical.isSufficient) {
    await persistEvidence(notifEvidence, canonical);
    return { action: 'INSUFFICIENT_EVIDENCE' };
  }

  await persistEvidence(notifEvidence, canonical);

  const matchResult = await matchTransactionToOrders(canonical, pendingOrders, {
    sourceTrusted: true,
    sourceId: packageIdentifier,
  });

  return applyMatchResult(matchResult, canonical, notifEvidence, opts.autoConfirm, pendingOrders);
}

// ─── Apply Match Result ───────────────────────────────────────────────────────

async function applyMatchResult(
  matchResult: ProductionMatchResult,
  canonical: CanonicalTransaction,
  evidence: PaymentEvidence,
  autoConfirm: boolean,
  _pendingOrders: Order[]
): Promise<PipelineOutcome> {
  const normalized = canonical.normalized;

  const failCodes: ProductionMatchCode[] = [
    'DUPLICATE_TRANSACTION', 'ALREADY_USED', 'SOURCE_NOT_TRUSTED',
    'TRANSACTION_TOO_OLD', 'TRANSACTION_IN_FUTURE', 'INVALID_PAYMENT_MESSAGE',
    'INSUFFICIENT_EVIDENCE',
  ];

  if (failCodes.includes(matchResult.code)) {
    await updateEvidenceStatus(evidence.evidenceId, 'rejected', { canonicalId: canonical.canonicalId });
    await writeAuditEntry(matchResult, canonical, evidence,
      matchResult.code === 'DUPLICATE_TRANSACTION' ? 'duplicate' : 'ignored'
    );
    if (matchResult.code === 'DUPLICATE_TRANSACTION') {
      return { action: 'DUPLICATE', fingerprint: normalized.transactionFingerprint };
    }
    return { action: 'NO_MATCH', matchCode: matchResult.code, reasons: matchResult.reasons };
  }

  if (!matchResult.order) {
    await updateEvidenceStatus(evidence.evidenceId, 'rejected');
    await writeAuditEntry(matchResult, canonical, evidence, 'ignored');
    return { action: 'NO_MATCH', matchCode: matchResult.code, reasons: matchResult.reasons };
  }

  const orderId = matchResult.order.id;
  const fromStage = getOrderStage(matchResult.order);

  if (matchResult.code === 'PARTIAL_MATCH' || !matchResult.canAutoConfirm || !autoConfirm) {
    await transitionOrder(orderId, fromStage, 'REVIEW', {
      reason: `تطابق جزئي: ${matchResult.reasons.join(' • ')}`,
    }).catch(() => null);
    await updateEvidenceStatus(evidence.evidenceId, 'linked', { canonicalId: canonical.canonicalId, orderId });
    await upsertCanonicalTransaction({
      ...buildCtFields(canonical, normalized),
      matchedOrderId: orderId,
      matchCode: matchResult.code,
      matchScore: matchResult.score,
    });
    await writeAuditEntry(matchResult, canonical, evidence, 'review_required');
    return { action: 'REVIEW', orderId, matchCode: matchResult.code, score: matchResult.score, reasons: matchResult.reasons };
  }

  // Atomic Claim
  const claimed = await claimTransactionForOrder(normalized, orderId);
  if (!claimed.claimed) {
    await writeAuditEntry(matchResult, canonical, evidence, 'duplicate');
    return { action: 'DUPLICATE', fingerprint: normalized.transactionFingerprint };
  }

  // State machine
  await transitionOrder(orderId, fromStage, 'MATCHING', { reason: 'Production matching engine' }).catch(() => null);
  await transitionOrder(orderId, 'MATCHING', 'MATCHED', { reason: `Score: ${matchResult.score}` }).catch(() => null);
  await transitionOrder(orderId, 'MATCHED', 'VERIFYING', { reason: `${matchResult.code} | ${normalized.parserId}` }).catch(() => null);
  await transitionOrder(orderId, 'VERIFYING', 'CONFIRMED', { reason: 'Atomic confirmation' }).catch(() => null);

  const confirmedAt = new Date().toISOString();
  await updateEvidenceStatus(evidence.evidenceId, 'linked', { canonicalId: canonical.canonicalId, orderId });
  await upsertCanonicalTransaction({
    ...buildCtFields(canonical, normalized),
    matchedOrderId: orderId,
    matchCode: matchResult.code,
    matchScore: matchResult.score,
    confirmedAt,
  });
  await writeAuditEntry(matchResult, canonical, evidence, 'confirmed');
  await finalizeTransactionConfirmation(normalized, orderId);

  return {
    action: 'CONFIRMED',
    orderId,
    matchCode: matchResult.code,
    score: matchResult.score,
    canonical: { ...canonical, matchedOrderId: orderId } as CanonicalTransaction,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function persistEvidence(evidence: PaymentEvidence, canonical: CanonicalTransaction): Promise<void> {
  const n = evidence.normalized;
  const existing = await getCanonicalByFingerprint(n.transactionFingerprint);
  await insertPaymentEvidence({
    evidenceId: evidence.evidenceId,
    evidenceType: evidence.evidenceType,
    providerId: n.providerId,
    transactionId: n.transactionId,
    transactionFingerprint: n.transactionFingerprint,
    amount: n.amount,
    senderPhone: n.senderPhone,
    receiverAccount: n.receiverAccount,
    receiverWallet: n.receiverWallet,
    sourceIdentifier: n.sourceIdentifier,
    parserId: n.parserId,
    parserVersion: n.parserVersion,
    status: 'pending',
    canonicalId: existing ? existing.canonical_id : canonical.canonicalId,
    normalizedPayload: {
      transactionId: n.transactionId,
      amount: n.amount,
      currency: n.currency,
      transactionType: n.transactionType,
      transactionDateTime: n.transactionDateTime,
    },
    receivedAt: n.messageReceivedAt,
  });
}

async function writeAuditEntry(
  result: ProductionMatchResult,
  canonical: CanonicalTransaction,
  evidence: PaymentEvidence,
  finalAction: 'confirmed' | 'rejected' | 'review_required' | 'duplicate' | 'ignored'
): Promise<void> {
  await insertAuditTrailEntry({
    orderId: result.order?.id ?? null,
    canonicalId: canonical.canonicalId,
    evidenceId: evidence.evidenceId,
    providerId: canonical.providerId,
    verificationCode: result.code,
    matchScore: result.score,
    finalAction,
    sourceType: evidence.evidenceType,
    sourceIdentifier: canonical.normalized.sourceIdentifier,
    parserVersion: canonical.normalized.parserVersion,
    transactionFingerprint: canonical.normalized.transactionFingerprint,
    reason: result.reasons.slice(0, 3).join(' | '),
  });
}

function buildCtFields(canonical: CanonicalTransaction, n: NormalizedTransaction) {
  return {
    canonicalId: canonical.canonicalId,
    providerId: canonical.providerId,
    transactionFingerprint: n.transactionFingerprint,
    amount: n.amount,
    currency: n.currency,
    senderPhone: n.senderPhone,
    senderName: n.senderName,
    receiverAccount: n.receiverAccount,
    receiverWallet: n.receiverWallet,
    transactionDatetime: n.transactionDateTime,
    hasSms: canonical.hasSms,
    hasNotification: canonical.hasNotification,
    isSufficient: canonical.isSufficient,
    evidenceCount: canonical.evidences.length,
  };
}

function getOrderStage(order: Order): TransactionStage {
  const map: Record<string, TransactionStage> = {
    new: 'RECEIVED',
    scanning: 'WAITING_FOR_EVENT',
    matched: 'MATCHED',
    review_required: 'REVIEW',
    confirmed_local: 'CONFIRMED',
    confirmed: 'SYNCED',
    error: 'FAILED',
  };
  return map[order.localStatus ?? 'new'] ?? 'RECEIVED';
}

async function logPipelineEvent(
  sourceType: string,
  code: string,
  identifier: string,
  orderId: string | null,
  provider: string | null
): Promise<void> {
  await logEvent('verification_pipeline', `${sourceType} ${code}`, {
    identifier, orderId, provider, code,
  }).catch(() => undefined);
}
