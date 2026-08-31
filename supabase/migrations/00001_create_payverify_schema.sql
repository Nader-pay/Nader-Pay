
-- =====================================================
-- PayVerify Dashboard - Foundation Schema
-- =====================================================

-- إنشاء أنواع Enum المطلوبة
CREATE TYPE public.user_role AS ENUM ('user', 'admin');
CREATE TYPE public.account_status AS ENUM ('active', 'suspended', 'inactive');
CREATE TYPE public.device_status AS ENUM ('active', 'inactive', 'revoked');
CREATE TYPE public.listener_status AS ENUM ('running', 'stopped', 'error', 'unknown');
CREATE TYPE public.sync_status AS ENUM ('synced', 'pending', 'failed', 'unknown');
CREATE TYPE public.payment_request_status AS ENUM (
  'CREATED', 'WAITING_PAYMENT', 'MESSAGE_DETECTED', 'PARSING',
  'VERIFYING', 'CONFIRMED', 'REJECTED', 'REVIEW_REQUIRED',
  'DUPLICATE', 'EXPIRED', 'CANCELLED', 'DEVICE_OFFLINE'
);
CREATE TYPE public.verification_status AS ENUM ('pending', 'verified', 'failed', 'duplicate', 'review_required');

-- =====================================================
-- جدول profiles (مزامن مع auth.users)
-- =====================================================
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  role public.user_role NOT NULL DEFAULT 'user',
  account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- جدول accounts
-- =====================================================
CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status public.account_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ربط profiles بـ accounts
ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

-- =====================================================
-- جدول devices
-- =====================================================
CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  device_name text NOT NULL,
  platform text NOT NULL DEFAULT 'android',
  app_version text,
  android_version text,
  status public.device_status NOT NULL DEFAULT 'active',
  last_seen_at timestamptz,
  listener_status public.listener_status NOT NULL DEFAULT 'unknown',
  sync_status public.sync_status NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- جدول payment_requests
-- =====================================================
CREATE TABLE public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  external_reference text NOT NULL,
  payment_type text NOT NULL DEFAULT 'wallet',
  amount numeric(18, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  expected_sender_phone text,
  expected_sender_name text,
  expected_recipient_wallet text,
  status public.payment_request_status NOT NULL DEFAULT 'CREATED',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- جدول transactions
-- =====================================================
CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  transaction_id text NOT NULL,
  amount numeric(18, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'EGP',
  sender_phone text,
  sender_name text,
  recipient_wallet text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  raw_message text,
  normalized_message text,
  message_hash text,
  source_package text,
  detected_by_device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  verification_status public.verification_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, transaction_id)
);

-- =====================================================
-- جدول payment_matches
-- =====================================================
CREATE TABLE public.payment_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  payment_request_id uuid NOT NULL REFERENCES public.payment_requests(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  matched_at timestamptz NOT NULL DEFAULT now(),
  matched_by text,
  notes text,
  UNIQUE (payment_request_id),
  UNIQUE (transaction_id)
);

-- =====================================================
-- جدول audit_events
-- =====================================================
CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  actor text NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  metadata jsonb,
  previous_hash text,
  event_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- Trigger: مزامنة auth.users مع profiles
-- =====================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'user'::public.user_role);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- Helper: get_user_role (SECURITY DEFINER - يمنع infinite recursion)
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid)
RETURNS public.user_role
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = uid;
$$;

-- Helper: get_user_account_id
CREATE OR REPLACE FUNCTION public.get_user_account_id(uid uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_id FROM public.profiles WHERE id = uid;
$$;

-- =====================================================
-- تفعيل RLS على جميع الجداول
-- =====================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS Policies: profiles
-- =====================================================
CREATE POLICY "المستخدم يرى ملفه الشخصي" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "المستخدم يعدّل ملفه الشخصي" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (role IS NOT DISTINCT FROM get_user_role(auth.uid()));

CREATE POLICY "الأدمن يملك صلاحية كاملة على profiles" ON public.profiles
  FOR ALL TO authenticated USING (get_user_role(auth.uid()) = 'admin'::public.user_role);

-- =====================================================
-- RLS Policies: accounts
-- =====================================================
CREATE POLICY "المستخدم يرى حسابه فقط" ON public.accounts
  FOR SELECT TO authenticated
  USING (id = get_user_account_id(auth.uid()));

CREATE POLICY "الأدمن يملك صلاحية كاملة على accounts" ON public.accounts
  FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin'::public.user_role);

-- =====================================================
-- RLS Policies: devices
-- =====================================================
CREATE POLICY "المستخدم يرى أجهزة حسابه" ON public.devices
  FOR SELECT TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));

CREATE POLICY "الأدمن يملك صلاحية كاملة على devices" ON public.devices
  FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin'::public.user_role);

-- =====================================================
-- RLS Policies: payment_requests
-- =====================================================
CREATE POLICY "المستخدم يرى طلبات دفع حسابه" ON public.payment_requests
  FOR SELECT TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));

CREATE POLICY "الأدمن يملك صلاحية كاملة على payment_requests" ON public.payment_requests
  FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin'::public.user_role);

-- =====================================================
-- RLS Policies: transactions
-- =====================================================
CREATE POLICY "المستخدم يرى معاملات حسابه" ON public.transactions
  FOR SELECT TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));

CREATE POLICY "الأدمن يملك صلاحية كاملة على transactions" ON public.transactions
  FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin'::public.user_role);

-- =====================================================
-- RLS Policies: payment_matches
-- =====================================================
CREATE POLICY "المستخدم يرى تطابقات حسابه" ON public.payment_matches
  FOR SELECT TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));

CREATE POLICY "الأدمن يملك صلاحية كاملة على payment_matches" ON public.payment_matches
  FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin'::public.user_role);

-- =====================================================
-- RLS Policies: audit_events
-- =====================================================
CREATE POLICY "المستخدم يرى أحداث تدقيق حسابه" ON public.audit_events
  FOR SELECT TO authenticated
  USING (account_id = get_user_account_id(auth.uid()));

CREATE POLICY "الأدمن يملك صلاحية كاملة على audit_events" ON public.audit_events
  FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) = 'admin'::public.user_role);

-- =====================================================
-- View: public_profiles (للمعلومات العامة)
-- =====================================================
CREATE VIEW public.public_profiles AS
  SELECT id, role FROM public.profiles;

-- =====================================================
-- Indexes للأداء
-- =====================================================
CREATE INDEX idx_devices_account_id ON public.devices(account_id);
CREATE INDEX idx_payment_requests_account_id ON public.payment_requests(account_id);
CREATE INDEX idx_payment_requests_status ON public.payment_requests(status);
CREATE INDEX idx_transactions_account_id ON public.transactions(account_id);
CREATE INDEX idx_transactions_verification_status ON public.transactions(verification_status);
CREATE INDEX idx_audit_events_account_id ON public.audit_events(account_id);
CREATE INDEX idx_audit_events_created_at ON public.audit_events(created_at DESC);
