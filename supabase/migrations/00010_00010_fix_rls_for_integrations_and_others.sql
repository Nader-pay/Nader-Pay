-- Fix RLS for tables that still use app.current_account_id or lack write policies.
-- Use get_user_account_id(auth.uid()) which is already defined and used by other tables.

-- ── integrations ──
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_integrations_select ON public.integrations;
DROP POLICY IF EXISTS account_integrations_insert ON public.integrations;
DROP POLICY IF EXISTS account_integrations_update ON public.integrations;
DROP POLICY IF EXISTS account_integrations_delete ON public.integrations;

CREATE POLICY account_integrations_select
  ON public.integrations FOR SELECT
  USING (account_id = get_user_account_id(auth.uid()));

CREATE POLICY account_integrations_insert
  ON public.integrations FOR INSERT
  WITH CHECK (account_id = get_user_account_id(auth.uid()));

CREATE POLICY account_integrations_update
  ON public.integrations FOR UPDATE
  USING (account_id = get_user_account_id(auth.uid()));

CREATE POLICY account_integrations_delete
  ON public.integrations FOR DELETE
  USING (account_id = get_user_account_id(auth.uid()));

-- ── security_events ──
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_security_events_select ON public.security_events;

CREATE POLICY account_security_events_select
  ON public.security_events FOR SELECT
  USING (account_id = get_user_account_id(auth.uid()));

-- ── subscriptions ──
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_subscriptions_select ON public.subscriptions;

CREATE POLICY account_subscriptions_select
  ON public.subscriptions FOR SELECT
  USING (account_id = get_user_account_id(auth.uid()));

-- ── plans is global read-only, no account_id needed ──
DROP POLICY IF EXISTS account_plans_select ON public.plans;

CREATE POLICY account_plans_select
  ON public.plans FOR SELECT
  USING (true);

-- ── Ensure profiles SELECT exists for the helper to work (it already does, but be safe) ──
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
