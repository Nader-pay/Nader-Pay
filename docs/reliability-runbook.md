# دليل الموثوقية واستمرارية الخدمة

## 1. Database Backups

- **Automatic backups**: Supabase يوميًا.
- **Point-in-time recovery**: مفعل لمدة 7 أيام.
- **Manual backups**: قبل أي migration كبير.
- **Test restore**: مرة شهريًا على بيئة staging.

## 2. Migration Rollback Strategy

1. كل migration يجب أن يكون لها `down` migration.
2. قبل الإنتاج: اختبار `up` و `down` على staging.
3. بعد نشر migration: مراقبة الأخطاء لمدة ساعة.
4. إذا ظهر خطأ حرج: تطبيق `down` migration فورًا.
5. الاحتفاظ بنسخة من قاعدة البيانات قبل migration.

## 3. Retry Policies

| العملية | المحاولات | التراجع | النتيجة بعد الفشل |
|---------|-----------|---------|---------------------|
| API call | 3 | exponential (1s, 2s, 4s) | 500 error |
| Webhook delivery | 5 | 30s, 2m, 5m, 15m, 30m | failed deliveries |
| Android sync | unlimited | 10s, 30s, 1m | local queue |
| Parser | 1 | لا | failed_events |

## 4. Dead-letter Queue / Failed Event Store

- جدول `failed_events`:
  - `id`, `device_id`, `account_id`, `payload`, `error`, `created_at`, `retry_count`, `resolved_at`.
- الأحداث الفاشلة تُراجع يدويًا.
- Dashboard إداري لعرضها.
- إعادة معالجة batch عبر Edge Function:

```bash
curl -X POST /admin/retry-failed-events -H "x-admin-token: ..."
```

## 5. Graceful Degradation

- إذا فشل parser: يُحفظ الحدث في failed_events ويُحاول لاحقًا.
- إذا فشل webhook: يُحاول إعادة الإرسال ويُخفض التنبيه.
- إذا فقد الجهاز الاتصال: queue محلي + إعادة محاولة.
- إذا فشل الـ backend: يُعيد الجهاز المحاولة بدون فقدان البيانات.

## 6. Disaster Recovery

| السيناريو | RTO | RPO | الإجراء |
|-----------|-----|-----|---------|
| Database corruption | 1h | 15m | استعادة من backup + PITR |
| Region outage | 2h | 15m | تفعيل replica region ثانٍ إن متاح |
| Supabase outage | 4h | 30m | local queue على الأجهزة، sync عند العودة |

## 7. Runbook — حالات الطوارئ

### 7.1 جميع الأجهزة offline

1. فحص حالة Supabase Edge Functions.
2. التحقق من endpoint `/health`.
3. فحص DNS/SSL.
4. إعلان incident في Slack.

### 7.2 webhook failure spike

1. فحص endpoint المستخدم.
2. التأكد من أن `x-webhook-signature` لا يتم رفضه.
3. فحص TLS/SSL certificate.
4. إذا كان المشكلة عالمية: تفعيل queue يدوي.

### 7.3 parser failure spike

1. مراجعة `failed_events`.
2. مقارنة رسائل فاشلة بـ fixtures.
3. إذا تغير تنسيق المزود: تحديث parser واختبار fixtures.

### 7.4 auth anomaly

1. مراجعة logs للـ IP والـ API key.
2. إلغاء المفتاح المشتبه به.
3. إشعار العميل.

## 8. قائمة التحقق قبل التغييرات

- [ ] اختبار على staging.
- [ ] backup حديث.
- [ ] down migration جاهز.
- [ ] runbook محدث.
- [ ] فريق العمليات على علم.
