
-- تحسينات الأداء والحماية من التكرار

-- 1. فهرس الأداء: webhook_deliveries بالطابور الزمني
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_queue
  ON webhook_deliveries (account_id, next_attempt_at)
  WHERE status IN ('pending', 'sending');

-- 2. فهرس الأداء: payment_requests بالحالة والحساب
CREATE INDEX IF NOT EXISTS idx_payment_requests_active
  ON payment_requests (account_id, status, created_at)
  WHERE status IN ('CREATED','WAITING_PAYMENT','MESSAGE_DETECTED','PARSING','VERIFYING');

-- 3. فهرس الأداء: transactions للمطابقة السريعة
CREATE INDEX IF NOT EXISTS idx_transactions_verify
  ON transactions (account_id, verification_status, occurred_at)
  WHERE verification_status = 'pending';

-- 4. فهرس فريد جزئي: يمنع إنشاء طلبي دفع نشطَين بنفس external_reference للحساب ذاته
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_requests_active_extref
  ON payment_requests (account_id, external_reference)
  WHERE status NOT IN ('CONFIRMED','REJECTED','DUPLICATE','EXPIRED','CANCELLED');

-- 5. فهرس الأداء: idempotency_keys للبحث السريع
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_lookup
  ON idempotency_keys (account_id, idempotency_key, created_at DESC);

-- 6. فهرس الأداء: webhook_received_events لحماية Replay
CREATE INDEX IF NOT EXISTS idx_webhook_received_events_lookup
  ON webhook_received_events (account_id, event_id);
