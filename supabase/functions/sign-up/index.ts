// Sign Up — إنشاء مالك حساب جديد
import { adminClient, jsonOk, jsonErr, CORS } from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return jsonErr('METHOD_NOT_ALLOWED', 'الطريقة غير مسموحة', 405);

  const db = adminClient();
  const request_id = crypto.randomUUID();

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return jsonErr('INVALID_JSON', 'جسم غير صالح', 400, request_id); }

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const accountName = String(body.account_name ?? '').trim();

  if (!email || !password || !accountName) {
    return jsonErr('VALIDATION_ERROR', 'البريد وكلمة المرور واسم الحساب مطلوبة', 422, request_id);
  }
  if (password.length < 8) {
    return jsonErr('VALIDATION_ERROR', 'كلمة المرور يجب أن تكون 8 أحرف على الأقل', 422, request_id);
  }

  // 1. إنشاء مستخدم Supabase Auth
  const { data: authData, error: authError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { account_name: accountName },
  });

  if (authError) {
    return jsonErr('AUTH_ERROR', authError.message, 400, request_id);
  }

  const userId = authData.user!.id;

  // 2. تحديد هل هذا أول حساب على النظام؟
  const { count: existingAccounts } = await db.from('accounts').select('id', { count: 'exact', head: true });
  const isFirstAccount = (existingAccounts ?? 0) === 0;

  // 3. إنشاء Account
  const { data: account, error: accountError } = await db.from('accounts').insert({
    name: accountName,
    status: 'active',
  }).select('id').maybeSingle();

  if (accountError) {
    await db.auth.admin.deleteUser(userId);
    return jsonErr('DB_ERROR', accountError.message, 500, request_id);
  }

  // 4. التعامل مع Profile: قد يكون قد أُنشئ بواسطة trigger auth.users
  const { data: existingProfile } = await db.from('profiles').select('id').eq('id', userId).maybeSingle();

  if (existingProfile) {
    // تحديث الملف الموجود
    const { error: updateProfileError } = await db.from('profiles').update({
      email,
      account_id: account!.id,
      role: isFirstAccount ? 'admin' : 'user',
      org_role: isFirstAccount ? 'owner' : 'viewer',
      is_super_admin: isFirstAccount,
    }).eq('id', userId);

    if (updateProfileError) {
      await db.auth.admin.deleteUser(userId);
      await db.from('accounts').delete().eq('id', account!.id);
      return jsonErr('DB_ERROR', updateProfileError.message, 500, request_id);
    }
  } else {
    // إنشاء Profile جديد
    const { error: insertProfileError } = await db.from('profiles').insert({
      id: userId,
      email,
      account_id: account!.id,
      role: isFirstAccount ? 'admin' : 'user',
      org_role: isFirstAccount ? 'owner' : 'viewer',
      is_super_admin: isFirstAccount,
    });

    if (insertProfileError) {
      await db.auth.admin.deleteUser(userId);
      await db.from('accounts').delete().eq('id', account!.id);
      return jsonErr('DB_ERROR', insertProfileError.message, 500, request_id);
    }
  }

  // 5. اشتراك تجريبي تلقائي
  const { data: plan } = await db.from('plans').select('id').eq('name', 'Starter').maybeSingle();
  if (plan) {
    const now = new Date();
    const trialEnds = new Date(now);
    trialEnds.setDate(trialEnds.getDate() + 14);
    await db.from('subscriptions').insert({
      account_id: account!.id,
      plan_id: plan.id,
      status: 'trialing',
      trial_ends_at: trialEnds.toISOString(),
      current_period_start: now.toISOString(),
      current_period_end: trialEnds.toISOString(),
      starts_at: now.toISOString(),
      ends_at: trialEnds.toISOString(),
    });
  }

  // 6. تسجيل حدث Audit
  await db.from('audit_events').insert({
    account_id: account!.id,
    actor: email,
    action: 'created',
    entity: 'account',
    entity_id: account!.id,
    metadata: { user_id: userId, is_first_account: isFirstAccount },
  });

  // 7. تسجيل الدخول تلقائيًا لأن البريد تم تأكيده
  const { data: sessionData, error: sessionError } = await db.auth.admin.signInWithPassword({
    email,
    password,
  });

  if (sessionError || !sessionData.session) {
    return jsonOk({
      ok: true,
      user_id: userId,
      account_id: account!.id,
      is_first_account: isFirstAccount,
      needs_email_confirmation: false,
    }, 201);
  }

  return jsonOk({
    ok: true,
    user_id: userId,
    account_id: account!.id,
    is_first_account: isFirstAccount,
    session: sessionData.session,
    needs_email_confirmation: false,
  }, 201);
});
