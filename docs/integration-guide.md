# دليل التكامل خطوة بخطوة

## 1. إنشاء حساب

1. افتح تطبيق أو موقع منصة Payment Evidence.
2. سجّل حساب جديد باستخدام البريد أو رقم الهاتف.
3. أكد بريدك/رقمك.
4. ستنتقل إلى لوحة التحكم (Dashboard).

## 2. تسجيل جهاز Android

1. من لوحة التحكم، انتقل إلى **الأجهزة**.
2. اضغط **إضافة جهاز**.
3. أدخل اسم الجهاز (مثل: "تابلت المتجر 1").
4. سيتم إنشاء `device_id` و token للجهاز.
5. ثبّت تطبيق Android Agent على الجهاز.
6. أدخل `device_id` و token في شاشة الإعدادات الأولى.

## 3. تفعيل Notification Access

1. على جهاز Android، افتح **الإعدادات > التطبيقات > Notification Access**.
2. فعّل تطبيق Payment Evidence Agent.
3. امنح الإذن للقراءة من الإشعارات.

> هذا الإذن ضروري لالتقاط رسائل التأكيد المالية من تطبيقات البنوك.

## 4. إنشاء API Credential

1. من لوحة التحكم، انتقل إلى **API Credentials**.
2. اضغط **إنشاء مفتاح جديد**.
3. انسخ `API_KEY` و `API_SECRET` واحفظهما في مدير Secrets (لا تعرضهما في الكود).
4. اختر الأذونات: قراءة/إنشاء طلبات، قراءة حالة، إلغاء.

## 5. إنشاء Webhook

1. انتقل إلى **Webhooks**.
2. اضغط **إضافة webhook**.
3. أدخل عنوان URL للاستقبال (مثال: `https://yourstore.com/webhooks/payment-evidence`).
4. اختر الأحداث: `payment_request.confirmed`, `payment_request.rejected`, `payment_request.review_required`, `payment_request.expired`.
5. انسخ `webhook_secret` للتحقق من التوقيع.

## 6. إرسال Payment Request من الموقع

استخدم API:

```bash
curl -X POST /payment-requests \
  -H "x-api-key: apikey_xxx" \
  -H "x-timestamp: ..." \
  -H "x-nonce: ..." \
  -H "x-signature: ..." \
  -d '{
    "amount": 150,
    "currency": "SAR",
    "provider": "bank_x",
    "external_ref": "order_456",
    "sender_name": "Ahmed",
    "expires_at": "2026-08-26T12:00:00Z"
  }'
```

سيتحول الطلب إلى `PENDING` ويظهر في لوحة التحكم.

## 7. انتظار Confirmation

عندما يدفع العميل:

1. تطبيق البنك يرسل إشعارًا إلى جهاز Android.
2. Android Agent يلتقط الرسالة ويحسب hash.
3. يُرسل evidence إلى backend.
4. Backend يقوم بـ parsing و deduplication و verification.
5. إذا تطابق كل شيء: يتحول الطلب إلى `CONFIRMED`.
6. إذا كانت هناك حالة غير حاسمة: يتحول إلى `REVIEW_REQUIRED`.

## 8. معالجة Webhook

عند استلام webhook:

```python
import hmac, hashlib

secret = webhook_secret
sig = request.headers.get('x-webhook-signature')
expected = hmac.new(secret.encode(), f"{timestamp}.{delivery_id}.{body}".encode(), hashlib.sha256).hexdigest()

if not hmac.compare_digest(sig, expected):
    return 401

# معالجة الحدث
if payload['event'] == 'payment_request.confirmed':
    mark_order_as_paid(payload['data']['external_ref'])

# 200 يُوقف إعادة المحاولة
return 200
```

## 9. التعامل مع Review/Rejected/Expired

### REVIEW_REQUIRED

- تفقد لوحة التحكم > **المراجعة اليدوية**.
- قارن المتوقع بالمكتشف.
- اختر **موافقة** أو **رفض** مع إضافة ملاحظة.

### REJECTED

- يعني أن evidence لا تطابق الطلب.
- لا تعتمد على الطلب واطلب من العميل إعادة المحاولة أو التحقق من الدفع.

### EXPIRED

- لم يصل any evidence قبل `expires_at`.
- يمكنك إنشاء طلب جديد أو إلغاء الطلب.

## 10. اختبار سري

1. أرسل طلب من API.
2. أجرِ دفع تجريبي (أو أرسل رسالة اختبار من خلال Android Agent).
3. تأكد من أن الطلب تغير حالته.
4. تحقق من أن webhook وصل لك.
5. راجع audit log في لوحة التحكم.
