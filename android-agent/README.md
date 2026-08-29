# PayVerify Agent — Android Device Agent

## نظرة عامة

تطبيق Android مستقل يعمل كـ Device Agent لنظام PayVerify.
يلتقط إشعارات Vodafone Cash، يحللها، يحفظها محليًا، ويرسل Evidence للسيرفر للتحقق.

## مبدأ الأمان الأساسي

```
Android Agent:  DETECT → PARSE → PRE-VALIDATE → QUEUE → SYNC
Server:         VERIFY → CONFIRM / REJECT / REVIEW
```

القرار النهائي **دائمًا للسيرفر** — التطبيق يجمع الأدلة فقط.

---

## هيكل المشروع

```
app/src/main/java/com/payverify/agent/
├── AgentApplication.kt               — تهيئة التطبيق + قنوات الإشعارات
├── data/
│   ├── db/
│   │   ├── AgentDatabase.kt          — Room Database (SQLite)
│   │   ├── EvidenceEntity.kt         — Evidence table + DAO
│   │   └── (SyncStatus enum)
│   ├── parser/
│   │   ├── ProviderParser.kt         — واجهة + ParserRegistry
│   │   └── VodafoneCashParser.kt     — Vodafone Cash parser (v1 + v2)
│   ├── api/
│   │   ├── ApiClient.kt              — Retrofit service + DTOs
│   │   └── SyncQueue.kt              — Offline queue processor
│   └── security/
│       └── SecureStorage.kt          — Android Keystore (EncryptedSharedPreferences)
├── domain/
│   └── Models.kt                     — EvidenceItem, SystemStatus (Domain models)
├── services/
│   └── PaymentNotificationListenerService.kt  — NotificationListenerService
├── workers/
│   └── Workers.kt                    — SyncWorker + HeartbeatWorker (WorkManager)
├── receivers/
│   └── BootReceiver.kt               — BOOT_COMPLETED handler
└── ui/
    ├── AgentViewModel.kt             — ViewModel (Flow-based state)
    ├── MainActivity.kt               — Entry point + Navigation + Theme
    ├── permission/
    │   └── PermissionSetupScreen.kt  — إعداد صلاحية Notification Listener
    ├── dashboard/
    │   └── DashboardScreen.kt        — حالة النظام + إحصاءات
    ├── activity/
    │   └── ActivityScreen.kt         — قائمة Evidence
    └── evidencedetail/
        └── EvidenceDetailScreen.kt   — تفاصيل Evidence (الرسالة محمية)

app/src/test/java/com/payverify/agent/parser/
└── VodafoneCashParserTest.kt         — 8 اختبارات Parser
```

---

## Pipeline معالجة الإشعارات

```
onNotificationPosted(sbn)
  │
  ├─ 1. تحقق من allowlist (package name)
  ├─ 2. استخراج title/text/subText/bigText/timestamp
  ├─ 3. ParserRegistry.parse(input)
  │     └─ VodafoneCashParser.parse()
  │           ├─ keyword filter (تصفية سريعة)
  │           ├─ pattern matching (v2 → v1)
  │           ├─ field extraction (amount/phone/name/wallet/txn)
  │           └─ ParsedEvidence
  ├─ 4. Deduplication check (eventId / messageHash / transactionId)
  ├─ 5. EvidenceEntity → Room DB (PENDING)
  └─ 6. SyncQueue → SyncWorker (WorkManager)
```

---

## Offline Queue States

```
PENDING → SENDING → SENT
                 ↘ FAILED (≤5 محاولات)
                       ↘ PERMANENTLY_FAILED
```

**لا يُحذف Evidence المحلي قبل تأكيد السيرفر.**
Server idempotency key = `event_id` (SHA-256 hash).

---

## Provider Parser — إضافة مزود جديد

```kotlin
class MyNewProviderParser : ProviderParser {
    override val supportedPackages = setOf("com.example.mywallet")
    override fun parse(input: NotificationInput): ParsedEvidence? {
        // تطبيق المنطق
    }
}

// ثم في ParserRegistry:
val parsers = listOf(VodafoneCashParser(), MyNewProviderParser())
```

---

## إعداد التطوير

### المتطلبات
- Android Studio Hedgehog+
- JDK 17
- Android SDK 34
- minSdk 26 (Android 8.0+)

### تشغيل الاختبارات
```bash
cd android-agent
./gradlew :app:test
```

### بناء APK
```bash
./gradlew :app:assembleDebug
```

---

## ربط التطبيق بالسيرفر

1. سجّل الجهاز من `settings/device-api` بواجهة PayVerify Dashboard
2. احفظ `device_id` + `device_token` في SecureStorage
3. ضع `api_base_url` = `https://hbldhnpduoczneoyfzyz.supabase.co/functions/v1`
4. فعّل Notification Listener من إعدادات النظام

---

## الصلاحيات

| الصلاحية | الاستخدام |
|----------|-----------|
| BIND_NOTIFICATION_LISTENER_SERVICE | اكتشاف إشعارات Vodafone Cash |
| INTERNET | إرسال Evidence للسيرفر |
| RECEIVE_BOOT_COMPLETED | استئناف WorkManager بعد إعادة التشغيل |
| FOREGROUND_SERVICE | مزامنة موثوقة |
| POST_NOTIFICATIONS | إشعارات حالة الدفعة |

> SMS adapter موجود كـ placeholder فقط، غير مفعّل. يتطلب موافقة Google Play منفصلة.

---

## الأمان

- لا توجد secrets بـ plaintext — جميعها مُشفَّرة بـ Android Keystore
- `device_token` يُبطَل من السيرفر مباشرة → HeartbeatWorker يكتشف ذلك
- الرسالة الأصلية لا تظهر على lock screen (VISIBILITY_PRIVATE)
- Evidence detail يتطلب فتح التطبيق (in-app only)
