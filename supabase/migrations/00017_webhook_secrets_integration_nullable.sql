ALTER TABLE public.webhook_secrets ALTER COLUMN integration_id DROP NOT NULL;

-- Now re-run migration for plaintext secrets
INSERT INTO public.webhook_secrets (
  account_id,
  endpoint_id,
  integration_id,
  secret_hash,
  encrypted_secret,
  status
)
SELECT
  we.account_id,
  we.id,
  we.integration_id,
  encode(digest(we.secret, 'sha256'), 'hex'),
  we.secret,
  'active'
FROM public.webhook_endpoints we
WHERE we.secret IS NOT NULL
  AND we.secret <> ''
  AND we.secret <> '[stored-encrypted]'
  AND we.auth_mode = 'hmac'
  AND NOT EXISTS (
    SELECT 1 FROM public.webhook_secrets ws
    WHERE ws.endpoint_id = we.id AND ws.status = 'active'
  );

-- Clear plaintext secrets from webhook_endpoints after migration
UPDATE public.webhook_endpoints
SET secret = '[stored-encrypted]'
WHERE secret IS NOT NULL
  AND secret <> ''
  AND secret <> '[stored-encrypted]';