-- Fix RLS policies for telegram_bot_configs to avoid relying on app.current_account_id
-- which is not set by client queries. Use a SECURITY DEFINER helper that derives
-- account_id from the authenticated user instead.

CREATE OR REPLACE FUNCTION public.get_current_account_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_id
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

-- Drop the broken policies on telegram_bot_configs
DROP POLICY IF EXISTS telegram_bot_configs_select ON public.telegram_bot_configs;
DROP POLICY IF EXISTS telegram_bot_configs_insert ON public.telegram_bot_configs;
DROP POLICY IF EXISTS telegram_bot_configs_update ON public.telegram_bot_configs;
DROP POLICY IF EXISTS telegram_bot_configs_delete ON public.telegram_bot_configs;

-- Recreate policies using the helper function
CREATE POLICY telegram_bot_configs_select
  ON public.telegram_bot_configs FOR SELECT
  USING (account_id = public.get_current_account_id());

CREATE POLICY telegram_bot_configs_insert
  ON public.telegram_bot_configs FOR INSERT
  WITH CHECK (account_id = public.get_current_account_id());

CREATE POLICY telegram_bot_configs_update
  ON public.telegram_bot_configs FOR UPDATE
  USING (account_id = public.get_current_account_id());

CREATE POLICY telegram_bot_configs_delete
  ON public.telegram_bot_configs FOR DELETE
  USING (account_id = public.get_current_account_id());
