
-- تفعيل pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─── وظيفة: انتهاء صلاحية طلبات الدفع كل 5 دقائق ─────
SELECT cron.schedule(
  'expire-payment-requests',
  '*/5 * * * *',
  $$
    UPDATE public.payment_requests
    SET status = 'EXPIRED', updated_at = now()
    WHERE status NOT IN ('CONFIRMED','REJECTED','DUPLICATE','EXPIRED','CANCELLED')
      AND expires_at IS NOT NULL
      AND expires_at < now();
  $$
);

-- ─── وظيفة: إطلاق webhook-dispatcher كل دقيقة ─────────
SELECT cron.schedule(
  'dispatch-webhooks',
  '* * * * *',
  $$
    SELECT net.http_post(
      url      := current_setting('app.supabase_url') || '/functions/v1/webhook-dispatcher',
      headers  := jsonb_build_object(
        'Content-Type',   'application/json',
        'Authorization',  'Bearer ' || current_setting('app.service_role_key')
      ),
      body     := '{}'::jsonb
    );
  $$
);
