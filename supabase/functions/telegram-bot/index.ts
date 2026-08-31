// Telegram Bot Webhook — يستقبل التحديثات من Telegram ويرد على الأوامر
import { adminClient, jsonOk, jsonErr, CORS } from '../_shared/auth.ts';

const BOT_API = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

// تحويل خطأ Telegram API إلى رسالة مفهومة للمستخدم
function translateTelegramError(errorCode: number, description: string): string {
  if (description.includes('Not Found') || description.includes('Unauthorized')) {
    return 'رمز البوت غير صحيح أو البوت محذوف. تأكد من نسخ الرمز من @BotFather.';
  }
  if (description.includes('blocked')) {
    return 'المستخدم حظر البوت. أرسل رسالة للبوت أولاً أو ألغ الحظر.';
  }
  if (description.includes('not started')) {
    return 'المستخدم لم يبدأ المحادثة مع البوت. اضغط /start أولاً.';
  }
  if (description.includes('Forbidden') || description.includes('forbidden') || description.includes('can\'t initiate')) {
    return 'البوت لا يستطيع إرسال رسائل لهذا المستخدم. تأكد من معرف المحادثة (Chat ID) ومن أن المستخدم ضغط /start.';
  }
  if (description.includes('chat not found')) {
    return 'المحادثة غير موجودة. تأكد من معرف المحادثة (Chat ID). إذا كان البوت في مجموعة، تأكد أنه عضو فيها.';
  }
  if (description.includes('Too Many')) {
    return 'تم تجاوز حد الطلبات لدى Telegram. انتظر قليلاً ثم حاول مرة أخرى.';
  }
  if (description.includes('Bad Request')) {
    return 'صيغة الطلب غير صحيحة. تأكد من معرف المحادثة (Chat ID). لا يمكن إرسال رسائل إلى البوت نفسه.';
  }
  return 'فشل الاتصال بـ Telegram. تأكد من الرمز ومعرف المحادثة.';
}

async function callTelegram(token: string, method: string, payload: Record<string, unknown>) {
  const res = await fetch(BOT_API(token, method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ ok: false, description: res.statusText }));
  if (!res.ok || !data.ok) {
    const description = typeof data.description === 'string' ? data.description : res.statusText;
    const friendly = translateTelegramError(res.status, description);
    throw new Error(`${friendly} (${description})`);
  }
  return data;
}

async function sendMessage(token: string, chatId: string, text: string, parseMode = 'HTML') {
  return callTelegram(token, 'sendMessage', { chat_id: chatId, text, parse_mode: parseMode });
}

async function fetchBotInfo(token: string): Promise<{ id: number; username: string } | null> {
  try {
    const data = await callTelegram(token, 'getMe', {});
    return data?.result ? { id: data.result.id, username: data.result.username ?? '' } : null;
  } catch { return null; }
}

async function validateChat(token: string, chatId: string, botId: number): Promise<string | null> {
  // منع إرسال الرسالة للبوت نفسه
  if (String(chatId) === String(botId) || String(chatId) === String(-botId)) {
    return 'لا يمكن إرسال رسائل للبوت نفسه. أدخل معرف المحادثة (Chat ID) الخاص بك.';
  }
  // محاولة إرسال رسالة اختبار لتحقق من صلاحية الإرسال
  try {
    await sendMessage(token, chatId, '<b>اختبار Nader Pay</b> ✅\nتم توصيل البوت بنجاح.');
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'فشل التحقق من المحادثة';
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const db = adminClient();

  // ─── POST /test ──────────────────────────────────────────
  if (req.method === 'POST') {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return jsonErr('INVALID_JSON', 'جسم غير صالح', 400); }

    const { action, account_id, bot_token, chat_id } = body;
    if (action === 'test') {
      if (typeof bot_token !== 'string' || typeof chat_id !== 'string' || typeof account_id !== 'string') {
        return jsonErr('VALIDATION_ERROR', 'bot_token, chat_id, account_id مطلوبة', 422);
      }
      const botInfo = await fetchBotInfo(bot_token);
      if (!botInfo) return jsonErr('TELEGRAM_ERROR', 'رمز البوت غير صحيح', 400);
      const chatErr = await validateChat(bot_token, chat_id, botInfo.id);
      if (chatErr) return jsonErr('TELEGRAM_ERROR', chatErr, 400);

      // تحديث الحالة إلى متصل
      await db.from('telegram_bot_configs')
        .upsert({
          account_id,
          bot_token: bot_token,
          bot_username: botInfo.username,
          chat_id: chat_id,
          status: 'connected',
          is_sendable: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'account_id' });
      return jsonOk({ ok: true, bot_username: botInfo.username });
    }

    if (action === 'validate') {
      if (typeof bot_token !== 'string') return jsonErr('VALIDATION_ERROR', 'bot_token مطلوب', 422);
      const botInfo = await fetchBotInfo(bot_token);
      if (!botInfo) return jsonErr('TELEGRAM_ERROR', 'رمز البوت غير صحيح', 400);
      return jsonOk({ ok: true, bot_id: botInfo.id, username: botInfo.username });
    }
  }

  // ─── Webhook من Telegram ─────────────────────────────────
  if (req.method === 'POST') {
    let update: Record<string, unknown>;
    try { update = await req.json(); } catch { return new Response('OK'); }

    const message = (update.message || update.edited_message || update.callback_query?.message) as Record<string, unknown> | undefined;
    if (!message?.text || !message?.chat) return new Response('OK');

    const text = (message.text as string).trim();
    const chat = message.chat as { id: number; type?: string; username?: string };
    const chatId = String(chat.id);

    // تحديد البوت من خلال المسار — إذا كان webhook موجهًا لبوت واحد
    // نستخدم البوت الأول الموجود في الجدول (في الإنتاج يُفضل webhook لكل بوت)
    const { data: configs } = await db.from('telegram_bot_configs').select('*').eq('chat_id', chatId).limit(1);
    const config = configs?.[0];
    if (!config) {
      // محاولة مطابقة عبر username إذا كان متاحًا
      return new Response('OK');
    }

    const reply = await handleCommand(db, text, config.account_id);
    try {
      await sendMessage(config.bot_token, chatId, reply);
    } catch {
      // لا نفشل الطلب الخارجي بسبب فشل إرسال الرد
    }
    return new Response('OK');
  }

  return jsonErr('NOT_FOUND', 'المسار غير موجود', 404);
});

