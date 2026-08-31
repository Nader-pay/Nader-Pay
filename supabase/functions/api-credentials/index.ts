// API Credentials — create, rotate, revoke, list
import { adminClient, jsonOk, jsonErr, CORS, encryptSecret } from '../_shared/auth.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

function generateKeyId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return 'pk_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashSecret(keyId: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(keyId), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig  = await crypto.subtle.sign('HMAC', key, encoder.encode(secret));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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

  const { data: profile } = await db.from('profiles').select('account_id, role').eq('id', user.id).maybeSingle();
  if (!profile?.account_id) return { error: 'FORBIDDEN' as const };

  return { user, account_id: profile.account_id, db };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const request_id = crypto.randomUUID();
  const auth = await getUserAccount(req);
  if (auth.error) return jsonErr(auth.error, 'يجب تسجيل الدخول', 401, request_id);
  const { user, account_id, db } = auth;

  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\/api-credentials\/?/, '').split('/').filter(Boolean);

  // GET /api-credentials
  if (req.method === 'GET' && pathParts.length === 0) {
    const { data } = await db.from('api_credentials')
      .select('id, key_id, status, label, hmac_enabled, environment, scopes, last_used_at, created_at, rotated_at, revoked_at')
      .eq('account_id', account_id)
      .order('created_at', { ascending: false });
    return jsonOk({ credentials: data ?? [] });
  }

  // POST /api-credentials
  if (req.method === 'POST' && pathParts.length === 0) {
    let body: { label?: string; hmac_enabled?: boolean; environment?: 'sandbox' | 'live'; scopes?: string[]; action?: 'create' | 'rotate' | 'revoke'; credential_id?: string; keep_old?: boolean } = {};
    try { body = await req.json(); } catch { /* اختياري */ }

    // ── revoke ──
    if (body.action === 'revoke' && body.credential_id) {
      const credId = body.credential_id;
      const { data: existing } = await db.from('api_credentials')
        .select('id, key_id, status')
        .eq('id', credId)
        .eq('account_id', account_id)
        .maybeSingle();
      if (!existing) return jsonErr('NOT_FOUND', 'المفتاح غير موجود', 404, request_id);
      if (existing.status === 'revoked') return jsonErr('ALREADY_REVOKED', 'المفتاح ملغى بالفعل', 409, request_id);

      await db.from('api_credentials')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', credId);

      await db.from('audit_events').insert({
        account_id,
        actor: `user:${user.id}`,
        action: 'revoked',
        entity: 'api_credential',
        entity_id: credId,
        metadata: { key_id: existing.key_id },
      });

      return jsonOk({ id: credId, status: 'revoked', revoked_at: new Date().toISOString() });
    }

    // ── rotate ──
    if (body.action === 'rotate' && body.credential_id) {
      const { data: old } = await db.from('api_credentials')
        .select('id, key_id, status, label, hmac_enabled, environment, scopes')
        .eq('id', body.credential_id)
        .eq('account_id', account_id)
        .maybeSingle();
      if (!old) return jsonErr('NOT_FOUND', 'المفتاح غير موجود', 404, request_id);

      // إلغاء القديم إن لم يُطلب الاحتفاظ به
      if (!body.keep_old) {
        await db.from('api_credentials')
          .update({ status: 'revoked', revoked_at: new Date().toISOString() })
          .eq('id', old.id);
      }

      const keyId = generateKeyId();
      const secret = generateSecret();
      const hash = await hashSecret(keyId, secret);
      const encrypted = await encryptSecret(secret);
      const { data: cred, error } = await db.from('api_credentials').insert({
        account_id,
        key_id: keyId,
        secret_hash: hash,
        encrypted_secret: encrypted,
        label: old.label,
        hmac_enabled: old.hmac_enabled,
        environment: old.environment ?? 'sandbox',
        scopes: old.scopes ?? ['payment_requests'],
        status: 'active',
      }).select('id, key_id, label, created_at').maybeSingle();
      if (error) return jsonErr('DB_ERROR', error.message, 500, request_id);

      await db.from('api_credentials').update({ rotated_at: new Date().toISOString() }).eq('id', old.id);
      await db.from('audit_events').insert({
        account_id,
        actor: `user:${user.id}`,
        action: 'rotated',
        entity: 'api_credential',
        entity_id: cred!.id,
        metadata: { old_key_id: old.key_id, new_key_id: keyId, kept_old: body.keep_old ?? false },
      });

      return jsonOk({
        id: cred!.id,
        key_id: keyId,
        secret,
        full_key: `${keyId}:${secret}`,
        label: cred!.label,
        environment: old.environment ?? 'sandbox',
        scopes: old.scopes ?? ['payment_requests'],
        created_at: cred!.created_at,
        warning: 'احتفظ بهذا المفتاح الآن — لن يُعرض مرة أخرى',
        usage: {
          auth_header: 'Authorization: Bearer <SUPABASE_ANON_KEY>',
          api_key_header: `X-Api-Key: ${keyId}:${secret}`,
          note: 'Supabase Edge Functions runtime يتطلب JWT صالح في Authorization؛ ضع API Key في X-Api-Key',
        },
      }, 201);
    }

    // ── create ──
    const keyId = generateKeyId();
    const secret = generateSecret();
    const hash = await hashSecret(keyId, secret);
    const encrypted = await encryptSecret(secret);

    const environment = ['sandbox', 'live'].includes(String(body.environment)) ? String(body.environment) as 'sandbox' | 'live' : 'sandbox';
    const scopes = Array.isArray(body.scopes) && body.scopes.length ? body.scopes.map(String) : ['payment_requests'];

    const { data: cred, error } = await db.from('api_credentials').insert({
      account_id,
      key_id: keyId,
      secret_hash: hash,
      encrypted_secret: encrypted,
      label: body.label ?? null,
      hmac_enabled: body.hmac_enabled ?? false,
      environment,
      scopes,
      status: 'active',
    }).select('id, key_id, label, created_at').maybeSingle();

    if (error) return jsonErr('DB_ERROR', error.message, 500, request_id);

    await db.from('audit_events').insert({
      account_id,
      actor: `user:${user.id}`,
      action: 'created',
      entity: 'api_credential',
      entity_id: cred!.id,
      metadata: { key_id: keyId, label: body.label, hmac_enabled: body.hmac_enabled ?? false, environment, scopes },
    });

    return jsonOk({
      id: cred!.id,
      key_id: keyId,
      secret,
      full_key: `${keyId}:${secret}`,
      label: cred!.label,
      hmac_enabled: body.hmac_enabled ?? false,
      environment,
      scopes,
      created_at: cred!.created_at,
      warning: 'احتفظ بهذا المفتاح الآن — لن يُعرض مرة أخرى',
      usage: {
        auth_header: 'Authorization: Bearer <SUPABASE_ANON_KEY>',
        api_key_header: `X-Api-Key: ${keyId}:${secret}`,
        note: 'Supabase Edge Functions runtime يتطلب JWT صالح في Authorization؛ ضع API Key في X-Api-Key',
      },
    }, 201);
  }

  // PATCH /api-credentials/{id} — تحديث label / hmac_enabled
  if (req.method === 'PATCH' && pathParts.length === 1) {
    const credId = pathParts[0];
    let body: { label?: string; hmac_enabled?: boolean } = {};
    try { body = await req.json(); } catch { }
    const { data: existing } = await db.from('api_credentials')
      .select('id, key_id')
      .eq('id', credId)
      .eq('account_id', account_id)
      .maybeSingle();
    if (!existing) return jsonErr('NOT_FOUND', 'المفتاح غير موجود', 404, request_id);

    const updates: Record<string, unknown> = {};
    if (body.label !== undefined) updates.label = body.label;
    if (body.hmac_enabled !== undefined) updates.hmac_enabled = body.hmac_enabled;

    await db.from('api_credentials').update(updates).eq('id', credId);
    await db.from('audit_events').insert({
      account_id,
      actor: `user:${user.id}`,
      action: 'updated',
      entity: 'api_credential',
      entity_id: credId,
      metadata: { key_id: existing.key_id, ...updates },
    });

    return jsonOk({ id: credId, ...updates });
  }

  // DELETE /api-credentials/{id} — إلغاء (legacy)
  if (req.method === 'DELETE' && pathParts.length === 1) {
    const credId = pathParts[0];
    const { data: existing } = await db.from('api_credentials')
      .select('id, key_id, status')
      .eq('id', credId)
      .eq('account_id', account_id)
      .maybeSingle();
    if (!existing) return jsonErr('NOT_FOUND', 'المفتاح غير موجود', 404, request_id);
    if (existing.status === 'revoked') return jsonErr('ALREADY_REVOKED', 'المفتاح ملغى بالفعل', 409, request_id);

    await db.from('api_credentials')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('id', credId);

    await db.from('audit_events').insert({
      account_id,
      actor: `user:${user.id}`,
      action: 'revoked',
      entity: 'api_credential',
      entity_id: credId,
      metadata: { key_id: existing.key_id },
    });

    return jsonOk({ id: credId, status: 'revoked', revoked_at: new Date().toISOString() });
  }

  return jsonErr('NOT_FOUND', 'المسار غير موجود', 404, request_id);
});
