# المرحلة 4 — Dashboard وعمليات الإدارة والمراجعة

## الهدف
بناء لوحة التحكم التي تجعل النظام قابلًا للإدارة اليومية، وتوضح كل عملية من لحظة إنشاء الطلب حتى التأكيد أو الرفض.

## الصفحات

### 1. Overview
Cards:
- Total Requests
- Pending
- Confirmed
- Rejected
- Review Required
- Expired
- Offline Devices

Charts:
- requests over time
- confirmation rate
- review rate
- webhook success rate

### 2. Payment Requests
Filters:
- status
- payment_type
- date
- amount
- device
- provider
- external_reference

Columns:
- request id
- external reference
- type
- amount
- status
- transaction
- device
- created
- updated

### 3. Request Details
أقسام:

Expected:
- amount
- sender phone
- sender name
- recipient
- type

Detected:
- amount
- sender
- transaction id
- recipient
- timestamp
- provider

Verification:
- amount match
- sender match
- name match
- recipient match
- transaction unique
- time valid
- provider valid

Evidence:
- original message
- normalized data
- source
- message hash

Timeline:
- every event chronologically

Webhook:
- delivery status
- retries
- last error

### 4. Manual Review
كل الحالات التي تحتاج تدخلًا.

يعرض:
- سبب المراجعة.
- expected data.
- detected data.
- evidence.
- device.
- transaction.
- timeline.

Actions:
- Approve
- Reject

كل action يحتاج audit event.

### 5. Devices
لكل جهاز:
- online/offline
- last seen
- Android version
- app version
- listener status
- queue size
- last sync
- account

Actions:
- revoke device
- rename device
- disconnect
- view activity

### 6. API
إدارة:
- credentials
- webhook endpoints
- webhook secret
- delivery logs
- API usage
- rate limit information

### 7. Audit Logs
Filters:
- user
- device
- event type
- entity
- date

كل event يظهر:
- actor
- action
- timestamp
- entity
- before/after summary
- request id

## Roles
ابدأ بـ:
- Owner
- Admin
- Operator
- Viewer

Operator:
- يرى الطلبات والمراجعات.
- لا يدير credentials.

Viewer:
- read-only.

## UX
الأولوية:
- status واضح.
- لا تخفي سبب الرفض.
- لا تعتمد على اللون وحده.
- كل status له label/icon/text.
- تفاصيل العملية في مكان واحد.
- البحث سريع.
- pagination/server-side filtering.

## Real-time
Dashboard يستقبل:
- new request
- evidence detected
- verification result
- device online/offline
- webhook status

استخدم WebSocket/SSE أو آلية مناسبة.

## Security
- كل endpoint يتحقق من account scope.
- RBAC server-side وليس UI فقط.
- العمليات الحساسة تحتاج permission.
- audit لكل تغيير.

## المطلوب قبل الانتقال
- Dashboard يعمل end-to-end.
- يمكن تتبع request كاملًا.
- Manual review يعمل.
- Device status واضح.
- API credentials management يعمل.
- Audit logs تعمل.
- Real-time updates تعمل.
