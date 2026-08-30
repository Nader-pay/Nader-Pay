# Nader Pay — المرحلة 2: الأمان والتحكم والاشتراكات والإنتاج

## الهدف
جعل Nader Pay منصة Production قوية بحيث يكون Android Agent مجرد عميل محدود الصلاحيات، وحتى لو تم فك APK أو تعديله لا يستطيع المهاجم استخدامه لتجاوز السيرفر أو تأكيد عمليات.

## قاعدة الأمن الأساسية
لا نحاول جعل APK غير قابل للكسر؛ هذا غير واقعي.

الهدف:
إذا تم فك/تعديل/إعادة توقيع التطبيق، فلا يحصل المهاجم على:
- Master secrets.
- Database access.
- Admin access.
- Verification Engine.
- القدرة على Confirm.
- القدرة على انتحال Device موثوق.

## Super Admin
Control Plane مستقل عن Accounts.

صلاحيات Super Admin:
- إنشاء/تعطيل/تعليق Accounts.
- تغيير Plans.
- إدارة Devices.
- Revoke Device.
- Revoke Credentials.
- تعطيل API/Webhooks.
- Force Re-authentication.
- Minimum App Version.
- Feature Flags.
- Provider configurations.
- Global policies.
- Security Events.
- System Health.
- Subscription policies.

كل عملية إدارية حساسة تسجل Audit Event.

## لا أسرار داخل APK
ممنوع:
- master API secrets
- database credentials
- admin credentials
- signing secrets
- verification secrets
- subscription bypass logic

داخل التطبيق.

التطبيق يحصل على Device Credential محدود وقابل للإلغاء.

## Device Identity
لكل جهاز:
- device_id
- account_id
- credential_id
- installation_id
- app_version
- status
- risk_level
- last_seen_at

يفضل asymmetric device identity:
- Private key داخل Android Keystore.
- Public key مسجل على السيرفر.

التطبيق يثبت امتلاكه للمفتاح عند الطلب.

## Device Binding
الجهاز مربوط بـ Account.

محاولة استخدام credential على جهاز آخر → Reject.

Revoke Device → إلغاء credentials فورًا.

## App Integrity
طبقات:
- Release signing.
- Obfuscation.
- R8/ProGuard للمكونات native.
- Flutter obfuscation إذا تم اختيار Flutter.
- Play Integrity حيثما يناسب.
- Runtime security signals.
- Version enforcement.
- Device registration.
- Server-issued credentials.

لا تعتمد على client-side integrity وحدها.

## Tamper Detection
راقب:
- signature mismatch
- invalid integrity result
- unsupported version
- suspicious debugging/runtime signals
- credential misuse
- device/account anomalies

الإجراءات:
LOW → Log
MEDIUM → Re-authentication
HIGH → Restriction
CRITICAL → Revoke credentials + Block Device + Require re-registration

Root detection مجرد signal وليس أساسًا وحيدًا.

## Remote Control / Kill Switch
Server policy مثل:
```json
{
  "service_enabled": true,
  "minimum_supported_version": "1.0.8",
  "force_update": false,
  "integrity_required": true
}
```

Super Admin يستطيع:
- تعطيل نسخة.
- فرض تحديث.
- تعطيل جهاز.
- تعطيل Account.
- تعطيل Feature.
- إلغاء Credential.

Kill Switch يعطل الخدمة/الجهاز ولا ينفذ أوامر خفية على الهاتف.

## App Updates
كل Release:
- version
- build
- channel
- minimum_supported_version
- rollout
- status

دعم:
- staged rollout
- forced security update
- rollback
- blocked versions

## Encryption
### Transport
TLS فقط.

### Android
- Android Keystore.
- encrypted local database/queue.
- secure credential storage.

### Server
- encryption at rest حسب الحاجة.
- secrets manager.
- key rotation.
- لا secrets في source code.

Raw messages تعامل كبيانات حساسة:
- restricted access
- masking
- لا توضع في logs العادية
- retention policy

## Server Security
- API Gateway.
- Authentication.
- Authorization.
- RBAC.
- Tenant isolation.
- Rate limiting.
- WAF مناسب.
- Input validation.
- Secure headers.
- CSRF protections عند الحاجة.
- SQL injection protection.
- SSRF protection للـ webhook URLs.
- dependency scanning.

## Webhook Security
- HTTPS.
- HMAC.
- timestamp.
- delivery_id.
- retry/backoff.
- failed/dead-letter state.

## API Abuse Protection
راقب:
- IP.
- Account.
- API credential.
- Device.
- nonce reuse.
- signature failures.
- abnormal volume.

