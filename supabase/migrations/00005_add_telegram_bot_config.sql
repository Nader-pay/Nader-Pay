-- إعدادات بوت Telegram
CREATE TABLE IF NOT EXISTS public.telegram_bot_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  bot_token text NOT NULL,
  bot_username text,
  chat_id text,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
  alert_events text[] NOT NULL DEFAULT ARRAY['payment.confirmed', 'payment.rejected', 'payment.review_required'],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_bot_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_telegram_select"
  ON public.telegram_bot_configs FOR SELECT
  USING (account_id = current_setting('app.current_account_id')::uuid);

CREATE POLICY "account_telegram_insert"
  ON public.telegram_bot_configs FOR INSERT
  WITH CHECK (account_id = current_setting('app.current_account_id')::uuid);

CREATE POLICY "account_telegram_update"
  ON public.telegram_bot_configs FOR UPDATE
  USING (account_id = current_setting('app.current_account_id')::uuid);

CREATE POLICY "account_telegram_delete"
  ON public.telegram_bot_configs FOR DELETE
  USING (account_id = current_setting('app.current_account_id')::uuid);
