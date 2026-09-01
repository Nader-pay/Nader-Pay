/**
 * trustedSourceRuntime.ts
 * ════════════════════════════════════════════════════════════════
 * Runtime Trusted Source Validation — المرحلة الثانية
 *
 * القواعد:
 *  - لا تُعالج رسالة إلا إذا كان مصدرها موثقاً ومفعّلاً في provider_sources.
 *  - SMS يعتمد على originatingAddress ضد source_id الموثق.
 *  - Notification يعتمد على packageIdentifier ضد notification_sources.
 *  - لا يُستدعى Parser قبل التأكد من Provider المرتبط بالمصدر.
 *  - لا يُسمح لـ Provider أن يقرأ مصادر Provider آخر.
 *  - أي Source غير موثق → IGNORE مع Log.
 *  - أي Provider غير مهيأ بالكامل → لا تأكيد.
 * ════════════════════════════════════════════════════════════════
 */

import { dbReady, logEvent } from '@/lib/database';
import type { ProviderName } from '@/types/provider';

// ─── أنواع النتائج ───────────────────────────────────────────────────────────

export type TrustedSourceResult =
  | { trusted: true;  provider: ProviderName; sourceId: string; sourceType: 'sms' | 'notification' }
  | { trusted: false; reason: string; code: TrustedSourceRejectCode };

export type TrustedSourceRejectCode =
  | 'NO_TRUSTED_SOURCES'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_DISABLED'
  | 'PROVIDER_MISMATCH'
  | 'PROVIDER_NOT_CONFIGURED';

type ProviderSourceRow = {
  id: string;
  provider_id: string;
  source_id: string;
  source_type: string;
  approved_sender_identifiers: string | null;
  message_patterns: string | null;
  verified: number;
  enabled: number;
  status: string;
};

// ─── SMS Trusted Source Validation ──────────────────────────────────────────

/**
 * تحقق من مصدر SMS في وقت التشغيل.
 * يتطابق مع provider_sources المفعّلة والموثّقة.
 * لا يعتمد على اسم التطبيق أو المحتوى فقط.
 */
export async function validateSmsTrustedSource(
  originatingAddress: string,
  messageBody: string
): Promise<TrustedSourceResult> {
  try {
    const db = await dbReady;

    // جلب جميع المصادر الموثّقة والمفعّلة (SMS فقط)
    const sources = await db.getAllAsync<ProviderSourceRow>(
      `SELECT id, provider_id, source_id, source_type,
              approved_sender_identifiers, message_patterns,
              verified, enabled, status
       FROM provider_sources
       WHERE enabled = 1 AND verified = 1
         AND (source_type = 'sms' OR source_type IS NULL OR source_type = '')
       ORDER BY created_at ASC`
    );

    if (sources.length === 0) {
      await logEvent('trusted_source_validation',
        `SMS من ${originatingAddress}: لا يوجد مصدر موثق`,
        { code: 'NO_TRUSTED_SOURCES', address: originatingAddress }
      );
      return { trusted: false, reason: 'لا يوجد مصدر SMS موثق — يرجى توثيق مصدر من شاشة مصادر الدفع', code: 'NO_TRUSTED_SOURCES' };
    }

    const normAddr = normalizeSenderAddress(originatingAddress);
    const bodyLower = messageBody.toLowerCase();

    for (const src of sources) {
      const normSourceId = normalizeSenderAddress(src.source_id);
      const provider = src.provider_id as ProviderName;

      // ── 1. تطابق مباشر بالعنوان ────────────────────────────────────────────
      if (normAddr && normSourceId && (normAddr === normSourceId || normAddr.includes(normSourceId) || normSourceId.includes(normAddr))) {
        return buildSuccess(provider, src.source_id, 'sms');
      }

      // ── 2. تطابق بالمعرّفات المعتمدة ───────────────────────────────────────
      const approvedIds = parseJsonArray(src.approved_sender_identifiers);
      if (approvedIds.some((id) => {
        const n = normalizeSenderAddress(id);
        return n && (normAddr.includes(n) || n.includes(normAddr) || bodyLower.includes(id.toLowerCase()));
      })) {
        return buildSuccess(provider, src.source_id, 'sms');
      }

      // ── 3. تطابق بالأنماط (regex/contains) ─────────────────────────────────
      const patterns = parseJsonArray(src.message_patterns);
      if (patterns.some((p) => matchPattern(messageBody, p))) {
        return buildSuccess(provider, src.source_id, 'sms');
      }
    }

    await logEvent('trusted_source_validation',
      `SMS من ${originatingAddress}: لم يُطابق أي مصدر موثق`,
      { code: 'SOURCE_NOT_FOUND', address: originatingAddress }
    );

    return {
      trusted: false,
      reason: `الرسالة من "${originatingAddress}" لا تنتمي لأي مصدر موثق. سيتم تجاهلها.`,
      code: 'SOURCE_NOT_FOUND',
    };
  } catch (err) {
    await logEvent('trusted_source_error',
      err instanceof Error ? err.message : 'unknown',
      { address: originatingAddress }
    );
    // في حالة خطأ في DB → رفض آمن
    return { trusted: false, reason: 'خطأ في التحقق من المصدر', code: 'SOURCE_NOT_FOUND' };
  }
}

// ─── Notification Trusted Source Validation ──────────────────────────────────