الإجراء:
- rate limit
- temporary block
- credential revoke
- security alert

## Subscription System
Plan:
- id
- name
- price
- billing_period
- limits
- features
- status

Subscription:
- account_id
- plan_id
- status
- starts_at
- ends_at
- trial_ends_at

الحالات:
TRIAL
ACTIVE
PAST_DUE
EXPIRED
SUSPENDED
CANCELLED

عند انتهاء الاشتراك:
- لا تحذف البيانات.
- طبّق Grace Period حسب السياسة.
- عطّل الخدمات المحددة.
- أبقِ Dashboard متاحًا حسب policy.
- إعادة التفعيل لا تفقد البيانات.

## Usage Metering
قِس:
- Payment Requests
- Verified Transactions
- Webhook Deliveries
- Active Devices
- API Requests
- Evidence storage

الاستهلاك server-side.

## Security Events
كيان:
- event_id
- account_id
- device_id
- severity
- type
- timestamp
- metadata
- resolved_at

أنواع:
- integrity_failure
- signature_failure
- replay_attempt
- credential_abuse
- device_mismatch
- suspicious_volume
- webhook_abuse
- repeated_auth_failure

## Audit Trail
كل عملية مهمة تسجل:
- actor
- account_id
- action
- entity
- entity_id
- timestamp
- request_id
- metadata

للأحداث الحساسة استخدم append-only storage أو hash chaining.

## Super Admin Security
- MFA.
- Short sessions.
- Session/device management.
- Re-authentication للعمليات الحرجة.
- Audit كامل.

عمليات حرجة:
- revoke account
- revoke device
- global policy change
- secret rotation
- subscription change
- provider configuration change

## Monitoring
راقب:
- API latency
- error rate
- verification rate
- duplicate rate
- parser failures
- offline devices
- queue backlog
- webhook failures
- auth failures
- integrity failures
- database/worker health

Alerts عند وجود spikes أو anomalies.

## Production
افصل:
- Development
- Staging
- Sandbox
- Production

لا تشارك Production secrets/database مع البيئات الأخرى.

استخدم:
- secrets manager
- encrypted backups
- monitoring
- rollback
- migration strategy
- signed Android releases
- CI/CD security checks

## Disaster Recovery
حدد:
- backup schedule
- RPO
- RTO
- restore procedure
- database recovery
- webhook/event recovery

اختبر الاستعادة فعليًا.

## Security Testing
### App
- modified APK
- invalid signature
- blocked version
- revoked device
- invalid credential
- device mismatch
- replay
- offline/reconnect
- duplicate queue

### API
- invalid HMAC
- reused nonce
- old timestamp
- invalid/revoked key
- rate limit
- cross-account access
- IDOR
- malformed payload

### Verification
- duplicate transaction
- same transaction vs two requests
- amount mismatch
- sender mismatch
- old transaction
- expired request
- race conditions

### Admin
- role escalation
- unauthorized account access
- unauthorized device control
- audit tampering

## Account Isolation النهائي
العلاقة:
Account
→ Users
→ Devices
→ API Credentials
→ Websites
→ Telegram Integrations
→ Payment Requests
→ Transactions
→ Webhooks
→ Audit Logs
→ Security Events
→ Subscription

كل endpoint يتحقق من identity + membership + permission + ownership + resource state.

## Production Definition of Done
Nader Pay جاهز عندما:
- صاحب الموقع ينشئ Account.
- يسجل Device.
- يحصل على Credentials.
- يربط موقعه.
- ينشئ Payment Request.
- Android يجمع Evidence.
- السيرفر يتحقق.
- transaction لا تتكرر.
- webhook يصل.
- Telegram يعمل.
- Dashboard يعرض كل شيء.
- offline recovery تعمل.
- tenant isolation مختبرة.
- device binding/revocation تعمل.
- integrity/version controls تعمل.
- subscription engine جاهز.
- Super Admin يتحكم مركزيًا.
- audit/security events تعمل.
- monitoring/alerts تعمل.
- backups/recovery مختبرة.
- production secrets منفصلة.
- security regression tests تعمل.

## القرار النهائي
Nader Pay Cloud = Source of Truth.
Android Agent = Evidence Collector.
Dashboard = Control Plane.
API = Integration Layer.
Webhook = Result Delivery.
Telegram = Optional Operations Interface.
Account = Tenant.
Device = Registered Agent قابل للإلغاء.
Subscription = Server-side entitlement.

بهذا التصميم، تعديل التطبيق وحده لا يعطي المهاجم صلاحية لتجاوز Nader Pay.
