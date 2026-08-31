-- المرحلة 1: إضافة كيانات Nader Pay الجديدة
CREATE TABLE IF NOT EXISTS public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  website_url text,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'live')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'inactive', 'pending')),
  api_credential_id uuid REFERENCES public.api_credentials(id) ON DELETE SET NULL,
  webhook_endpoint_id uuid REFERENCES public.webhook_endpoints(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  limits jsonb NOT NULL DEFAULT '{}',
  features text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled', 'suspended')),
  trial_ends_at timestamptz,
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  actor text,
  ip_address text,
  user_agent text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users
CREATE POLICY "account_integrations_select"
  ON public.integrations FOR SELECT
  USING (account_id = current_setting('app.current_account_id')::uuid);

CREATE POLICY "account_plans_select"
  ON public.plans FOR SELECT
  USING (true);

CREATE POLICY "account_subscriptions_select"
  ON public.subscriptions FOR SELECT
  USING (account_id = current_setting('app.current_account_id')::uuid);

CREATE POLICY "account_security_events_select"
  ON public.security_events FOR SELECT
  USING (account_id = current_setting('app.current_account_id')::uuid);

-- Seed a default plan
INSERT INTO public.plans (name, limits, features)
VALUES (
  'Starter',
  '{"payment_requests": 1000, "transactions": 5000, "active_devices": 3}',
  ARRAY['webhooks', 'audit_logs', 'telegram_alerts']
)
ON CONFLICT DO NOTHING;
