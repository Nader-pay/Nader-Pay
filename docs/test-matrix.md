# مصفوفة الاختبار

## 1. اختبارات Verification

| الحالة | التوقع | الحالة النهائية | ملاحظة |
|--------|--------|----------------|--------|
| exact match | كل القيم تطابق | CONFIRMED | المثال الذهبي. |
| amount mismatch | المبلغ المكتشف ≠ المتوقع | REVIEW_REQUIRED | لا يتم رفض تلقائيًا؛ يحتاج مراجعة. |
| sender mismatch | رقم المرسل لا يطابق | REVIEW_REQUIRED | |
| name mismatch | اسم المرسل لا يطابق | REVIEW_REQUIRED | |
| missing name | الطلب يتطلب اسمًا لكنه غير موجود | REVIEW_REQUIRED | |
| duplicate transaction | نفس transaction_id مستخدم مسبقًا | REJECTED | |
| duplicate message | نفس message_hash مستخدم مسبقًا | REJECTED | |
| expired request | evidence بعد `expires_at` | EXPIRED | لا يتم تغيير الحالة من EXPIRED. |
| old transaction | وقت المعاملة قبل إنشاء الطلب | REJECTED | |
| same transaction against two requests | نفس transaction تُطابق طلبين مختلفين | REVIEW_REQUIRED | منعق المطابقة المتزامنة. |
| simultaneous requests | طلبان بنفس external_ref | 409 DUPLICATE | |
| concurrent events | حدثان متزامنان لنفس الطلب | serialized | تأمين الصف (row-level lock). |

## 2. اختبارات Device

| الحالة | السيناريو | التوقع |
|--------|-----------|--------|
| offline | الجهاز لا يرسل heartbeat | حالة OFFLINE بعد 180 ثانية. |
| reconnect | الجهاز يعيد الاتصال | حالة ONLINE، وإرسال Queue المتراكمة. |
| reboot | إعادة تشغيل الجهاز | يبقى OFFLINE حتى أول heartbeat. |
| listener disabled | مستخدم يعطل Notification Access | يظهر خطأ في الجهاز. |
| listener re-enabled | إعادة تفعيل الإذن | يستأنف الالتقاط. |
| network switching | تغيير WiFi/4G | يستمر العمل باستخدام local queue. |
| API unavailable | backend يرفض الطلب | يُعاد المحاولة بتراجع أسي (exponential backoff). |
| queue recovery | جهاز يعيد الاتصال بعد 100 حدث | يُرسل FIFO حتى النجاح. |
| app restart | إعادة فتح التطبيق | يُحمّل الـ queue من SQLite. |

## 3. اختبارات API

| الحالة | الطلب | التوقع |
|--------|-------|--------|
| invalid key | مفتاح API غير موجود | 401 AUTH_INVALID_KEY |
| revoked key | مفتاح تم إلغاؤه | 401 AUTH_INVALID_KEY |
| replay | نفس nonce + timestamp | 401 AUTH_REPLAY |
| invalid HMAC | توقيع خاطئ | 401 AUTH_INVALID_SIGNATURE |
| duplicate nonce | nonce مستخدم | 401 AUTH_REPLAY |
| old timestamp | timestamp > 60s | 401 AUTH_REPLAY |
| rate limit | أكثر من 100 req/min | 429 RATE_LIMIT |
| malformed payload | JSON غير صالح | 400 VALIDATION_ERROR |

## 4. اختبارات Webhook

| الحالة | استجابة الاستقبال | التوقع |
|--------|-------------------|--------|
| success | 200 | توقف إعادة المحاولة. |
| timeout | عدم الاستجابة | إعادة المحاولة 5 مرات. |
| 4xx | 400 | لا يعاد المحاولة. |
| 5xx | 500 | إعادة المحاولة 5 مرات. |
| duplicate delivery | نفس delivery_id | 200 يُتجاهل. |
| retry exhaustion | 5xx بعد 5 محاولات | ينقل إلى failed deliveries. |