async function handleCommand(
  db: ReturnType<typeof adminClient>,
  text: string,
  accountId: string
): Promise<string> {
  const command = text.toLowerCase().split(' ')[0];

  if (command === '/status') {
    const { data: prs } = await db.from('payment_requests').select('status').eq('account_id', accountId);
    const { data: devices } = await db.from('devices').select('status').eq('account_id', accountId);
    const counts = { pending: 0, confirmed: 0, rejected: 0, review: 0 };
    (prs ?? []).forEach((r) => {
      if (['CREATED', 'WAITING_PAYMENT', 'MESSAGE_DETECTED', 'PARSING', 'VERIFYING'].includes(r.status)) counts.pending++;
      if (r.status === 'CONFIRMED') counts.confirmed++;
      if (r.status === 'REJECTED') counts.rejected++;
      if (r.status === 'REVIEW_REQUIRED') counts.review++;
    });
    const active = (devices ?? []).filter((d) => d.status === 'active').length;
    return `<b>📊 حالة Nader Pay</b>\n` +
      `معلق: ${counts.pending}\n` +
      `مؤكد: ${counts.confirmed}\n` +
      `مرفوض: ${counts.rejected}\n` +
      `يحتاج مراجعة: ${counts.review}\n` +
      `أجهزة نشطة: ${active}`;
  }

  if (command === '/pending') {
    const { data } = await db.from('payment_requests')
      .select('external_reference, amount, currency, status')
      .eq('account_id', accountId)
      .in('status', ['CREATED', 'WAITING_PAYMENT', 'MESSAGE_DETECTED', 'PARSING', 'VERIFYING'])
      .order('created_at', { ascending: false })
      .limit(10);
    if (!data?.length) return '✅ لا توجد طلبات معلقة.';
    return `<b>⏳ الطلبات المعلقة</b>\n` + data.map((r) =>
      `• ${r.external_reference} — ${r.amount} ${r.currency}`
    ).join('\n');
  }

  if (command === '/today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const { data: prs } = await db.from('payment_requests')
      .select('status')
      .eq('account_id', accountId)
      .gte('created_at', start.toISOString());
    const { data: txs } = await db.from('transactions')
      .select('id')
      .eq('account_id', accountId)
      .gte('created_at', start.toISOString());
    const created = (prs ?? []).length;
    const confirmed = (prs ?? []).filter((r) => r.status === 'CONFIRMED').length;
    return `<b>📅 ملخص اليوم</b>\n` +
      `طلبات جديدة: ${created}\n` +
      `طلبات مؤكدة: ${confirmed}\n` +
      `معاملات: ${txs?.length ?? 0}`;
  }

  if (command === '/start') {
    return 'مرحبًا بك في Nader Pay. الأوامر المتاحة:\n/status — الحالة\n/pending — المعلق\n/today — ملخص اليوم';
  }

  return 'أمر غير معروف. الأوامر: /status /pending /today';
}
