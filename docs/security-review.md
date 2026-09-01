# مراجعة الأمان

## 1. Authentication

- [x] API keys تُولَّد بترابط cryptographically secure.
- [x] كل طلب يتطلب HMAC-SHA256 مع timestamp + nonce.
- [x] timestamp نافذة ±60 ثانية لمنع replay.
- [x] nonce فريد لمدة 24 ساعة.
- [x] API keys قابلة للإلغاء من لوحة التحكم.
- [x] Rate limiting عند gateway (Edge Function).

## 2. Authorization

- [x] Row Level Security (RLS) على جميع الجداول.
- [x] كل استعلام يشترط `account_id = current_setting('app.current_account_id')`.
- [x] أدوار محدودة: Owner, Admin, Operator, Viewer.
- [x] محركات Edge Function تُحقق الدور قبل تنفيذ الإجراءات الحساسة.
- [x] عدم السماح للمستخدم برؤية طلبات الحسابات الأخرى.

## 3. Account Isolation

- [x] `account_id` ركيزة في كل كيان.
- [x] RLS policies ترفض الوصول بدون account context.
- [x] لا يوجد endpoint يعيد بيانات عبر حسابات.
- [x] device tokens مرتبطة بـ account_id.

## 4. Secret Storage

- [x] API_SECRET و webhook_secret و Supabase keys في Supabase Secrets (Edge Function).
- [x] لا توجد أسرار في source code.
- [x] على الجوال: tokens في Android Keystore / iOS Keychain.
- [x] لا تُطبع الأسرار في logs.

## 5. Encryption in Transit

- [x] HTTPS/TLS 1.3 لجميع الاتصالات.
- [x] Webhook URLs يجب أن تبدأ بـ https://.
- [x] لا يسمح بـ HTTP للإنتاج.

## 6. Encryption at Rest

- [x] قاعدة البيانات مشفرة على مستوى التخزين (Supabase AES-256).
- [x] Android SQLite مشفر بـ SQLCipher.
- [x] لا تُخزن بطاقات ائتمان أو أرقام حسابات حساسة كاملة إذا لم تكن ضرورية.

## 7. Rate Limiting

- [x] 100 طلب/دقيقة لكل API key.
- [x] 10 محاولات إنشاء طلب/دقيقة لكل حساب.
- [x] Rate limiting على webhook deliveries.

## 8. Replay Protection

- [x] nonce + timestamp.
- [x] delivery_id فريد لمدة 72 ساعة للـ webhooks.
- [x] message_hash deduplication.

## 9. Audit Integrity

- [x] جدول `audit_events` append-only.
- [x] لا يوجد update/delete مباشر على audit.
- [x] actor و ip و user agent مُسجّلون.
- [x] `before` و `after` snapshots للتغييرات المهمة.

## 10. Input Validation

- [x] JSON schema validation عند ingress.
- [x] `amount` عدد موجب، `currency` رمز معياري.
- [x] `external_ref` يُطهر (sanitize) ويُقتطع عند الطول الأقصى.
- [x] `provider` يُتحقق ضمن قائمة المزودين المسموحين.
- [x] `expires_at` في المستقبل.

## 11. SQL Injection Protection

- [x] استخدام Supabase client مع parameterization.
- [x] لا توجد استعلامات raw SQL مع concatenation.
- [x] Edge Functions تستخدم `.from().eq().select()`.

## 12. XSS / CSRF

- [x] API-only backend لا يُعرض HTML.
- [x] Web dashboard يُطهر أي user input قبل العرض.
- [x] لا توجد forms HTML تقليدية.

## 13. Secure Headers

- [x] `X-Content-Type-Options: nosniff`.
- [x] `Strict-Transport-Security` للإنتاج.
- [x] `Content-Security-Policy` للـ Web dashboard.
- [x] إخفاء `X-Powered-By`.

## 14. Dependency Scanning

- [x] إجراء `pnpm audit` قبل الإطلاق.
- [x] تحديث الحزم الحرجة فورًا.
- [x] pinning versions في package.json.
- [x] لا استخدام dependencies مهجورة.

## 15. Logging without Leaking Secrets

- [x] لا تُسجّل request bodies الكاملة.
- [x] لا تُسجّل API_SECRET أو webhook_secret.
- [x] لا تُسجّل raw messages في debug logs.
- [x] masking لأرقام الهواتف في logs.

## 16. Action Items

1. تمكين RLS على أي جدول جديد قبل الإنتاج.
2. مراجعة أذونات API keys كل 90 يومًا.
3. تفعيل WAF إن توفر.
4. عمل pentest سنوي.
5. تدريب فريق العمليات على runbook.
