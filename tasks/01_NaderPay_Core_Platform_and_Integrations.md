# Nader Pay — المرحلة 1: المنصة الأساسية والربط ونظام التحقق

## الهدف
بناء Nader Pay كمنصة Cloud-first، وليس كتطبيق Android منفصل لكل موقع.

المكونات:
- Nader Pay Cloud / Backend: مصدر الحقيقة ومحرك التحقق.
- Nader Pay Android Agent: يجمع Evidence من الإشعارات/المصادر المسموح بها.
- Dashboard: الإدارة والمراقبة والمراجعة.
- REST API: ربط المواقع والبوتات والأنظمة.
- Webhooks: إعادة نتيجة التحقق إلى النظام الخارجي.
- Developer Center: التوثيق والأمثلة وأدوات الربط.

## من يستخدم المنصة؟
الـ Account هو صاحب الموقع أو الخدمة، وليس العميل الذي يدفع.

داخل Account يمكن وجود:
- Owner
- Admin
- Operator
- Viewer

العملاء الذين يدفعون للموقع لا يحتاجون حسابات Nader Pay.

## السيناريو الكامل
1. صاحب الموقع ينشئ Account.
2. يسجل Android Device.
3. يثبت Nader Pay Agent ويفعل صلاحية الإشعارات.
4. ينشئ API Credential.
5. يضيف Webhook.
6. يضع كود الربط في موقعه.
7. الموقع ينشئ Payment Request عبر Nader Pay API.
8. Android Agent يلتقط إشعار الدفع.
9. Agent يستخرج Evidence ويضعها في Local Queue.
10. Evidence تصل للسيرفر.
11. Verification Engine يبحث عن الطلب المطابق.
12. يتم فحص المبلغ، الهاتف، الاسم الاختياري، المحفظة، رقم العملية، التاريخ، المصدر، والتكرار.
13. النتيجة: CONFIRMED أو REJECTED أو REVIEW_REQUIRED.
14. النتيجة تسجل في Audit Trail.
15. Webhook يرسل النتيجة للموقع.
16. Dashboard وTelegram يعرضان النتيجة.

## المبدأ المعماري
Android:
DETECT → PARSE → PRE-VALIDATE → QUEUE → SYNC

Cloud:
AUTHENTICATE → AUTHORIZE → DEDUPLICATE → MATCH → VERIFY → DECIDE → WEBHOOK

لا يوجد Confirm نهائي صادر من Android.

## Multi-Tenant / Account Isolation
كل كيان يحتوي account_id:
- Users
- Devices
- API Credentials
- Websites/Integrations
- Payment Requests
- Transactions
- Webhooks
- Audit Events
- Security Events
- Subscription

كل API query/mutation يجب أن يتحقق من:
1. الهوية.
2. عضوية الحساب.
3. الصلاحية.
4. ملكية الـ resource.
5. حالة الـ resource.

يمنع تمامًا وصول Account إلى بيانات Account آخر.

## Payment Request
Endpoint:
POST /v1/payment-requests

مثال:
```json
{
  "external_reference": "ORDER-58291",
  "payment_type": "recharge",
  "amount": 400,
  "currency": "EGP",
  "expected_sender_phone": "01030951228",
  "expected_sender_name": "Wessam A Ahmed Ali",
  "expected_recipient_wallet": "01097273680",
  "metadata": {"customer_id": "12345"},
  "expires_at": "..."
}
```

الاستجابة:
- request_id
- status
- created_at
- expires_at

## حالات الطلب
CREATED
WAITING_PAYMENT
MESSAGE_DETECTED
PARSING
VERIFYING
CONFIRMED
REJECTED
REVIEW_REQUIRED
DUPLICATE
EXPIRED
CANCELLED

استخدم State Machine لمنع الانتقالات غير المسموحة.

## Transaction / Evidence
Transaction منفصلة عن Payment Request.

تحتوي:
- transaction_id
- account_id
- provider
- amount
- currency
- sender_phone
- sender_name
- recipient_wallet
- occurred_at
- raw_message
- normalized_message
- message_hash
- source_package
- detected_by_device_id
- verification_status

PaymentMatch يربط Transaction بالـ PaymentRequest.

## Verification Engine
الترتيب:
1. Validate schema.
2. Authenticate device.
3. Check event idempotency.
4. Normalize phone/amount.
5. Validate provider.
6. Check transaction uniqueness.
7. Check message hash duplication.
8. Check transaction age.
9. Find eligible requests.
10. Match amount.
11. Match sender.
12. Match optional name.
13. Match recipient wallet عند تفعيله.
14. Validate time window.
15. Apply provider rules.
16. Lock request + transaction.
17. Re-check state داخل DB transaction.
18. Decide.
19. Persist immutable result.
20. Audit.
21. Queue webhook.

