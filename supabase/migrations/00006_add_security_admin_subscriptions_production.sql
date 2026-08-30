-- توسيع الجداول لتغطية الأمان والتحكم والإنتاج

-- أحداث الأمان: إضافة device_id و resolved_at
ALTER TABLE public.security_events
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- هوية الجهاز: إضافة installation_id, credential_id, risk_level
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS installation_id text,
  ADD COLUMN IF NOT EXISTS credential_id text,
  ADD COLUMN IF NOT EXISTS risk_level text DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical'));

-- دور المستخدم داخل الحساب
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS org_role text DEFAULT 'viewer' CHECK (org_role IN ('owner', 'admin', 'operator', 'viewer'));

-- دور Super Admin
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- دورات حياة الاشتراك
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at timestamptz;

-- إعدادات السيرفر (Remote Control / Global Policies)
CREATE TABLE IF NOT EXISTS public.global_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_enabled boolean NOT NULL DEFAULT true,
  minimum_supported_version text NOT NULL DEFAULT '1.0.0',
  force_update boolean NOT NULL DEFAULT false,
  integrity_required boolean NOT NULL DEFAULT false,
  blocked_versions text[] NOT NULL DEFAULT '{}',
  provider_config jsonb DEFAULT '{}',
  subscription_config jsonb DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- جدول إصدارات التطبيق
CREATE TABLE IF NOT EXISTS public.app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  build text NOT NULL,
  channel text NOT NULL DEFAULT 'production',
  minimum_supported_version text NOT NULL DEFAULT '1.0.0',
  rollout_percentage integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'deprecated')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- إعدادات Super Admin
CREATE TABLE IF NOT EXISTS public.super_admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mfa_verified boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.global_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admin_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "global_policies_read_all"
  ON public.global_policies FOR SELECT
  USING (true);

CREATE POLICY "app_releases_read_all"
  ON public.app_releases FOR SELECT
  USING (true);

CREATE POLICY "super_admin_sessions_own"
  ON public.super_admin_sessions FOR ALL
  USING (profile_id = current_setting('app.current_profile_id')::uuid);

-- Seed default global policy
INSERT INTO public.global_policies (service_enabled, minimum_supported_version, force_update, integrity_required, blocked_versions)
VALUES (true, '1.0.0', false, false, '{}')
ON CONFLICT DO NOTHING;

-- Seed default plans
INSERT INTO public.plans (name, limits, features)
VALUES ('Pro', '{"payment_requests": 10000, "transactions": 50000, "active_devices": 10, "webhooks": 100000}', ARRAY['webhooks', 'audit_logs', 'telegram_alerts', 'priority_support'])
ON CONFLICT DO NOTHING;

INSERT INTO public.plans (name, limits, features)
VALUES ('Enterprise', '{"payment_requests": 100000, "transactions": 500000, "active_devices": 50, "webhooks": 1000000}', ARRAY['all_features', 'dedicated_support', 'sla'])
ON CONFLICT DO NOTHING;
