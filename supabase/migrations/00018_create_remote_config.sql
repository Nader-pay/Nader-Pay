
-- ══════════════════════════════════════════════════════
-- جدول Remote Config — يسمح بالتحكم في سلوك الـ app
-- من السيرفر بدون تحديث APK
-- ══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.remote_config (
  key         text        PRIMARY KEY,
  value       text        NOT NULL,
  value_type  text        NOT NULL DEFAULT 'string'
                          CHECK (value_type IN ('string','number','boolean','json')),
  description text,
  category    text        NOT NULL DEFAULT 'general',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- تحديث updated_at تلقائياً عند أي تعديل
CREATE OR REPLACE FUNCTION public.set_remote_config_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_remote_config_updated_at
  BEFORE UPDATE ON public.remote_config
  FOR EACH ROW EXECUTE FUNCTION public.set_remote_config_updated_at();

-- RLS: قراءة عامة — كتابة للـ service_role فقط
ALTER TABLE public.remote_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "remote_config_public_read"
  ON public.remote_config FOR SELECT
  USING (true);

-- ══════════════════════════════════════════════════════
-- القيم الافتراضية — كل إعدادات نظام Balance Evidence
-- ══════════════════════════════════════════════════════
INSERT INTO public.remote_config (key, value, value_type, description, category) VALUES

-- ── إعدادات استخراج الرصيد ─────────────────────────
('balance_evidence_enabled',        'true',   'boolean', 'تفعيل/تعطيل نظام Balance Evidence كاملاً',               'balance'),
('balance_max_messages',            '1000',   'number',  'الحد الأقصى لعدد الرسائل المقروءة عند البحث عن Evidence', 'balance'),
('balance_tolerance_egp',           '1.0',    'number',  'هامش الخطأ المسموح به في التحقق الحسابي (جنيه)',         'balance'),
('balance_search_window_days',      '30',     'number',  'نافذة البحث للخلف بالأيام',                              'balance'),

-- ── كلمات الرفض الترويجية (JSON array) ─────────────
('balance_promo_reject_patterns',
  '["عرض خصم","استمتع بخصم","احصل على خصم","خصم \\d+\\s*%","congratulation"]',
  'json',
  'أنماط Regex تُعرِّف الرسائل الترويجية التي يجب رفضها كـ Evidence',
  'balance'),

-- ── كلمات التعرف على رسائل VF-Cash ─────────────────
('vf_cash_keywords',
  '["vodafone cash","vodafonecash","فودافون كاش","فودافون","محفظتك","رصيدك الحالي","رصيد حسابك","رصيد محفظتك"]',
  'json',
  'الكلمات المفتاحية للتعرف على رسائل Vodafone Cash',
  'balance'),

-- ── أنماط الرصيد (Regex labels) ─────────────────────
('balance_label_patterns',
  '["رصيدك الحالي","رصيد حسابك الحالي","رصيد حسابك","رصيد محفظتك","الرصيد الحالي","رصيدك"]',
  'json',
  'قائمة labels للبحث عن الرصيد — يُضاف تلقائياً pattern للأرقام بعدها',
  'balance'),

-- ── إعدادات التحقق العام ────────────────────────────
('verification_auto_confirm',       'true',   'boolean', 'تأكيد تلقائي للعمليات المطابقة',                         'verification'),
('verification_min_match_score',    '70',     'number',  'الحد الأدنى لدرجة التطابق (0-100)',                       'verification'),
('verification_retry_max',          '3',      'number',  'الحد الأقصى لمحاولات إعادة المحاولة',                    'verification'),

-- ── إعدادات الـ app العامة ──────────────────────────
('app_polling_interval_ms',         '30000',  'number',  'فترة المسح التلقائي بالميلي ثانية',                      'app'),
('app_debug_mode',                  'false',  'boolean', 'تفعيل وضع Debug في الـ Production (للطوارئ فقط)',        'app'),
('app_force_update_version',        '',       'string',  'إذا ضُبط: يجبر المستخدمين على نسخة محددة أو أحدث',      'app'),
('app_maintenance_mode',            'false',  'boolean', 'وضع الصيانة — يوقف كل العمليات ويعرض رسالة',           'app'),
('app_maintenance_message',         'التطبيق تحت الصيانة، يرجى المحاولة لاحقاً', 'string', 'رسالة وضع الصيانة',  'app')

ON CONFLICT (key) DO NOTHING;
