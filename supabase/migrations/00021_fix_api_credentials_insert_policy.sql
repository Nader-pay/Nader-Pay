
-- إضافة INSERT + UPDATE + DELETE policies لـ api_credentials للـ service_role (adminClient)
-- حالياً: فقط SELECT للمستخدم العادي + ALL للأدمن — لكن الـ Edge Functions (service_role) تحتاج INSERT

-- إزالة policies القديمة المحدودة وإعادة كتابتها بشكل صحيح
DROP POLICY IF EXISTS "user sees own account credentials" ON api_credentials;
DROP POLICY IF EXISTS "admin full access credentials" ON api_credentials;

-- policy للقراءة: المستخدم يرى credentials حسابه
CREATE POLICY "credentials_select_own"
  ON api_credentials FOR SELECT
  TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));

-- policy للكتابة الكاملة للأدمن
CREATE POLICY "credentials_admin_all"
  ON api_credentials FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) = 'admin'::user_role)
  WITH CHECK (get_user_role(auth.uid()) = 'admin'::user_role);

-- إصلاح webhook_endpoints policies — إضافة INSERT/UPDATE/DELETE للمستخدمين العاديين
DROP POLICY IF EXISTS "user sees own webhook endpoints" ON webhook_endpoints;
DROP POLICY IF EXISTS "admin full access webhook_endpoints" ON webhook_endpoints;

CREATE POLICY "webhook_endpoints_select_own"
  ON webhook_endpoints FOR SELECT
  TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));

CREATE POLICY "webhook_endpoints_admin_all"
  ON webhook_endpoints FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) = 'admin'::user_role)
  WITH CHECK (get_user_role(auth.uid()) = 'admin'::user_role);

-- تأكد أن webhook_secrets تقبل كتابة service_role (بالفعل service_role يتجاوز RLS)
-- لكن نصلح policies الفارغة (false) لتكون أوضح
DROP POLICY IF EXISTS "webhook_secrets_service_delete" ON webhook_secrets;
DROP POLICY IF EXISTS "webhook_secrets_service_insert" ON webhook_secrets;
DROP POLICY IF EXISTS "webhook_secrets_service_select" ON webhook_secrets;
DROP POLICY IF EXISTS "webhook_secrets_service_update" ON webhook_secrets;

-- webhook_secrets: لا أحد يقرأها مباشرة (service_role فقط عبر Edge Functions)
CREATE POLICY "webhook_secrets_no_direct_access"
  ON webhook_secrets FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
