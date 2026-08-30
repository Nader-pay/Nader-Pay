DO $$
BEGIN
  -- أعمدة Webhook Endpoint: طريقة المصادقة وحالة الصحة
  ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS auth_mode text NOT NULL DEFAULT 'hmac';
  ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS auth_config jsonb NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS last_test_at timestamptz;
  ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'unknown';
  ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS integration_id uuid REFERENCES integrations(id) ON DELETE SET NULL;

  -- API Credential يحمل بيئة ونطاق/صلاحيات
  ALTER TABLE api_credentials ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'sandbox';
  ALTER TABLE api_credentials ADD COLUMN IF NOT EXISTS scopes text[] DEFAULT ARRAY['payments:create','payments:read'];

  -- Payment Request و Transaction: سبب الحالة/القرار
  ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS reason_code text;
  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reason_code text;

  -- Delivery: تخزين الهوية الكاملة للحدث
  ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS payload_version text;

  -- حلول مؤقتة: نربط endpoints الموجودة بالتكامل المرتبط
  UPDATE webhook_endpoints
  SET integration_id = (
    SELECT id FROM integrations WHERE integrations.webhook_endpoint_id = webhook_endpoints.id LIMIT 1
  )
  WHERE integration_id IS NULL;

  -- تحديث أنواع التكامل القديمة إلى custom (حسب مواصفات v2)
  UPDATE integrations
  SET type = 'custom'
  WHERE type NOT IN ('website','backend','telegram','custom');
END
$$;