-- =====================================================
-- Phase 3 — Payment Integration Upgrade
-- =====================================================

-- ─── Integrations enhancements ────────────────────────
ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS enabled_events text[] DEFAULT ARRAY['payment.confirmed','payment.rejected','payment.review_required','payment.expired'],
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- ─── Webhook endpoints enhancements ───────────────────
ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS timeout_seconds int NOT NULL DEFAULT 10;

-- ─── Webhook deliveries enhancements ──────────────────
ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS event_id text,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

-- ─── Telegram bot config enhancements ─────────────────
ALTER TABLE public.telegram_bot_configs
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS is_sendable boolean DEFAULT false;

-- ─── Indexes for performance ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_integrations_account_id ON public.integrations(account_id);
CREATE INDEX IF NOT EXISTS idx_integrations_api_credential_id ON public.integrations(api_credential_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event_id ON public.webhook_deliveries(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint_created ON public.webhook_deliveries(endpoint_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON public.audit_events(entity, entity_id, created_at);

-- ─── Make webhook_deliveries.event_id unique per account ─
ALTER TABLE public.webhook_deliveries
  ADD CONSTRAINT unique_event_delivery UNIQUE (account_id, event_id, endpoint_id);
