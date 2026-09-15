// Integration Status Dashboard — يجمع بيانات التكامل الكاملة لعرضها في Overview
import { adminClient, jsonOk, jsonErr, CORS } from '../_shared/auth.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

async function getUserAccount(req: Request) {
  const db = adminClient();
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { error: 'UNAUTHORIZED' as const };
  const { data: profile } = await db
    .from('profiles')
    .select('account_id, role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.account_id) return { error: 'FORBIDDEN' as const };
  return { user, account_id: profile.account_id, db };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const request_id = crypto.randomUUID();
  const auth = await getUserAccount(req);
  if (auth.error) return jsonErr(auth.error, 'يجب تسجيل الدخول', 401, request_id);
  const { account_id, db } = auth;

  // جلب جميع integrations (بدون nested joins — يُجلب منفصلاً لتفادي مشكلة FK→object)
  const { data: rawIntegrations, error: intErr } = await db
    .from('integrations')
    .select('id, name, type, website_url, environment, status, last_activity_at, created_at, updated_at, enabled_events, api_credential_id, webhook_endpoint_id')
    .eq('account_id', account_id)
    .order('created_at', { ascending: false });

  if (intErr) return jsonErr('DB_ERROR', intErr.message, 500, request_id);

  // جلب api_credentials و webhook_endpoints منفصلاً لضمان إرجاع arrays صحيحة
  const credIds = (rawIntegrations ?? []).map((i: Record<string,unknown>) => i.api_credential_id).filter(Boolean);
  const endpointIds = (rawIntegrations ?? []).map((i: Record<string,unknown>) => i.webhook_endpoint_id).filter(Boolean);

  const [{ data: allCreds }, { data: allEndpoints }] = await Promise.all([
    credIds.length > 0
      ? db.from('api_credentials').select('id, key_id, status, environment, last_used_at, hmac_enabled, scopes').in('id', credIds)
      : Promise.resolve({ data: [] }),
    endpointIds.length > 0
      ? db.from('webhook_endpoints').select('id, url, status, events, auth_mode, health_status, last_test_at').in('id', endpointIds)
      : Promise.resolve({ data: [] }),
  ]);

  // دمج البيانات يدوياً: كل integration يحصل على api_credentials[] و webhook_endpoints[]
  const integrations = (rawIntegrations ?? []).map((int: Record<string,unknown>) => {
    const cred = (allCreds ?? []).find((c: Record<string,unknown>) => c.id === int.api_credential_id);
    const endpoint = (allEndpoints ?? []).find((e: Record<string,unknown>) => e.id === int.webhook_endpoint_id);
    return {
      ...int,
      api_credentials: cred ? [cred] : [],
      webhook_endpoints: endpoint ? [endpoint] : [],
    };
  });

  // إجمالي طلبات الدفع
  const { count: totalRequests } = await db
    .from('payment_requests')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', account_id);

  const { count: confirmedRequests } = await db
    .from('payment_requests')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', account_id)
    .eq('status', 'CONFIRMED');

  const { count: pendingRequests } = await db
    .from('payment_requests')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', account_id)
    .eq('status', 'CREATED');

  // آخر طلب دفع
  const { data: lastRequest } = await db
    .from('payment_requests')
    .select('id, status, amount, currency, external_reference, created_at, updated_at')
    .eq('account_id', account_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // آخر تسليم Webhook
  const { data: lastWebhookDelivery } = await db
    .from('webhook_deliveries')
    .select('id, status, http_status, created_at, event_type, attempts')
    .eq('account_id', account_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // إحصائيات Webhook الأخيرة (آخر 24 ساعة)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: webhookSuccessCount } = await db
    .from('webhook_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', account_id)
    .eq('status', 'delivered')
    .gte('created_at', since24h);

  const { count: webhookFailCount } = await db
    .from('webhook_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', account_id)
    .eq('status', 'failed')
    .gte('created_at', since24h);

  // عدد api_credentials الفعّالة
  const { count: activeKeyCount } = await db
    .from('api_credentials')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', account_id)
    .eq('status', 'active');

  return jsonOk({
    integrations: integrations ?? [],
    summary: {
      total_integrations: (integrations ?? []).length,
      active_integrations: (integrations ?? []).filter((i: Record<string, unknown>) => i.status === 'active').length,
      active_api_keys: activeKeyCount ?? 0,
      total_requests: totalRequests ?? 0,
      confirmed_requests: confirmedRequests ?? 0,
      pending_requests: pendingRequests ?? 0,
      webhook_success_24h: webhookSuccessCount ?? 0,
      webhook_fail_24h: webhookFailCount ?? 0,
    },
    last_request: lastRequest ?? null,
    last_webhook_delivery: lastWebhookDelivery ?? null,
  });
});
