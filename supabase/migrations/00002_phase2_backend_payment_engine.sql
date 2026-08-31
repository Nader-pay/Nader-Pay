
-- =====================================================
-- Phase 2 — Backend Payment Engine Schema
-- =====================================================

-- ─── API Credentials ─────────────────────────────────────
CREATE TABLE public.api_credentials (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  key_id         text NOT NULL UNIQUE,
  secret_hash    text NOT NULL,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  label          text,
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── Device Credentials ───────────────────────────────────
CREATE TABLE public.device_credentials (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id      uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  token_hash     text NOT NULL UNIQUE,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz
);

-- ─── Idempotency Keys ─────────────────────────────────────
CREATE TABLE public.idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  endpoint        text NOT NULL,
  response_body   jsonb,
  status_code     int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, idempotency_key, endpoint)
);

-- ─── Webhook Endpoints ────────────────────────────────────
CREATE TABLE public.webhook_endpoints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  url         text NOT NULL,
  secret      text NOT NULL,
  events      text[] NOT NULL DEFAULT ARRAY['payment.confirmed','payment.rejected','payment.review_required','payment.expired'],
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Webhook Deliveries ───────────────────────────────────
CREATE TABLE public.webhook_deliveries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  endpoint_id        uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  payment_request_id uuid REFERENCES public.payment_requests(id) ON DELETE SET NULL,
  event_type         text NOT NULL,
  payload            jsonb NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','exhausted')),
  attempts           int NOT NULL DEFAULT 0,
  max_attempts       int NOT NULL DEFAULT 5,
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  last_error         text,
  delivered_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ─── metadata column on payment_requests ──────────────────
ALTER TABLE public.payment_requests ADD COLUMN IF NOT EXISTS metadata jsonb;

-- ─── RLS ─────────────────────────────────────────────────
ALTER TABLE public.api_credentials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_credentials    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user sees own account credentials" ON public.api_credentials
  FOR SELECT TO authenticated USING (account_id = get_user_account_id(auth.uid()));
CREATE POLICY "admin full access credentials" ON public.api_credentials
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin'::public.user_role);

CREATE POLICY "user sees own device credentials" ON public.device_credentials
  FOR SELECT TO authenticated USING (account_id = get_user_account_id(auth.uid()));
CREATE POLICY "admin full access device_credentials" ON public.device_credentials
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin'::public.user_role);

CREATE POLICY "admin only idempotency_keys" ON public.idempotency_keys
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin'::public.user_role);

CREATE POLICY "user sees own webhook endpoints" ON public.webhook_endpoints
  FOR SELECT TO authenticated USING (account_id = get_user_account_id(auth.uid()));
CREATE POLICY "admin full access webhook_endpoints" ON public.webhook_endpoints
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin'::public.user_role);

CREATE POLICY "user sees own webhook deliveries" ON public.webhook_deliveries
  FOR SELECT TO authenticated USING (account_id = get_user_account_id(auth.uid()));
CREATE POLICY "admin full access webhook_deliveries" ON public.webhook_deliveries
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin'::public.user_role);

-- ─── Indexes ──────────────────────────────────────────────
CREATE INDEX idx_api_credentials_account_id   ON public.api_credentials(account_id);
CREATE INDEX idx_api_credentials_key_id       ON public.api_credentials(key_id);
CREATE INDEX idx_device_credentials_device_id ON public.device_credentials(device_id);
CREATE INDEX idx_device_credentials_token     ON public.device_credentials(token_hash);
CREATE INDEX idx_idempotency_account_key      ON public.idempotency_keys(account_id, idempotency_key, endpoint);
CREATE INDEX idx_webhook_deliveries_status    ON public.webhook_deliveries(status, next_attempt_at)
  WHERE status IN ('pending','failed');
CREATE INDEX idx_webhook_deliveries_account   ON public.webhook_deliveries(account_id);
