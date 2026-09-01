-- =====================================================
-- 00013 — Webhook Auth Pipeline + Secret Storage
-- =====================================================

-- 1. Store API credential secret encrypted so outgoing webhooks can use it for Authorization Bearer
ALTER TABLE public.api_credentials
  ADD COLUMN IF NOT EXISTS encrypted_secret text;

-- 2. Track which webhook events have already been received (replay protection)
CREATE TABLE IF NOT EXISTS public.webhook_received_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  endpoint_path text NOT NULL DEFAULT 'naderpay-webhook',
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, event_id, endpoint_path)
);

CREATE INDEX IF NOT EXISTS idx_webhook_received_events_lookup
  ON public.webhook_received_events(account_id, event_id, endpoint_path);

ALTER TABLE public.webhook_received_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_received_events_select ON public.webhook_received_events;
DROP POLICY IF EXISTS webhook_received_events_insert ON public.webhook_received_events;
DROP POLICY IF EXISTS webhook_received_events_delete ON public.webhook_received_events;

CREATE POLICY webhook_received_events_select ON public.webhook_received_events
  FOR SELECT TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));

CREATE POLICY webhook_received_events_insert ON public.webhook_received_events
  FOR INSERT TO authenticated
  WITH CHECK (account_id = get_user_account_id(auth.uid()));

CREATE POLICY webhook_received_events_delete ON public.webhook_received_events
  FOR DELETE TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));
