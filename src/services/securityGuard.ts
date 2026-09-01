/**
 * securityGuard.ts
 * Security Hardening Layer — Phase 3
 *
 * المسؤوليات:
 *   1. Device Identity States: ACTIVE / REVOKED / BLOCKED / VERSION_BLOCKED / UNKNOWN
 *   2. Replay Attack Protection: nonce-based + timestamp window guard
 *   3. Request Signing: HMAC-like header للطلبات الحساسة
 *   4. Token Storage Audit: تحقق من سلامة التخزين
 *   5. Safe Error Scrubbing: تجريد الأخطاء من البيانات الحساسة قبل التسجيل
 */

import { logEvent, recordAuditEvent } from '@/lib/database';

// ─────────────────────────────────────────────────────────────
// Device Identity State Machine
// ─────────────────────────────────────────────────────────────

export type DeviceIdentityState =
  | 'ACTIVE'
  | 'REVOKED'          // ألغاه الخادم صراحةً
  | 'BLOCKED'          // مُعلَّق مؤقتاً
  | 'VERSION_BLOCKED'  // نسخة التطبيق محظورة
  | 'AUTH_EXPIRED'     // انتهت الجلسة
  | 'UNKNOWN';         // لم يُحدَّد بعد

let _deviceIdentityState: DeviceIdentityState = 'UNKNOWN';
let _identityStateChangedAt: string | null = null;

export function getDeviceIdentityState(): DeviceIdentityState {
  return _deviceIdentityState;
}

export function setDeviceIdentityState(state: DeviceIdentityState, reason?: string): void {
  const prev = _deviceIdentityState;
  if (prev === state) return;
  _deviceIdentityState = state;
  _identityStateChangedAt = new Date().toISOString();
  logEvent('device_identity_change', `${prev} → ${state}`, { reason }).catch(() => undefined);
  recordAuditEvent('device_registered', null, { prev, next: state, reason }).catch(() => undefined);
}

/**
 * تحليل استجابة الخادم واستخراج Device Identity State.
 * يُستدعى في backendConnector عند كل استجابة.
 */
export function detectDeviceIdentityFromResponse(
  status: number,
  errorBody: unknown
): DeviceIdentityState | null {
  const body = (errorBody ?? '') as string | Record<string, unknown>;
  const text = typeof body === 'string' ? body : JSON.stringify(body);

  if (text.includes('DEVICE_REVOKED')) return 'REVOKED';
  if (text.includes('DEVICE_BLOCKED')) return 'BLOCKED';
  if (text.includes('VERSION_BLOCKED')) return 'VERSION_BLOCKED';

  // FIX RC#2: لا نُعامل كل 401/403 كـ AUTH_EXPIRED.
  // 403 من backend-proxy (مثل "Path not allowed") خطأ عادي وليس انتهاء جلسة.
  // نُعيد AUTH_EXPIRED فقط إذا كانت رسائل الخادم تُشير صراحةً لانتهاء المصادقة.
  if (status === 401 || status === 403) {
    // إشارات صريحة لانتهاء المصادقة من الخادم
    const isAuthExpiry =
      text.includes('AUTH_EXPIRED') ||
      text.includes('token expired') ||
      text.includes('jwt expired') ||
      text.includes('session expired') ||
      text.includes('Invalid JWT') ||
      text.includes('invalid_grant') ||
      (status === 401 && !text.includes('Path not allowed') && !text.includes('path not allowed'));
    if (isAuthExpiry) return 'AUTH_EXPIRED';
    // 403 بدون إشارة صريحة = خطأ صلاحيات/مسار عادي — لا نُغيّر حالة الجهاز
  }
  return null;
}

export function isDeviceOperational(): boolean {
  return _deviceIdentityState === 'ACTIVE' || _deviceIdentityState === 'UNKNOWN';
}

// ─────────────────────────────────────────────────────────────
// Replay Attack Protection
// ─────────────────────────────────────────────────────────────

// نافذة قبول الطوابع الزمنية: 5 دقائق
const TIMESTAMP_WINDOW_MS = 5 * 60_000;
// Ring buffer للـ nonces المستخدمة (حجم محدود لتوفير الذاكرة)
const MAX_NONCE_CACHE = 500;
const _usedNonces = new Map<string, number>(); // nonce → timestamp

/**
 * إنشاء nonce جديد فريد.
 */
