
-- Revoke old live credential
UPDATE api_credentials
SET status = 'revoked', revoked_at = NOW()
WHERE id = '79816bbd-ddc0-44c5-8826-b4f33378bc83';

-- Insert new live credential with known key+hash
INSERT INTO api_credentials (id, account_id, key_id, secret_hash, status, environment, label, hmac_enabled)
VALUES (
  gen_random_uuid(),
  'b59bc37e-8c5f-4cc6-9ff6-5bd573e4f40a',
  'pk_cf7579c9905ed65d99e93469',
  'ebb2e6c568755a9a5985a66f2fae26c0462ce72d554df549c7eeb8291a2b595c',
  'active',
  'live',
  'متجر nader ai — v2',
  false
);

-- Update integration to point to new credential
UPDATE integrations
SET api_credential_id = (
  SELECT id FROM api_credentials WHERE key_id = 'pk_cf7579c9905ed65d99e93469'
),
updated_at = NOW()
WHERE id = '6a8e4241-9adb-4936-8ea4-d93c2af47b27';

-- Revoke old webhook secrets for this integration
UPDATE webhook_secrets
SET status = 'revoked', revoked_at = NOW()
WHERE integration_id = '6a8e4241-9adb-4936-8ea4-d93c2af47b27'
  AND status = 'active';

-- Update webhook endpoint with fresh known secret + all payment events
UPDATE webhook_endpoints
SET
  secret = '62078166adf810cb8a6905024e5221abfe047274a3f8e18440106188fc540fd5',
  events = ARRAY['payment.confirmed','payment.rejected','payment.review_required','payment.expired','payment.cancelled'],
  updated_at = NOW()
WHERE id = '81fb4e4e-8928-4e29-a2c6-02377dbbdf1b';
