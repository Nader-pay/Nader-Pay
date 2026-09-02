/**
 * remoteConfigSetup.js
 * يُشغَّل قبل كل test suite (setupFiles).
 * يضبط getRemoteConfigSync لتُعيد DEFAULT_CONFIG مباشرةً
 * بدون fetch حقيقي أو ESM import.
 */

// القيم الافتراضية الصلبة — يجب أن تتطابق مع DEFAULT_CONFIG في remoteConfigService.ts
const DEFAULT_CONFIG = {
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
  verification_auto_confirm:    true,
  verification_min_match_score: 70,
  verification_retry_max:       3,
  app_polling_interval_ms:      30000,
  app_debug_mode:                false,
  app_force_update_version:      '',
  app_maintenance_mode:          false,
  app_maintenance_message:       'التطبيق تحت الصيانة، يرجى المحاولة لاحقاً',
};

// يُسجَّل كـ module mock قبل أي import
jest.mock('@/services/remoteConfigService', () => ({
  getRemoteConfig:     jest.fn().mockResolvedValue(DEFAULT_CONFIG),
  getRemoteConfigSync: jest.fn().mockReturnValue(DEFAULT_CONFIG),
  clearRemoteConfigCache: jest.fn().mockResolvedValue(undefined),
  DEFAULT_CONFIG,
}));