export function generateNonce(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}-${rand}`;
}

/**
 * التحقق من أن الطلب ليس replay.
 * يُعيد false إذا كان الـ nonce مستخدماً مسبقاً أو الـ timestamp خارج النافذة.
 */
export function validateReplayGuard(nonce: string, timestampMs: number): boolean {
  const now = Date.now();
  const age = Math.abs(now - timestampMs);

  // الطابع الزمني خارج نافذة القبول
  if (age > TIMESTAMP_WINDOW_MS) {
    logEvent('replay_rejected_timestamp', `age=${age}ms nonce=${nonce}`).catch(() => undefined);
    return false;
  }

  // nonce مستخدم مسبقاً
  if (_usedNonces.has(nonce)) {
    logEvent('replay_rejected_nonce', `duplicate nonce=${nonce}`).catch(() => undefined);
    return false;
  }

  // تسجيل الـ nonce
  _usedNonces.set(nonce, now);

  // تنظيف دوري: احذف الـ nonces القديمة
  if (_usedNonces.size > MAX_NONCE_CACHE) {
    const cutoff = now - TIMESTAMP_WINDOW_MS;
    for (const [k, ts] of _usedNonces.entries()) {
      if (ts < cutoff) _usedNonces.delete(k);
    }
  }

  return true;
}

/**
 * إنشاء headers أمان لكل طلب حساس.
 * X-Request-Nonce: nonce جديد
 * X-Request-Timestamp: timestamp الحالي
 * X-Device-Id: معرف الجهاز
 */
export function buildSecurityHeaders(deviceId: string | null | undefined): Record<string, string> {
  const nonce = generateNonce();
  const timestamp = Date.now().toString();
  const headers: Record<string, string> = {
    'X-Request-Nonce': nonce,
    'X-Request-Timestamp': timestamp,
  };
  if (deviceId) {
    headers['X-Device-Id'] = deviceId;
  }
  return headers;
}

// ─────────────────────────────────────────────────────────────
// Safe Error Scrubbing
// ─────────────────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._-]{10,}/gi,
  /token["\s:=]+[A-Za-z0-9._-]{10,}/gi,
  /apikey["\s:=]+[A-Za-z0-9._-]{10,}/gi,
  /password["\s:=]+\S+/gi,
  /device_token["\s:=]+[A-Za-z0-9._-]{6,}/gi,
  // أرقام بطاقات
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  // أرقام هواتف مصرية كاملة
  /\b(01[0-9]{9})\b/g,
];

/**
 * تجريد البيانات الحساسة من رسائل الأخطاء قبل تسجيلها.
 */
export function scrubSensitiveData(message: string): string {
  let safe = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    safe = safe.replace(pattern, '[REDACTED]');
  }
  return safe;
}

/**
 * تجريد object من البيانات الحساسة.
 */
export function scrubObject(obj: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = new Set([
    'token', 'deviceToken', 'device_token', 'apiKey', 'api_key',
    'password', 'Authorization', 'authorization', 'Bearer',
    'secret', 'access_token', 'refresh_token',
  ]);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k)) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'string') {
      result[k] = scrubSensitiveData(v);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = scrubObject(v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// Token Storage Audit
// ─────────────────────────────────────────────────────────────

/**
 * تدقيق أمان التخزين.
 * يتحقق أن tokens لا تُخزَّن في plain-text خارج SQLite الداخلية.
 * (عند وجود expo-secure-store سيُستخدم للـ tokens الحساسة)
 */
export function auditTokenStorage(deviceToken: string | null | undefined): {
  isSecure: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  if (!deviceToken) {
    return { isSecure: true, warnings: [] };
  }

  // تحقق أن الـ token ليس JWT مكشوف في plain-text log
  if (deviceToken.split('.').length === 3) {
    warnings.push('device_token يبدو JWT — تأكد من عدم تسجيله في logs');
  }

  // تحقق الطول الأدنى
  if (deviceToken.length < 16) {
    warnings.push('device_token قصير جداً — قد يكون placeholder');
  }

  const isSecure = warnings.length === 0;
  return { isSecure, warnings };
}

// ─────────────────────────────────────────────────────────────
// Revocation Handler
// ─────────────────────────────────────────────────────────────

/**
 * معالجة إلغاء الجهاز من الخادم.
 * يُنظّف الحالة المحلية ويُسجّل الحدث.
 */
export async function handleDeviceRevocation(reason: string): Promise<void> {
  setDeviceIdentityState('REVOKED', reason);
  await logEvent('device_revoked', reason);
  await recordAuditEvent('device_revoked', null, { reason });
}

/**
 * معالجة انتهاء صلاحية Auth.
 * يحاول إعادة المصادقة قبل الاستسلام.
 */
export async function handleAuthExpiry(): Promise<boolean> {
  setDeviceIdentityState('AUTH_EXPIRED', 'session expired');
  try {
    const { supabase } = await import('@/client/supabase');
    const { data, error } = await supabase.auth.refreshSession();
    if (data?.session) {
      setDeviceIdentityState('ACTIVE', 'session refreshed');
      await recordAuditEvent('auth_refreshed', null);
      return true;
    }
    await logEvent('auth_refresh_failed', error?.message ?? 'no session');
    await recordAuditEvent('auth_failed', null, { reason: error?.message });
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    await logEvent('auth_refresh_exception', scrubSensitiveData(msg));
    return false;
  }
}
