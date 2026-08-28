# قائمة الجاهزية للإنتاج

## 1. Environment

- [ ] بيئة إنتاج منفصلة عن staging.
- [ ] `EXPO_PUBLIC_SUPABASE_URL` و `EXPO_PUBLIC_SUPABASE_ANON_KEY` إنتاجية.
- [ ] Edge Functions منشورة على الإنتاج.
- [ ] app.json يشير إلى slug الإنتاج.

## 2. Secrets

- [ ] API keys و secrets في Supabase Secrets (لا في الكود).
- [ ] Secrets manager للإنتاج.
- [ ] Android keystore لـ release signing.
- [ ] Webhook secrets فريدة لكل endpoint.

## 3. TLS

- [ ] HTTPS على كل endpoint.
- [ ] TLS 1.3 مفضل.
- [ ] Certificate صالح ولا ينتهي قريبًا.

## 4. Database

- [ ] RLS مفعّل على كل الجداول.
- [ ] Backups تلقائية.
- [ ] Migrations منفذة.
- [ ] Indexes على الحقول المُستعلَمة (status, account_id, created_at).

## 5. Monitoring

- [ ] Dashboards جاهزة.
- [ ] Alerts مُفعّلة.
- [ ] Sentry يستقبل الأخطاء.
- [ ] Logs مُراجعون.

## 6. API

- [ ] API versioned (v1).
- [ ] Rate limiting مفعّل.
- [ ] HMAC + nonce + timestamp.
- [ ] API docs منشورة.

## 7. Webhooks

- [ ] توقيع webhook مفعّل.
- [ ] Retries مُعدة.
- [ ] Failed deliveries dashboard جاهز.
- [ ] Idempotency مُطبّقة.

## 8. Android

- [ ] Release build موقّع.
- [ ] ProGuard/R8 مفعّل.
- [ ] SQLCipher مفعّل.
- [ ] Notification Access flow مختبر.
- [ ] Offline queue مختبر.

## 9. Documentation

- [ ] API docs.
- [ ] Integration guide.
- [ ] Security review.
- [ ] Privacy policy.
- [ ] Terms of service.
- [ ] Runbook.

## 10. Legal / Compliance

- [ ] Privacy policy منشورة.
- [ ] Terms of service منشورة.
- [ ] موافقة المستخدم على جمع الإشعارات.
- [ ] حق الوصول/التصحيح/الحذف متاح.

## 11. Deployment Rollback

- [ ] خطة rollback للـ Edge Functions.
- [ ] خطة rollback لـ database migrations.
- [ ] خطة rollback لـ تطبيق Android.
- [ ] فريق العمليات مدرب.

## 12. Definition of Done

- [ ] موقع يُنشئ Payment Request.
- [ ] الطلب يصل للـ backend.
- [ ] الجهاز المسجل يستقبل الحدث.
- [ ] Android يلتقط Evidence.
- [ ] Parser يستخرج الحقول.
- [ ] Evidence تصل للسيرفر.
- [ ] Deduplication تعمل.
- [ ] Verification تعمل.
- [ ] الطلب يتحول لحالة نهائية.
- [ ] Webhook يصل للموقع.
- [ ] Dashboard يعرض العملية.
- [ ] نفس transaction لا يمكن استخدامها مرتين.
- [ ] Offline queue تعود للعمل بعد الاتصال.
- [ ] Audit trail كامل.
- [ ] API docs كاملة.
- [ ] اختبارات regression تعمل.
- [ ] لا توجد secrets في source code.

## 13. ملاحظة نهائية

لا يُعتبر النظام "100% مضمون" لأن مصدر الإثبات الخارجي (تطبيقات البنوك) قد يتغير أو يتوقف. الهدف الهندسي هو جعل القرار قابلًا للتدقيق، مقاومًا للتكرار/replay، وآمنًا قدر الإمكان، مع مراجعة يدوية للحالات غير الحاسمة.
