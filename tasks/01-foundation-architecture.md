# المرحلة 1 — الأساس المعماري وقاعدة المشروع

## الهدف
بناء الأساس الذي سيُبنى عليه نظام التحقق من المدفوعات بالكامل، مع فصل Android Agent عن Backend وعن Dashboard وعن Integrations.

## المخرجات
- Monorepo منظم.
- Backend API قابل للتشغيل.
- قاعدة بيانات أولية.
- Authentication.
- Accounts / Users.
- Devices.
- Payment Requests.
- Transactions.
- Audit Events.
- حالات النظام الأساسية.
- بيئة Development / Staging / Production.
- نظام migrations وseed.
- توثيق Architecture واضح.

## الهيكل المقترح
```text
/apps
  /api
  /dashboard
  /android-agent

/packages
  /shared-types
  /validation
  /security
  /provider-parsers

/infrastructure
  /database
  /docker
  /deployment

/docs
```

## الكيانات الأساسية
### Account
- id
- name
- status
- created_at
- updated_at

### User
- id
- account_id
- email/username
- password_hash أو مزود authentication
- role
- status
- created_at

### Device
- id
- account_id
- device_name
- platform
- app_version
- android_version
- status
- last_seen_at
- listener_status
- sync_status
- created_at
- updated_at

### PaymentRequest
- id
- account_id
- external_reference
- payment_type
- amount
- currency
- expected_sender_phone
- expected_sender_name
- expected_recipient_wallet
- status
- expires_at
- created_at
- updated_at

### Transaction
- id
- account_id
- provider
- transaction_id
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
- created_at

### PaymentMatch
يربط PaymentRequest مع Transaction ويمنع إعادة استخدام نفس العملية.

### AuditEvent
يسجل كل تغيير مهم:
- actor
- action
- entity
- entity_id
- timestamp
- metadata
- previous_hash
- event_hash

## حالات PaymentRequest
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
DEVICE_OFFLINE

## قواعد أساسية
1. Transaction ID يجب أن يكون unique ضمن provider/account حسب التصميم.
2. message_hash يستخدم لاكتشاف إعادة إرسال نفس الرسالة.
3. PaymentRequest لا يمكن تأكيده أكثر من مرة.
4. Transaction لا يمكن استخدامها لتأكيد أكثر من طلب إلا عبر flow صريح ومُسجل.
5. القرار النهائي يجب أن يكون Server-side.
6. كل تغيير حالة يجب أن ينتج AuditEvent.
7. كل API mutation يجب أن يدعم idempotency حيث يلزم.
8. لا تخزن الأسرار الحساسة plaintext.

## Authentication
نفّذ:
- Login.
- Access token قصير العمر.
- Refresh token rotation.
- Logout/revocation.
- Role-based access.
- Account isolation.

## Account Isolation
كل query حساس يجب أن يكون scoped إلى account_id.
ممنوع أن يستطيع مستخدم من Account A قراءة بيانات Account B حتى لو عرف ID.

## API conventions
استخدم:
- `/v1/...`
- JSON
- consistent error schema
- request_id
- pagination
- validation
- rate limiting hooks

## Error schema
```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Human readable message",
    "request_id": "..."
  }
}
```

## Idempotency
أي endpoint قد يؤدي إلى إنشاء/تأكيد عملية يجب أن يدعم:
`Idempotency-Key`

ويجب تخزين نتيجة الطلب المرتبط بالمفتاح لفترة مناسبة.

## المطلوب قبل الانتقال
- المشروع يعمل من clean install.
- migrations تعمل.
- authentication يعمل.
- account isolation مغطى باختبارات.
- PaymentRequest وTransaction وAuditEvent موجودة.
- API health endpoint يعمل.
- Docker/local development موثق.
- لا توجد secrets داخل repository.

## ممنوع في هذه المرحلة
- عدم بناء parser نهائي لـ Vodafone Cash.
- عدم تأكيد المدفوعات من Android مباشرة.
- عدم إضافة منطق دفع حقيقي.
- عدم تخزين API secrets بشكل مكشوف.
