# المرحلة 2 — Backend Payment Engine وAPI

## الهدف
بناء قلب النظام الذي يستقبل طلبات المواقع، يربطها بالأجهزة، يستقبل Evidence من Android، ويقرر حالة الطلب بعد التحقق.

## المكونات
- Payment Request API
- Device API
- Transaction Ingestion
- Verification Engine
- Deduplication
- Idempotency
- Webhooks
- API Credentials
- Rate Limits
- Event Processing

## Payment Request API

### إنشاء طلب
`POST /v1/payment-requests`

مثال:
```json
{
  "external_reference": "ORDER-84721",
  "payment_type": "recharge",
  "amount": 400,
  "currency": "EGP",
  "expected_sender_phone": "01030951228",
  "expected_sender_name": "Wessam A Ahmed Ali",
  "expected_recipient_wallet": "01097273680",
  "metadata": {
    "customer_id": "12345"
  },
  "expires_at": "2026-08-26T13:30:00Z"
}
```

يُرجع:
- request_id
- status
- created_at
- expires_at

### الاستعلام
`GET /v1/payment-requests/{id}`

### الإلغاء
`POST /v1/payment-requests/{id}/cancel`

## Device API

### Register Device
`POST /v1/devices/register`

الجهاز يحصل على device credential بعد تسجيله.

### Heartbeat
`POST /v1/devices/{id}/heartbeat`

يرسل:
- app_version
- android_version
- listener_status
- battery
- network
- sync_queue_size
- timestamp

### Event ingestion
`POST /v1/devices/{id}/events`

لا ترسل Evidence إلى endpoint عام؛ يجب أن يكون endpoint محميًا ومربوطًا بجهاز محدد.

## Event schema
```json
{
  "event_id": "evt_...",
  "event_type": "payment_evidence_detected",
  "detected_at": "2026-08-26T13:14:37Z",
  "provider": "vodafone_cash",
  "source_package": "PACKAGE_NAME",
  "transaction_id": "022896233255",
  "amount": 400,
  "currency": "EGP",
  "sender_phone": "01030951228",
  "sender_name": "Wessam A Ahmed Ali",
  "recipient_wallet": "01097273680",
  "occurred_at": "2026-08-26T00:15:00",
  "raw_message": "...",
  "normalized_message": "...",
  "message_hash": "..."
}
```

## Verification Engine

نفّذ التحقق بهذا الترتيب:

1. Validate schema.
2. Authenticate device.
3. Check event_id idempotency.
4. Normalize phone numbers.
5. Normalize amount/currency.
6. Validate provider.
7. Check transaction uniqueness.
8. Check message hash duplication.
9. Check transaction age.
10. Find eligible PaymentRequests.
11. Compare amount.
12. Compare sender phone.
13. Compare optional sender name.
14. Compare recipient wallet when configured.
15. Compare time window.
16. Apply provider-specific rules.
17. Determine:
   - CONFIRMED
   - REJECTED
   - REVIEW_REQUIRED
   - DUPLICATE
18. Persist immutable verification result.
19. Create AuditEvent.
20. Queue webhook.

## Matching
لا تعتمد على score وحده.

القرار يكون Rule-based:
- amount mismatch => reject/review حسب policy.
- transaction already used => duplicate.
- expired request => reject/expired.
- exact transaction + amount + sender + valid window => confirmed.
- missing critical evidence => review.
- optional name mismatch لا يعني رفضًا تلقائيًا إلا إذا integration policy طلب ذلك.

## Transaction locking
قبل التأكيد:
- lock transaction.
- lock payment request.
- re-check state داخل transaction/database transaction.
- confirm مرة واحدة فقط.

## Webhooks
Endpoints:
- `payment.confirmed`
- `payment.rejected`
- `payment.review_required`
- `payment.expired`

كل webhook يحتوي:
- delivery_id
- event
- request_id
- transaction_id
- timestamp
- payload

التوقيع:
`HMAC-SHA256`

Headers:
- X-Webhook-Id
- X-Webhook-Timestamp
- X-Webhook-Signature

## Retry
استخدم exponential backoff مع حد أقصى.
كل delivery له status:
- pending
- delivered
- failed
- exhausted

## API Credentials
لكل Account يمكن إنشاء credential جديد.

الحقول:
- credential_id
- key_id
- secret_hash
- status
- created_at
- revoked_at
- last_used_at

عند إنشاء credential جديد:
- يمكن تفعيل سياسة revoke-old-key.
- المفتاح القديم لا يعود صالحًا.

لا تعرض secret بعد الإنشاء الأول.

## Request Signing
للطلبات الحساسة:
- API key
- timestamp
- nonce
- HMAC signature

ارفض:
- timestamp قديم.
- nonce مكرر.
- signature غير صحيحة.

## Rate limiting
طبقات:
- account
- API key
- IP
- device

## المطلوب قبل الانتقال
- إنشاء PaymentRequest يعمل.
- Device registration يعمل.
- Event ingestion يعمل.
- Deduplication يعمل.
- Verification Engine لديه اختبارات شاملة.
- Webhook delivery + retries تعمل.
- API credentials تعمل.
- HMAC/replay protection تعمل.
