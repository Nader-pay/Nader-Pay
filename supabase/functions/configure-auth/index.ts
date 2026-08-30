// Configure Supabase Auth email templates with Nader Pay branding
import { jsonOk, jsonErr, CORS } from '../_shared/auth.ts';

const LOGO_URL = 'https://miaoda-site-img.s3cdn.medo.dev/app-icons/app_icon_b383a429-e140-469c-9391-1d77f55dcba0.png';

const confirmationTemplate = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تأكيد البريد الإلكتروني — Nader Pay</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" width="480" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
          <tr>
            <td align="center" style="padding:32px 32px 16px;">
              <img src="${LOGO_URL}" alt="Nader Pay" width="64" height="64" style="border-radius:14px;" />
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 8px;">
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#111827;">Nader Pay</h1>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 24px;">
              <p style="margin:0;font-size:14px;color:#6b7280;">منصة التحقق من المدفوعات — سحابة آمنة وإثبات فوري</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 16px;">
              <p style="margin:0;font-size:16px;color:#374151;line-height:1.7;text-align:right;">
                مرحبًا،<br>
                شكرًا لإنشائك حسابًا على Nader Pay. يرجى الضغط على الزر أدناه لتأكيد بريدك الإلكتروني وتفعيل حسابك.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 32px 32px;">
              <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 32px;background-color:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;">
                تأكيد البريد الإلكتروني
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:right;line-height:1.6;">
                إذا لم تطلب إنشاء هذا الحساب، يمكنك تجاهل هذا البريد بأمان.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const recoveryTemplate = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>استعادة كلمة المرور — Nader Pay</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:40px 0;">
        <table role="presentation" width="480" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
          <tr>
            <td align="center" style="padding:32px 32px 16px;">
              <img src="${LOGO_URL}" alt="Nader Pay" width="64" height="64" style="border-radius:14px;" />
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 8px;">
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#111827;">Nader Pay</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 16px;">
              <p style="margin:0;font-size:16px;color:#374151;line-height:1.7;text-align:right;">
                تلقينا طلبًا لاستعادة كلمة المرور. اضغط على الزر أدناه لإعادة الضبط.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 32px 32px;">
              <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 32px;background-color:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;">
                إعادة تعيين كلمة المرور
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return jsonErr('METHOD_NOT_ALLOWED', 'طريقة غير مسموحة', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const request_id = crypto.randomUUID();

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }

  const siteUrl = typeof body.site_url === 'string' ? body.site_url : `${supabaseUrl.replace('.supabase.co', '.web.app')}/confirm`;

  // SMTP credentials (from Supabase secrets or env)
  const smtpHost = Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com';
  const smtpPort = Number(Deno.env.get('SMTP_PORT') ?? '587');
  const smtpUser = Deno.env.get('SMTP_USER') ?? 'naderprompt@gmail.com';
  const smtpPass = Deno.env.get('SMTP_PASS') ?? '';
  const smtpSender = Deno.env.get('SMTP_SENDER') ?? 'Nader Pay <naderprompt@gmail.com>';

  const hasSmtp = Boolean(smtpPass);

  // محاولة تطبيق إعدادات SMTP عبر GoTrue API إذا كانت متاحة
  let smtpApiStatus = 'not_applied';
  if (hasSmtp && serviceKey) {
    const configPayload = {
      site_url: siteUrl,
      mailer: {
        autoconfirm: false,
        smtp: {
          host: smtpHost,
          port: smtpPort,
          user: smtpUser,
          pass: smtpPass,
          admin_email: smtpSender,
          sender_name: 'Nader Pay',
        },
      },
    };

    const res = await fetch(`${supabaseUrl}/auth/v1/admin/config`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(configPayload),
    });

    if (res.ok) {
      smtpApiStatus = 'applied';
    } else {
      smtpApiStatus = 'api_not_available';
    }
  }

  return jsonOk({
    ok: true,
    site_url: siteUrl,
    smtp_configured: hasSmtp,
    smtp_api_status: smtpApiStatus,
    instructions: smtpApiStatus === 'applied'
      ? 'تم تطبيق إعدادات SMTP وSite URL. افتح لوحة Supabase للتحقق.'
      : 'افتح لوحة Supabase > Authentication > Email Templates > Confirm signup. انسخ قالب "confirmation" والصقه في Body. ثم في URL Configuration اضبط Site URL. وأخيرًا في SMTP Settings اضبط: host=smtp.gmail.com، port=587، user=naderprompt@gmail.com، pass=App Password، sender=Nader Pay.',
    templates: {
      confirmation: {
        subject: 'تأكيد بريدك الإلكتروني على Nader Pay',
        body: confirmationTemplate,
      },
      recovery: {
        subject: 'استعادة كلمة المرور — Nader Pay',
        body: recoveryTemplate,
      },
    },
  });
});