القواعد:
- Transaction مستخدمة سابقًا → DUPLICATE.
- Request منتهٍ → EXPIRED.
- بيانات حرجة ناقصة → REVIEW_REQUIRED.
- تطابق قوي كامل → CONFIRMED.
- اختلافات حسب policy → REJECTED أو REVIEW_REQUIRED.

لا تعتمد على score وحده.

## Anti-Duplicate
استخدم:
- event_id
- transaction_id
- message_hash
- idempotency_key
- unique constraints
- database transactions/locks

نفس Transaction لا تؤكد طلبين بطريقة غير مصرح بها، ونفس Request لا يتأكد مرتين.

## API Credentials
لكل Account Credentials مستقلة.

لا تخزن secret plaintext.

استخدم:
- key_id
- secret_hash
- status
- created_at
- revoked_at
- last_used_at

للطلبات الحساسة:
API Key + Timestamp + Nonce + HMAC.

ارفض credential revoked، timestamp قديم، nonce مكرر، أو signature غير صحيحة.

## Website Integration
الموقع يتصل بـ Nader Pay API، وليس Android مباشرة.

Dashboard يوفر:
- API Credentials
- Webhook URL
- Webhook Secret
- Documentation
- Copy-ready examples

أمثلة:
- PHP
- Laravel
- Node.js
- Python
- cURL

ويتم توفير SDKs رسمية لاحقًا.

## Integration Wizard
1. Create Account.
2. Register Device.
3. Connect Agent.
4. Generate Credential.
5. Add Webhook.
6. Test Connection.
7. Create Sandbox Payment.
8. Receive Test Webhook.
9. Go Live.

## Webhooks
الأحداث:
- payment.confirmed
- payment.rejected
- payment.review_required
- payment.expired
- device.online
- device.offline
- webhook.failed

كل Delivery له delivery_id وstatus وattempts وlast_error.

استخدم HTTPS + HMAC + timestamp + retry/backoff.

## Telegram
Telegram Integration واجهة إضافية، وليست مصدر الحقيقة.

يمكن إرسال:
- confirmed
- rejected
- review required
- device status
- webhook failures

أوامر مثل:
- /status
- /pending
- /today
- /payment <id>
- /device

كل أمر يخضع لـ Authorization وAudit.

## Android Agent
مسؤولياته:
- Notification Listener.
- Source Adapters.
- Provider Parser.
- Local encrypted storage.
- Offline Queue.
- Sync.
- Heartbeat.
- Permission state.

لا يحتوي على Verification Engine النهائي أو أسرار النظام.

## Provider Parser
استخدم ProviderParser interface بدل وضع Regex داخل Notification Listener.

Input:
- package
- title
- text
- timestamp

Output موحد:
- provider
- amount
- sender_phone
- sender_name
- recipient_wallet
- transaction_id
- occurred_at
- confidence

ادعم versioned provider configurations لأن صيغة الرسائل قد تتغير.

## Offline Queue
عند انقطاع الإنترنت:
- Evidence تحفظ محليًا.
- تدخل queue.
- لا تحذف قبل ACK.
- تعاد المحاولة بعد الاتصال.
- السيرفر idempotent.

## Dashboard
الصفحات:
- Overview
- Payment Requests
- Request Details
- Manual Review
- Devices
- Integrations
- API
- Webhooks
- Developer Center
- Audit Logs
- Subscription
- Security Events

Request Details يعرض Expected / Detected / Verification / Evidence / Timeline / Webhook / Device.

## Developer Center
- Quick Start
- Authentication
- Create Payment
- Retrieve Payment
- Webhooks
- Signatures
- Errors
- Rate Limits
- SDK examples
- Sandbox
- Telegram
- Troubleshooting

## Subscription-ready
من البداية صمم:
- Plan
- Subscription
- Trial
- Limits
- Feature flags
- Expiration
- Suspension

التنفيذ المالي الكامل يمكن إضافته دون إعادة بناء المعمارية.

## Definition of Done
- الموقع ينشئ Payment Request.
- Android يلتقط Evidence.
- Evidence تصل للسيرفر.
- Verification يعمل.
- Duplicate protection تعمل.
- Confirmation لا تتكرر.
- Webhook يصل.
- Dashboard يعرض العملية.
- Telegram integration تعمل.
- Offline queue تعمل.
- Tenant isolation مختبر.
- Credentials محمية.
- Audit كامل.
