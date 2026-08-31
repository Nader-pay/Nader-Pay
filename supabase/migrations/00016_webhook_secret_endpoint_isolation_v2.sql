DO $$
BEGIN
  -- Add endpoint_id to webhook_secrets if not exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_secrets' AND column_name = 'endpoint_id') THEN
    ALTER TABLE public.webhook_secrets ADD COLUMN endpoint_id uuid REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE;
  END IF;

  -- Make webhook_endpoints.secret nullable to allow phasing out plaintext storage
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_endpoints' AND column_name = 'secret') THEN
    ALTER TABLE public.webhook_endpoints ALTER COLUMN secret DROP NOT NULL;
  END IF;

  -- Add indexes for endpoint_id and integration_id lookups
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_webhook_secrets_endpoint_id_status') THEN
    CREATE INDEX idx_webhook_secrets_endpoint_id_status ON public.webhook_secrets(endpoint_id, status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_webhook_secrets_integration_id_status') THEN
    CREATE INDEX idx_webhook_secrets_integration_id_status ON public.webhook_secrets(integration_id, status);
  END IF;
END
$$;

-- Drop the authenticated policies on webhook_secrets to prevent frontend exposure
DROP POLICY IF EXISTS webhook_secrets_select ON public.webhook_secrets;
DROP POLICY IF EXISTS webhook_secrets_insert ON public.webhook_secrets;
DROP POLICY IF EXISTS webhook_secrets_update ON public.webhook_secrets;
DROP POLICY IF EXISTS webhook_secrets_delete ON public.webhook_secrets;

-- Re-create webhook_secrets policies that deny all authenticated direct access
CREATE POLICY webhook_secrets_service_select ON public.webhook_secrets
  AS PERMISSIVE FOR SELECT TO authenticated USING (false);

CREATE POLICY webhook_secrets_service_insert ON public.webhook_secrets
  AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY webhook_secrets_service_update ON public.webhook_secrets
  AS PERMISSIVE FOR UPDATE TO authenticated USING (false);

CREATE POLICY webhook_secrets_service_delete ON public.webhook_secrets
  AS PERMISSIVE FOR DELETE TO authenticated USING (false);

-- Create safe view for frontend that excludes the secret column
DROP VIEW IF EXISTS public.webhook_endpoints_safe;
CREATE VIEW public.webhook_endpoints_safe AS
SELECT
  id,
  account_id,
  integration_id,
  url,
  events,
  status,
  created_at,
  updated_at,
  timeout_seconds,
  environment,
  auth_mode,
  auth_config,
  last_test_at,
  health_status
FROM public.webhook_endpoints;

ALTER VIEW public.webhook_endpoints_safe SET (security_invoker = on);

-- Ensure RLS is enabled
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_secrets ENABLE ROW LEVEL SECURITY;

-- Function to return active secret for an endpoint (Edge Functions / service role only)
DROP FUNCTION IF EXISTS public.get_active_webhook_secret(uuid);
CREATE OR REPLACE FUNCTION public.get_active_webhook_secret(p_endpoint_id uuid)
RETURNS TABLE(secret_hash text, encrypted_secret text, status text) AS $$
BEGIN
  RETURN QUERY
  SELECT ws.secret_hash, ws.encrypted_secret, ws.status
  FROM public.webhook_secrets ws
  WHERE ws.endpoint_id = p_endpoint_id AND ws.status = 'active'
  ORDER BY ws.created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT ws.secret_hash, ws.encrypted_secret, ws.status
    FROM public.webhook_secrets ws
    WHERE ws.integration_id = (SELECT integration_id FROM public.webhook_endpoints WHERE id = p_endpoint_id)
      AND ws.status = 'active'
    ORDER BY ws.created_at DESC
    LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