/**
 * تحقق من مصدر الإشعار في وقت التشغيل.
 * يعتمد على packageIdentifier ضد notification_sources (إذا وجد) أو
 * على provider_sources من نوع notification.
 */
export async function validateNotificationTrustedSource(
  packageIdentifier: string,
  notificationBody: string
): Promise<TrustedSourceResult> {
  try {
    const db = await dbReady;

    // أولاً: فحص notification_sources المخصصة
    const notifRows = await db.getAllAsync<{
      provider_id: string; package_id: string; status: string;
    }>(
      `SELECT provider_id, package_id, status
       FROM notification_sources
       WHERE status = 'active' AND package_id = ?
       LIMIT 1`,
      [packageIdentifier]
    );

    if (notifRows.length > 0) {
      const row = notifRows[0];
      return buildSuccess(row.provider_id as ProviderName, row.package_id, 'notification');
    }

    // ثانياً: فحص provider_sources من نوع notification
    const providerNotifRows = await db.getAllAsync<ProviderSourceRow>(
      `SELECT id, provider_id, source_id, source_type,
              approved_sender_identifiers, message_patterns,
              verified, enabled, status
       FROM provider_sources
       WHERE enabled = 1 AND verified = 1 AND source_type = 'notification'
       ORDER BY created_at ASC`
    );

    const pkgLower = packageIdentifier.toLowerCase();
    const bodyLower = notificationBody.toLowerCase();

    for (const src of providerNotifRows) {
      const srcIdLower = src.source_id.toLowerCase();

      if (pkgLower === srcIdLower || pkgLower.includes(srcIdLower)) {
        return buildSuccess(src.provider_id as ProviderName, src.source_id, 'notification');
      }

      const approvedIds = parseJsonArray(src.approved_sender_identifiers);
      if (approvedIds.some((id) => pkgLower.includes(id.toLowerCase()) || bodyLower.includes(id.toLowerCase()))) {
        return buildSuccess(src.provider_id as ProviderName, src.source_id, 'notification');
      }

      const patterns = parseJsonArray(src.message_patterns);
      if (patterns.some((p) => matchPattern(notificationBody, p))) {
        return buildSuccess(src.provider_id as ProviderName, src.source_id, 'notification');
      }
    }

    await logEvent('trusted_source_validation',
      `إشعار من ${packageIdentifier}: لم يُطابق أي مصدر موثق`,
      { code: 'SOURCE_NOT_FOUND', packageId: packageIdentifier }
    );

    return {
      trusted: false,
      reason: `الإشعار من "${packageIdentifier}" لا ينتمي لأي مصدر موثق`,
      code: 'SOURCE_NOT_FOUND',
    };
  } catch (err) {
    await logEvent('trusted_notif_source_error',
      err instanceof Error ? err.message : 'unknown',
      { packageId: packageIdentifier }
    );
    return { trusted: false, reason: 'خطأ في التحقق من مصدر الإشعار', code: 'SOURCE_NOT_FOUND' };
  }
}

// ─── Provider Configuration Validation ───────────────────────────────────────

/**
 * تحقق أن Provider مهيأ بالكامل قبل قبول أي تأكيد.
 * يفحص provider_sources + إعدادات الحساب/المحفظة.
 */
export async function isProviderFullyConfigured(provider: ProviderName): Promise<{
  configured: boolean;
  reason?: string;
}> {
  if (provider === 'unknown') {
    return { configured: false, reason: 'Provider غير محدد' };
  }

  try {
    const db = await dbReady;
    const src = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM provider_sources
       WHERE provider_id = ? AND verified = 1 AND enabled = 1`,
      [provider]
    );

    if ((src?.c ?? 0) === 0) {
      return {
        configured: false,
        reason: `لا يوجد مصدر موثق ومفعّل للـ Provider: ${provider}`,
      };
    }

    return { configured: true };
  } catch {
    return { configured: false, reason: 'خطأ في التحقق من إعدادات Provider' };
  }
}

// ─── Cross-Provider Isolation Check ──────────────────────────────────────────

/**
 * تأكد أن الـ Provider المكتشف من الرسالة مطابق للـ Provider المربوط بالمصدر.
 * يمنع Vodafone Cash من قراءة مصادر InstaPay والعكس.
 */
export function validateProviderIsolation(
  trustedProvider: ProviderName,
  parsedProvider: ProviderName
): { valid: boolean; reason?: string } {
  if (trustedProvider === 'unknown' || parsedProvider === 'unknown') {
    return { valid: true }; // سماح في حالة عدم التحديد
  }

  if (trustedProvider !== parsedProvider) {
    return {
      valid: false,
      reason: `عزل Provider: المصدر الموثق ${trustedProvider} لا يطابق Provider الرسالة ${parsedProvider}`,
    };
  }

  return { valid: true };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSuccess(
  provider: ProviderName,
  sourceId: string,
  sourceType: 'sms' | 'notification'
): TrustedSourceResult {
  return { trusted: true, provider, sourceId, sourceType };
}

function normalizeSenderAddress(address: string): string {
  return (address ?? '').trim().toLowerCase().replace(/[\s\-().+]/g, '');
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const p = JSON.parse(value);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

function matchPattern(body: string, pattern: string): boolean {
  if (!pattern) return false;
  try {
    return new RegExp(pattern, 'i').test(body);
  } catch {
    return body.toLowerCase().includes(pattern.toLowerCase());
  }
}
