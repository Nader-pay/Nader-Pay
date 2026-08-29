// خدمة استكشاف وإدارة مصادر SMS للمزوّدين
// تعمل محليًا بالكامل — لا تحتاج إنترنت

import { looksLikeVodafoneCashSms, parseVodafoneCashSms } from '@/services/smsParser';
import {
  getSmsIndexStats,
  getMessagesByAddress,
  upsertProviderSource,
  setProviderSourceVerified,
  getProviderSources,
  logSourceVerification,
  indexSmsMessage,
  deleteProviderSource,
} from '@/services/localSmsIndex';
import type { DiscoveredSmsSource } from '@/types/provider';

const PROVIDERS = ['vodafone_cash'] as const;
type Provider = typeof PROVIDERS[number];

/**
 * يستكشف مصادر SMS من الفهرس المحلي ويرجع قائمة بالمصادر المحتملة
 * مصنفة حسب الثقة
 */
export async function discoverSmsSources(providerId: Provider): Promise<DiscoveredSmsSource[]> {
  const stats = await getSmsIndexStats();
  const results: DiscoveredSmsSource[] = [];
  const existingSources = await getProviderSources(providerId);
  const verifiedSet = new Set(
    existingSources.filter((s) => s.verified === 1).map((s) => s.source_id)
  );

  for (const stat of stats) {
    if (stat.count < 1) continue;

    const msgs = await getMessagesByAddress(stat.address, 10);
    let matchedCount = 0;

    for (const m of msgs) {
      if (providerId === 'vodafone_cash' && looksLikeVodafoneCashSms(m.body)) {
        matchedCount++;
      }
    }

    if (matchedCount === 0) continue;

    const confidence = Math.round((matchedCount / msgs.length) * 100);
    const lastMsg = msgs[0] ?? null;

    results.push({
      sourceId: stat.address,
      sourceType: stat.address.match(/^\d+$/) ? 'short_code' : stat.address.match(/^[+\d]/) ? 'phone' : 'sender_name',
      displayName: stat.address,
      messageCount: stat.count,
      matchedCount,
      confidence,
      lastMessageBody: lastMsg?.body ?? null,
      lastMessageAt: lastMsg?.date ?? null,
      isCurrentlyVerified: verifiedSet.has(stat.address),
    });
  }

  // ترتيب: الأعلى ثقة أولاً
  return results.sort((a, b) => b.confidence - a.confidence || b.matchedCount - a.matchedCount);
}

/**
 * يوثّق مصدرًا بعد فحص رسائله — يتحقق أن نسبة كافية من الرسائل تُحلَّل بنجاح
 */
export async function verifySource(
  providerId: Provider,
  sourceId: string
): Promise<{ ok: boolean; reason: string; passed: number; tested: number }> {
  const msgs = await getMessagesByAddress(sourceId, 20);
  if (msgs.length === 0) {
    return { ok: false, reason: 'لا توجد رسائل مفهرسة لهذا المصدر', passed: 0, tested: 0 };
  }

  let passed = 0;
  for (const m of msgs) {
    if (providerId === 'vodafone_cash') {
      const tx = parseVodafoneCashSms(m.body);
      if (tx) passed++;
    }
  }

  const ratio = passed / msgs.length;
  const ok = ratio >= 0.5; // 50%+ من الرسائل يجب أن تُحلَّل بنجاح

  const sourceRowId = await upsertProviderSource({
    providerId,
    sourceId,
    sourceType: sourceId.match(/^\d+$/) ? 'short_code' : sourceId.match(/^[+\d]/) ? 'phone' : 'sender_name',
    displayName: sourceId,
    verified: ok,
    enabled: ok,
    lastMessageAt: msgs[0]?.date ?? null,
  });

  await setProviderSourceVerified(
    providerId,
    sourceId,
    ok,
    ok ? 'verified_by_parsing' : 'failed_parsing_ratio',
    ok
  );

  await logSourceVerification({
    providerSourceId: sourceRowId,
    providerId,
    sourceId,
    action: 'verify',
    result: ok ? 'verified' : 'failed',
    reason: ok ? `اجتاز ${passed}/${msgs.length} رسالة` : `فشل ${passed}/${msgs.length} رسالة (أقل من 50%)`,
    messageCountTested: msgs.length,
    messageCountPassed: passed,
  });

  return { ok, reason: ok ? `تم التوثيق: ${passed}/${msgs.length}` : `نسبة منخفضة: ${passed}/${msgs.length}`, passed, tested: msgs.length };
}

/**
 * يُضيف مصدرًا يدويًا (بدون فحص) — الجهة توثّقه ويدويًا
 */
export async function addSourceManually(
  providerId: Provider,
  sourceId: string,
  displayName?: string
): Promise<void> {
  await upsertProviderSource({
    providerId,
    sourceId,
    sourceType: sourceId.match(/^\d+$/) ? 'short_code' : sourceId.match(/^[+\d]/) ? 'phone' : 'sender_name',
    displayName: displayName ?? sourceId,
    verified: false,
    enabled: false,
  });
  await logSourceVerification({
    providerId,
    sourceId,
    action: 'add_manual',
    result: 'added',
    reason: 'تمت الإضافة يدويًا — في انتظار التوثيق',
  });
}

/**
 * يفعّل / يعطّل مصدرًا موجودًا
 */
export async function setSourceEnabled(
  providerId: Provider,
  sourceId: string,
  enabled: boolean
): Promise<void> {
  await upsertProviderSource({ providerId, sourceId, enabled });
  await logSourceVerification({
    providerId,
    sourceId,
    action: enabled ? 'enable' : 'disable',
    result: enabled ? 'enabled' : 'disabled',
  });
}

/**
 * يحذف مصدرًا من قاعدة البيانات
 */
export async function removeSource(providerId: Provider, sourceId: string): Promise<void> {
  await logSourceVerification({
    providerId,
    sourceId,
    action: 'delete',
    result: 'deleted',
  });
  await deleteProviderSource(providerId, sourceId);
}

/**
 * يُفهرس رسالة SMS واردة في الفهرس المحلي
 */
export async function indexIncomingMessage(msg: {
  messageId: string;
  originatingAddress: string;
  body: string;
  date: string;
}): Promise<void> {
  let providerGuess: string | null = null;
  let parsedTransaction: Record<string, unknown> | null = null;

  if (looksLikeVodafoneCashSms(msg.body)) {
    providerGuess = 'vodafone_cash';
    const tx = parseVodafoneCashSms(msg.body);
    if (tx) parsedTransaction = tx as unknown as Record<string, unknown>;
  }

  await indexSmsMessage({ ...msg, providerGuess, parsedTransaction });
}

export { getProviderSources };
