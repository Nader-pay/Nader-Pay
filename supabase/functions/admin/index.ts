// Admin API — Super Admin endpoints
import { adminClient, jsonOk, jsonErr, CORS } from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const db = adminClient();
  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\/admin\/?/, '').split('/').filter(Boolean);
  const request_id = crypto.randomUUID();

  // المصادقة: Supabase Auth + is_super_admin
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return jsonErr('UNAUTHORIZED', 'يجب تسجيل الدخول', 401, request_id);

  const { data: { user }, error: userErr } = await db.auth.getUser(token);
  if (userErr || !user) return jsonErr('UNAUTHORIZED', 'جلسة غير صالحة', 401, request_id);

  const { data: profile } = await db.from('profiles').select('is_super_admin').eq('id', user.id).maybeSingle();
  if (!profile?.is_super_admin) {
    await db.from('security_events').insert({
      account_id: user.id,
      event_type: 'unauthorized_admin_access',
      severity: 'critical',
      actor: user.email ?? user.id,
      details: { path: url.pathname },
    });
    return jsonErr('FORBIDDEN', 'صلاحية Super Admin مطلوبة', 403, request_id);
  }

  // ─── GET /admin/global-policies ─────────────────────────
  if (req.method === 'GET' && pathParts[0] === 'global-policies') {
    const { data } = await db.from('global_policies').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    return jsonOk({ policy: data });
  }

  // ─── POST /admin/global-policies ────────────────────────
  if (req.method === 'POST' && pathParts[0] === 'global-policies') {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return jsonErr('INVALID_JSON', 'جسم غير صالح', 400, request_id); }

    const { data } = await db.from('global_policies').upsert({
      service_enabled: body.service_enabled ?? true,
      minimum_supported_version: body.minimum_supported_version ?? '1.0.0',
      force_update: body.force_update ?? false,
      integrity_required: body.integrity_required ?? false,
      blocked_versions: body.blocked_versions ?? [],
      updated_at: new Date().toISOString(),
    }).select('*').maybeSingle();

    await db.from('audit_events').insert({
      account_id: null,
      actor: user.email ?? user.id,
      action: 'updated',
      entity: 'global_policy',
      entity_id: data?.id,
      metadata: body,
    });

    return jsonOk({ policy: data });
  }

  // ─── GET /admin/accounts ─────────────────────────────────
  if (req.method === 'GET' && pathParts[0] === 'accounts') {
    const { data } = await db.from('accounts').select('*, profiles(id, email, is_super_admin, org_role)').order('created_at', { ascending: false });
    return jsonOk({ accounts: data ?? [] });
  }

  // ─── GET /admin/security-events ──────────────────────────
  if (req.method === 'GET' && pathParts[0] === 'security-events') {
    const { data } = await db.from('security_events').select('*, accounts(name)').order('created_at', { ascending: false }).limit(100);
    return jsonOk({ events: data ?? [] });
  }

  // ─── GET /admin/stats ────────────────────────────────────
  if (req.method === 'GET' && pathParts[0] === 'stats') {
    const [{ data: accounts }, { data: devices }, { data: prs }, { data: txs }] = await Promise.all([
      db.from('accounts').select('id', { count: 'exact', head: true }),
      db.from('devices').select('id', { count: 'exact', head: true }),
      db.from('payment_requests').select('id', { count: 'exact', head: true }),
      db.from('transactions').select('id', { count: 'exact', head: true }),
    ]);
    return jsonOk({
      accounts: accounts?.count ?? 0,
      devices: devices?.count ?? 0,
      payment_requests: prs?.count ?? 0,
      transactions: txs?.count ?? 0,
    });
  }

  return jsonErr('NOT_FOUND', 'المسار غير موجود', 404, request_id);
});
