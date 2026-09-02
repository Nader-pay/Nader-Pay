/**
 * remoteConfigService.ts
 * ══════════════════════════════════════════════════════════════════
 * نظام Remote Config — يجلب إعدادات الـ app من Supabase Edge Function
 * ويخزّنها محلياً مع TTL 30 دقيقة.
 *
 * الهدف: التحكم في سلوك الـ app من السيرفر بدون تحديث APK:
 *  - تعديل أنماط الرصيد (regex)
 *  - تعديل هامش الخطأ (tolerance)
 *  - تعطيل ميزة كاملة (feature flag)
 *  - عرض رسالة صيانة
 *  - إجبار التحديث لنسخة معينة
 *
 * يعمل بـ Fallback للقيم الافتراضية الصلبة إذا فشل الـ fetch.
 * ══════════════════════════════════════════════════════════════════
 */

import { fetch } from 'expo/fetch';
import { getSetting, setSetting } from '@/lib/database';

// ─── ثوابت ────────────────────────────────────────────────────────────────────

const CACHE_KEY_DATA    = '@remote_config:data';
const CACHE_KEY_TS      = '@remote_config:fetched_at';
const CACHE_TTL_MS      = 30 * 60 * 1000; // 30 دقيقة

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  'https://hbldhnpduoczneoyfzyz.supabase.co';

const REMOTE_CONFIG_URL = `${SUPABASE_URL}/functions/v1/remote-config`;

// ─── القيم الافتراضية الصلبة (Fallback) ────────────────────────────────────────
// تُستخدَم إذا فشل fetch أو انتهت صلاحية الكاش

export const DEFAULT_CONFIG: RemoteConfig = {
  // Balance Evidence
  balance_evidence_enabled:       true,
  balance_max_messages:           1000,
  balance_tolerance_egp:          1.0,
  balance_search_window_days:     30,
  balance_promo_reject_patterns: [
    'عرض خصم',
    'استمتع بخصم',
    'احصل على خصم',
    'خصم \\d+\\s*%',
    'congratulation',
  ],
  vf_cash_keywords: [
    'vodafone cash', 'vodafonecash', 'فودافون كاش', 'فودافون',
    'محفظتك', 'رصيدك الحالي', 'رصيد حسابك', 'رصيد محفظتك',
  ],
  balance_label_patterns: [
    'رصيدك الحالي',
    'رصيد حسابك الحالي',
    'رصيد حسابك',
    'رصيد محفظتك',
    'الرصيد الحالي',
    'رصيدك',
  ],
  // Verification
  verification_auto_confirm:    true,
  verification_min_match_score: 70,
  verification_retry_max:       3,
  // App
  app_polling_interval_ms:      30_000,
  app_debug_mode:                false,
  app_force_update_version:      '',
  app_maintenance_mode:          false,
  app_maintenance_message:       'التطبيق تحت الصيانة، يرجى المحاولة لاحقاً',
};

// ─── نوع الإعدادات ────────────────────────────────────────────────────────────

export type RemoteConfig = {
  // Balance
  balance_evidence_enabled:       boolean;
  balance_max_messages:           number;
  balance_tolerance_egp:          number;
  balance_search_window_days:     number;
  balance_promo_reject_patterns:  string[];
  vf_cash_keywords:               string[];
  balance_label_patterns:         string[];
  // Verification
  verification_auto_confirm:      boolean;
  verification_min_match_score:   number;
  verification_retry_max:         number;
  // App
  app_polling_interval_ms:        number;
  app_debug_mode:                 boolean;
  app_force_update_version:       string;
  app_maintenance_mode:           boolean;
  app_maintenance_message:        string;
};

// ─── الكاش في الذاكرة ─────────────────────────────────────────────────────────

let _memCache: RemoteConfig | null = null;
let _memCacheTs = 0;

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === 'true')  return true;
  if (v === 'false') return false;
  return fallback;
}

