-- تفعيل Realtime على جدول payment_requests
-- (كان supabase_realtime publication فارغاً — سبب CLOSED على كل channel)
ALTER PUBLICATION supabase_realtime ADD TABLE payment_requests;