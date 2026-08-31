-- =====================================================
-- 00011 — Nader Pay Integration Final Specification schema
-- =====================================================

-- ─── 1. payment_requests: order_reference + structured request body ───
ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS order_reference text,
  ADD COLUMN IF NOT EXISTS destination jsonb,
  ADD COLUMN IF NOT EXISTS customer jsonb,
  ADD COLUMN IF NOT EXISTS verification jsonb;

CREATE INDEX IF NOT EXISTS idx_payment_requests_order_reference
  ON public.payment_requests(account_id, order_reference);

-- ─── 2. integrations: type + last_activity + status + environment ───
ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_integrations_type
  ON public.integrations(account_id, type, status);

-- ─── 3. webhook_deliveries: integration_id, response_time, sending status ───
ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS integration_id uuid,
  ADD COLUMN IF NOT EXISTS response_time_ms int,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'webhook_deliveries_integration_fk'
      AND table_name = 'webhook_deliveries'
  ) THEN
    ALTER TABLE public.webhook_deliveries
      ADD CONSTRAINT webhook_deliveries_integration_fk
      FOREIGN KEY (integration_id) REFERENCES public.integrations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_integration
  ON public.webhook_deliveries(account_id, integration_id, created_at DESC);

-- ─── 4. webhook_secrets: secure storage for per-integration secrets ───
CREATE TABLE IF NOT EXISTS public.webhook_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  secret_hash text NOT NULL,
  encrypted_secret text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_webhook_secrets_integration
  ON public.webhook_secrets(account_id, integration_id, status);

ALTER TABLE public.webhook_secrets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_secrets_select ON public.webhook_secrets;
DROP POLICY IF EXISTS webhook_secrets_insert ON public.webhook_secrets;
DROP POLICY IF EXISTS webhook_secrets_update ON public.webhook_secrets;
DROP POLICY IF EXISTS webhook_secrets_delete ON public.webhook_secrets;

CREATE POLICY webhook_secrets_select ON public.webhook_secrets
  FOR SELECT TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));

CREATE POLICY webhook_secrets_insert ON public.webhook_secrets
  FOR INSERT TO authenticated
  WITH CHECK (account_id = get_user_account_id(auth.uid()));

CREATE POLICY webhook_secrets_update ON public.webhook_secrets
  FOR UPDATE TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));

CREATE POLICY webhook_secrets_delete ON public.webhook_secrets
  FOR DELETE TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));

-- ─── 5. api_credential_nonces: HMAC nonce replay protection ───
CREATE TABLE IF NOT EXISTS public.api_credential_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  key_id text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, key_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_api_credential_nonces
  ON public.api_credential_nonces(account_id, key_id, nonce, expires_at);

ALTER TABLE public.api_credential_nonces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_credential_nonces_insert ON public.api_credential_nonces;
DROP POLICY IF EXISTS api_credential_nonces_select ON public.api_credential_nonces;

CREATE POLICY api_credential_nonces_insert ON public.api_credential_nonces
  FOR INSERT TO authenticated
  WITH CHECK (account_id = get_user_account_id(auth.uid()));

CREATE POLICY api_credential_nonces_select ON public.api_credential_nonces
  FOR SELECT TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));

-- ─── 6. device_status enum expansion ───
ALTER TYPE public.device_status ADD VALUE IF NOT EXISTS 'blocked';
ALTER TYPE public.device_status ADD VALUE IF NOT EXISTS 'requires_update';
ALTER TYPE public.device_status ADD VALUE IF NOT EXISTS 'risk_review';
ALTER TYPE public.device_status ADD VALUE IF NOT EXISTS 'online';
ALTER TYPE public.device_status ADD VALUE IF NOT EXISTS 'offline';

-- ─── 7. subscription_status text expansion ───
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check,
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled', 'suspended', 'expired'));

-- ─── 8. Ensure webhook_endpoints has environment + status columns ───
ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- ─── 9. Ensure api_credentials has hmac_enabled / rotation fields ───
ALTER TABLE public.api_credentials
  ADD COLUMN IF NOT EXISTS hmac_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rotated_at timestamptz;
