-- Drop the old broken policies that still reference app.current_account_id
-- and conflict with the new helper-based policies.
DROP POLICY IF EXISTS account_telegram_select ON public.telegram_bot_configs;
DROP POLICY IF EXISTS account_telegram_insert ON public.telegram_bot_configs;
DROP POLICY IF EXISTS account_telegram_update ON public.telegram_bot_configs;
DROP POLICY IF EXISTS account_telegram_delete ON public.telegram_bot_configs;
