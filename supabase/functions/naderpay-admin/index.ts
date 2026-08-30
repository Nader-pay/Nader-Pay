// إدارة إعدادات Gateway الخاصة بـ Nader Pay
import { adminClient, jsonOk, jsonErr, CORS, decryptSecret } from '../_shared/auth.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseAnonKey = Deno.env.get('NADERPAY_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

function maskKey(key: string): string {
  if (!key) return '—';
  if (key.length <= 12) return key;
  return key.slice(0, 8) + '…' + key.slice(-8);
}

async function getAuthUser(req: Request, db: ReturnType<typeof adminClient>) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/, '').trim();
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function isAdmin(db: ReturnType<typeof adminClient>, userId: string) {
  const { data } = await db.from('profiles').select('role').eq('id', userId).maybeSingle();
  return data?.role === 'admin';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const db = adminClient();
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/naderpay-admin\/?/, '');
  const request_id = crypto.randomUUID();

  const user = await getAuthUser(req, db);
  if (!user) {
    return jsonErr('UNAUTHORIZED', 'يجب تسجيل الدخول', 401, request_id);
  }

  const { data: profile } = await db.from('profiles').select('id, account_id, role').eq('id', user.id).maybeSingle();
  const accountId = profile?.account_id ?? user.id;
  const admin = profile?.role === 'admin';

  // ─── GET /naderpay-admin/config ───────────────────────────
  if (req.method === 'GET' && path === 'config') {
    const { data: row } = await db
      .from('naderpay_gateway_config')
      .select('*')
      .maybeSingle();

    const { count } = await db.from('api_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'active');

    const anonKeyStatus = supabaseAnonKey ? 'configured' : 'missing';
    const apiKeyStatus = (count ?? 0) > 0 ? 'configured' : 'missing';

    return jsonOk({
      project_ref: Deno.env.get('SUPABASE_PROJECT_REF') ?? (supabaseUrl.match(/https:\/\/(.+)\.supabase\.co/)?.[1] ?? 'unknown'),
      supabase_url: supabaseUrl,
      anon_key_status: anonKeyStatus,
      anon_key: supabaseAnonKey,
      anon_key_masked: maskKey(supabaseAnonKey),
      api_key_status: apiKeyStatus,
      gateway_auth_status: row?.gateway_auth_status ?? 'unknown',
      updated_at: row?.updated_at ?? null,
      detected_from_env: true,
      note: 'NADERPAY_SUPABASE_ANON_KEY يُقرأ من بيئة Edge Function؛ لا يُحفظ في client bundle',
    });
  }

  // ─── POST /naderpay-admin/config ──────────────────────────
  if (req.method === 'POST' && path === 'config') {
    if (!admin) {
      return jsonErr('FORBIDDEN', 'صلاحية Admin مطلوبة', 403, request_id);
    }

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { }

    const anonKeyStatus = supabaseAnonKey ? 'configured' : 'missing';
    const { data: existing } = await db.from('naderpay_gateway_config').select('id').maybeSingle();

    const payload = {
      project_ref: String(body.project_ref ?? 'hbldhnpduoczneoyfzyz'),
      supabase_url: String(body.supabase_url ?? supabaseUrl),
      anon_key_status: anonKeyStatus,
      api_key_status: 'unknown',
      gateway_auth_status: 'unknown',
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { data, error } = await db.from('naderpay_gateway_config').update(payload).eq('id', existing.id).select().maybeSingle();
      if (error) return jsonErr('DB_ERROR', error.message, 500, request_id);
      return jsonOk({ config: data });
    }

    const { data, error } = await db.from('naderpay_gateway_config').insert(payload).select().maybeSingle();
    if (error) return jsonErr('DB_ERROR', error.message, 500, request_id);
    return jsonOk({ config: data });
  }

  // ─── POST /naderpay-admin/test-connection ─────────────────
  if (req.method === 'POST' && path === 'test-connection') {
    let body: { api_key?: string } = {};
    try { body = await req.json(); } catch { }

    const diagnostics: Record<string, unknown> = {
      nader_pay_url: `${supabaseUrl}/functions/v1/payment-requests`,
      supabase_config_detected: !!supabaseUrl && !!supabaseAnonKey,
      naderpay_supabase_anon_key_status: supabaseAnonKey ? 'configured' : 'missing',
      naderpay_api_key_detected: false,
      authorization_header_present: false,
      x_api_key_present: false,
      http_status: null,
      response_code: null,
      response_message: null,
    };

    const apiKey = body.api_key?.trim();
    if (!apiKey) {
      // حاول جلب API Key نشط للحساب
      const { data: cred } = await db
        .from('api_credentials')
        .select('id, key_id, secret_hash, encrypted_secret')
        .eq('account_id', accountId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cred?.encrypted_secret) {
        diagnostics.naderpay_api_key_detected = true;
        try {
          const secret = await decryptSecret(cred.encrypted_secret);
          body.api_key = `${cred.key_id}:${secret}`;
        } catch {
          diagnostics.naderpay_api_key_detected = false;
        }
      }
    } else {
      diagnostics.naderpay_api_key_detected = true;
    }

    const finalApiKey = body.api_key?.trim();
    if (!finalApiKey) {
      diagnostics.response_message = 'لا يوجد Nader Pay API Key نشط للحساب';
      diagnostics.response_code = 'MISSING_API_KEY';
      return jsonOk({ success: false, diagnostics }, 200);
    }

    diagnostics.authorization_header_present = true;
    diagnostics.x_api_key_present = true;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'X-Api-Key': finalApiKey,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `test-conn-${crypto.randomUUID()}`,
    };

    const testBody = {
      external_reference: `test-conn-${crypto.randomUUID()}`,
      amount: 100,
      currency: 'EGP',
    };

    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/payment-requests`, {
        method: 'POST',
        headers,
        body: JSON.stringify(testBody),
      });
      const respText = await resp.text();
      diagnostics.http_status = resp.status;
      try {
        const respJson = JSON.parse(respText);
        diagnostics.response_code = respJson?.error?.code ?? 'OK';
        diagnostics.response_message = respJson?.error?.message ?? respJson?.payment_request_id ?? 'OK';
      } catch {
        diagnostics.response_message = respText.slice(0, 200);
      }

      const success = resp.status === 201;
      if (success) {
        await db.from('naderpay_gateway_config').update({ gateway_auth_status: 'ok', updated_at: new Date().toISOString() }).not('id', 'is', null);
      } else {
        await db.from('naderpay_gateway_config').update({ gateway_auth_status: 'error', updated_at: new Date().toISOString() }).not('id', 'is', null);
      }
      return jsonOk({ success, diagnostics }, 200);
    } catch (e) {
      diagnostics.http_status = 0;
      diagnostics.response_code = 'NETWORK_ERROR';
      diagnostics.response_message = e instanceof Error ? e.message : 'Unknown error';
      return jsonOk({ success: false, diagnostics }, 200);
    }
  }

  // ─── POST /naderpay-admin/test-webhook ────────────────────
  if (req.method === 'POST' && path === 'test-webhook') {
    return jsonOk({
      message: 'Test webhook يجب تشغيله من صفحة Webhook integration؛ لا يُغيّر هذا الإعداد Webhook Secret',
      webhook_status: 'unchanged',
    }, 200);
  }

  return jsonErr('NOT_FOUND', 'المسار غير موجود', 404, request_id);
});