function parseNum(v: string | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

function parseJson<T>(v: string | undefined, fallback: T): T {
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function parseStr(v: string | undefined, fallback: string): string {
  return (v !== undefined && v !== '') ? v : fallback;
}

/** تحويل raw Record<string,string> من السيرفر → RemoteConfig typed */
function parseRawConfig(raw: Record<string, string>): RemoteConfig {
  const D = DEFAULT_CONFIG;
  return {
    balance_evidence_enabled:      parseBool(raw.balance_evidence_enabled,       D.balance_evidence_enabled),
    balance_max_messages:          parseNum(raw.balance_max_messages,             D.balance_max_messages),
    balance_tolerance_egp:         parseNum(raw.balance_tolerance_egp,            D.balance_tolerance_egp),
    balance_search_window_days:    parseNum(raw.balance_search_window_days,       D.balance_search_window_days),
    balance_promo_reject_patterns: parseJson(raw.balance_promo_reject_patterns,   D.balance_promo_reject_patterns),
    vf_cash_keywords:              parseJson(raw.vf_cash_keywords,                D.vf_cash_keywords),
    balance_label_patterns:        parseJson(raw.balance_label_patterns,          D.balance_label_patterns),
    verification_auto_confirm:     parseBool(raw.verification_auto_confirm,       D.verification_auto_confirm),
    verification_min_match_score:  parseNum(raw.verification_min_match_score,     D.verification_min_match_score),
    verification_retry_max:        parseNum(raw.verification_retry_max,           D.verification_retry_max),
    app_polling_interval_ms:       parseNum(raw.app_polling_interval_ms,          D.app_polling_interval_ms),
    app_debug_mode:                parseBool(raw.app_debug_mode,                  D.app_debug_mode),
    app_force_update_version:      parseStr(raw.app_force_update_version,         D.app_force_update_version),
    app_maintenance_mode:          parseBool(raw.app_maintenance_mode,            D.app_maintenance_mode),
    app_maintenance_message:       parseStr(raw.app_maintenance_message,          D.app_maintenance_message),
  };
}

// ─── الحفظ والقراءة من SQLite (عبر database lib الموجودة) ────────────────────

async function saveToLocalDB(config: RemoteConfig): Promise<void> {
  try {
    await setSetting(CACHE_KEY_DATA, JSON.stringify(config));
    await setSetting(CACHE_KEY_TS,   String(Date.now()));
  } catch {
    // ignore — الكاش في الذاكرة كافٍ
  }
}

async function loadFromLocalDB(): Promise<{ config: RemoteConfig; ts: number } | null> {
  try {
    const raw = await getSetting(CACHE_KEY_DATA);
    const ts  = await getSetting(CACHE_KEY_TS);
    if (!raw || !ts) return null;
    return { config: JSON.parse(raw) as RemoteConfig, ts: parseInt(ts, 10) };
  } catch {
    return null;
  }
}

// ─── الدالة الرئيسية ──────────────────────────────────────────────────────────

/**
 * جلب Remote Config من السيرفر أو من الكاش.
 *
 * @param forceRefresh - إجبار تجديد الكاش حتى لو لم تنته المدة
 * @returns RemoteConfig — دائماً يُعيد قيمة (Fallback إذا فشل)
 */
export async function getRemoteConfig(forceRefresh = false): Promise<RemoteConfig> {
  const now = Date.now();

  // ① كاش الذاكرة (أسرع)
  if (!forceRefresh && _memCache && (now - _memCacheTs) < CACHE_TTL_MS) {
    return _memCache;
  }

  // ② كاش SQLite (يعمل offline)
  if (!forceRefresh) {
    const local = await loadFromLocalDB();
    if (local && (now - local.ts) < CACHE_TTL_MS) {
      _memCache  = local.config;
      _memCacheTs = local.ts;
      return local.config;
    }
  }

  // ③ Fetch من السيرفر
  if (process.env.EXPO_OS !== 'web') {
    // على Android/iOS فقط
    try {
      const resp = await fetch(REMOTE_CONFIG_URL, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (resp.ok) {
        const json = await resp.json() as {
          configs: Record<string, string>;
          updated_at: string;
        };
        const config = parseRawConfig(json.configs ?? {});

        // حفظ في الكاشات
        _memCache   = config;
        _memCacheTs = now;
        await saveToLocalDB(config);

        if (__DEV__) {
          console.log('[RemoteConfig] ✅ محدَّث من السيرفر — updated_at:', json.updated_at);
        }
        return config;
      } else {
        console.warn('[RemoteConfig] HTTP', resp.status, '— استخدام الكاش/الافتراضي');
      }
    } catch (err) {
      console.warn('[RemoteConfig] fetch فشل:', err, '— استخدام الكاش/الافتراضي');
    }
  }

  // ④ Fallback: آخر كاش SQLite حتى لو انتهت مدته
  const stale = await loadFromLocalDB();
  if (stale) {
    _memCache  = stale.config;
    _memCacheTs = now;
    return stale.config;
  }

  // ⑤ آخر fallback: القيم الافتراضية الصلبة
  return DEFAULT_CONFIG;
}

/**
 * مسح الكاش وإجبار fetch في المرة القادمة.
 */
export async function clearRemoteConfigCache(): Promise<void> {
  _memCache  = null;
  _memCacheTs = 0;
  try {
    await setSetting(CACHE_KEY_DATA, '');
    await setSetting(CACHE_KEY_TS,   '');
  } catch {
    // ignore
  }
}

/**
 * قراءة مباشرة بدون await للاستخدام في الكود المتزامن.
 * يُعيد الكاش في الذاكرة أو الافتراضي.
 * لا يُطلق fetch — استخدم getRemoteConfig() أولاً لضمان التحديث.
 */
export function getRemoteConfigSync(): RemoteConfig {
  return _memCache ?? DEFAULT_CONFIG;
}
