# المرحلة 5 — التكامل النهائي والأمان والاختبارات والتوثيق

## الهدف
تحويل المشروع من prototype إلى منصة قابلة للاستخدام الفعلي والتوسع.

## 1. Integration API Documentation
أنشئ Documentation كاملة تشمل:

### Authentication
- API keys.
- HMAC.
- timestamp.
- nonce.
- errors.

### Payment Requests
- create.
- retrieve.
- cancel.
- status.

### Webhooks
- event types.
- payloads.
- signatures.
- retries.
- idempotency.

### Devices
- registration.
- heartbeat.
- evidence events.

### SDK/examples
أمثلة:
- PHP
- Node.js
- Python
- cURL

## 2. Integration Guide
المستخدم يجب أن يفهم:
1. إنشاء Account.
2. تسجيل جهاز Android.
3. تفعيل Notification Access.
4. إنشاء API credential.
5. إنشاء webhook.
6. إرسال Payment Request من الموقع.
7. انتظار confirmation.
8. معالجة webhook.
9. التعامل مع review/rejected/expired.

## 3. Test Matrix

### Verification
- exact match.
- amount mismatch.
- sender mismatch.
- name mismatch.
- missing name.
- duplicate transaction.
- duplicate message.
- expired request.
- old transaction.
- same transaction against two requests.
- simultaneous requests.
- concurrent events.

### Device
- offline.
- reconnect.
- reboot.
- listener disabled.
- listener re-enabled.
- network switching.
- API unavailable.
- queue recovery.
- app restart.

### API
- invalid key.
- revoked key.
- replay.
- invalid HMAC.
- duplicate nonce.
- old timestamp.
- rate limit.
- malformed payload.

### Webhook
- success.
- timeout.
- 4xx.
- 5xx.
- duplicate delivery.
- retry exhaustion.

## 4. Security Review
تحقق من:
- authentication.
- authorization.
- account isolation.
- secret storage.
- encryption in transit.
- encryption at rest where appropriate.
- rate limiting.
- replay protection.
- audit integrity.
- input validation.
- SQL injection protection.
- XSS/CSRF protections where applicable.
- secure headers.
- dependency scanning.
- logging without leaking secrets.

## 5. Privacy
الرسائل قد تحتوي بيانات مالية وشخصية.

نفّذ:
- data minimization.
- retention policy.
- configurable deletion/retention.
- restricted access to raw messages.
- masking in normal UI/logs.
- no raw financial message in ordinary debug logs.
- privacy documentation.

## 6. Monitoring
راقب:
- API latency.
- error rate.
- device offline count.
- event ingestion rate.
- verification failures.
- duplicate rate.
- webhook failure rate.
- queue backlog.
- parser failure rate.

Alerts:
- unusual duplicate spike.
- many devices offline.
- webhook failure spike.
- parser failure spike.
- authentication anomaly.

## 7. Provider Parser Testing
كل Provider له fixtures حقيقية بعد تنقيح البيانات الحساسة.

لكل fixture:
- input notification/message.
- expected parsed output.
- expected normalization.
- expected validation.

لا تعتمد على مثال رسالة واحد.

## 8. Reliability
اعمل:
- database backups.
- migration rollback strategy.
- retry policies.
- dead-letter queue أو failed event store.
- graceful degradation.

## 9. Production Readiness
قبل الإطلاق:
- production environment منفصل.
- secrets manager.
- TLS.
- database backups.
- monitoring.
- alerting.
- deployment rollback.
- versioned API.
- Android release signing.
- privacy policy.
- terms.
- operational runbook.

## 10. Definition of Done
المشروع يعتبر جاهزًا عندما:

- موقع ينشئ Payment Request.
- الطلب يصل للـ backend.
- الجهاز المسجل يستقبل الحدث/يكون جاهزًا للرصد.
- Android يلتقط Evidence من المصدر المسموح.
- parser يستخرج الحقول.
- evidence تصل للسيرفر.
- deduplication تعمل.
- verification تعمل.
- الطلب يتحول لحالة نهائية.
- webhook يصل للموقع.
- dashboard يعرض العملية كاملة.
- نفس transaction لا يمكن استخدامها مرتين.
- offline queue تعود للعمل بعد الاتصال.
- audit trail كامل.
- API docs كاملة.
- اختبارات regression تعمل.
- لا توجد secrets في source code.

## ملاحظة مهمة
لا يتم اعتبار النظام "100% مضمون" لأن مصدر الإثبات الخارجي نفسه قد يتغير أو يتوقف أو يغير صيغة الإشعار. الهدف الهندسي هو جعل القرار قابلاً للتدقيق، مقاومًا للتكرار/replay، وآمنًا قدر الإمكان، مع Review للحالات غير الحاسمة.
