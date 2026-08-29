# وثيقة المتطلبات

## 1. نظرة عامة على التطبيق

**اسم التطبيق:** Nader Pay Android Agent

**وصف التطبيق:** تطبيق Android عام لمراقبة وتحقق التحويلات المالية عبر SMS. يعمل كـ Generic Payment Verification Agent قابل للربط بأي Backend متوافق يوفر API Contract محددًا. يستلم طلبات الدفع/الشحن من الخادم، يقرأ رسائل SMS محليًا، يحلل التحويلات عبر Parsers مستقلة لكل Provider، يطابق البيانات مع الطلبات، يمنع التكرار، ثم يرسل نتيجة التحقق إلى الخادم. يدعم عدة Server Profiles مع إمكانية التبديل بينها دون إعادة بناء التطبيق.

**الملفات الرئيسية:**
- src/app/(app)/index.tsx
- src/app/(app)/orders/index.tsx
- src/app/(app)/orders/[id].tsx
- src/app/(app)/payment-sources/index.tsx
- src/app/(app)/settings/index.tsx
- src/app/(app)/server-profiles/index.tsx
- src/services/smsReader.ts
- src/services/smsListener.ts
- src/services/providers/vodafoneCashParser.ts
- src/services/providers/orangeCashParser.ts
- src/services/providers/instaPayParser.ts
- src/services/providers/providerRegistry.ts
- src/services/sourceVerification.ts
- src/services/matchingEngine.ts
- src/services/verificationEngine.ts
- src/services/pollingWorker.ts
- src/services/backgroundAgent.ts
- src/services/backendConnector.ts
- src/services/apiDiscovery.ts
- src/services/orderNormalizer.ts
- src/services/syncEngine.ts
- src/services/serverProfileManager.ts
- src/services/deviceRegistration.ts
- src/db/localStore.ts
- src/types/types.ts
- NADERPAY_AGENT_ARCHITECTURE.md

---

## 2. المستخدمون وسيناريوهات الاستخدام

**المستخدم المستهدف:** مشغّل الجهاز الذي يثبّت التطبيق ويربطه بأي Backend متوافق لمراقبة تحويلات Vodafone Cash وOrange Cash وInstaPay.

**السيناريو الكامل:**
1. المستخدم يدخل Base URL وAPI Key/Token ونوع المصادقة
2. التطبيق يتصل ويكتشف API Contract تلقائيًا من Discovery Endpoint
3. يتحقق من صحة الـEndpoints المكتشفة ويحفظ Server Profile
4. يسجّل الجهاز ويبدأ Realtime أو Polling
5. الخادم ينشئ طلبًا بحالة Pending
6. Agent يسحب الطلب → NEW → QUEUED
7. يبدأ Scan تلقائيًا → SCANNING
8. يحدد Provider من رسائل SMS الواردة
9. Parser المخصص يستخرج بيانات التحويل
10. Order Normalizer يحول البيانات إلى نموذج داخلي موحد
11. Matching Engine يطابق البيانات مع الطلب عبر مراحل التحقق المتعددة
12. يتحقق من عدم التكرار محليًا وعلى الخادم
13. عند تطابق ناجح: MATCHED → VERIFYING → CONFIRMED → Sync إلى الخادم
14. عند غموض: REVIEW_REQUIRED
15. عند عدم التطابق أو انتهاء الصلاحية: REJECTED / EXPIRED
16. الخادم يحدّث حالة الطلب

---

## 3. ما يجب إزالته من التطبيق الحالي

يجب حذف أو تعطيل كل ما يلي إن وُجد:
- Nader Pay API integration وPayment Gateway
- Payment Request creation
- Payment Status API الخاص ببوابة Nader Pay
- Webhook dispatcher وWebhook Secret
- Nader Pay API Key / Secret
- Merchant Payment Integration screens
- أي flow يجعل التطبيق مصدر الطلبات
- أي Hardcoded Endpoint لخادم بعينه
- أي افتراض مباشر بـ Supabase كـ Backend وحيد

**ممنوع حذف:** بيانات الإنتاج أو بيانات المستخدمين أو سجلات الخادم.

---

## 4. هيكل الشاشات والوظائف

### 4.1 خريطة الشاشات

```
Nader Pay Android Agent
├── الرئيسية / Dashboard (Home)
├── الطلبات (Orders)
│   └── تفاصيل الطلب (Order Details)
├── مصادر الدفع (Payment Sources)
├── ملفات الخادم (Server Profiles)
└── الإعدادات (Settings)
```

---

### 4.2 شاشة الرئيسية / Dashboard (Home)

**الغرض:** عرض الحالة التشغيلية الفورية للـ Agent.

**المعلومات المعروضة:**
- حالة Agent (نشط / متوقف)
- حالة الإنترنت
- حالة الاتصال بالخادم النشط (Backend Status)
- حالة Realtime (نشط / Polling / غير متاح)
- حالة SMS Permission
- حالة تسجيل الجهاز
- آخر مزامنة (Last Sync)
- آخر تحقق (Last Verification)
- آخر خطأ (Last Error)
- إحصائيات الطلبات: معلّق، جاري الفحص، مؤكد، مرفوض، مكرر، يحتاج مراجعة، Offline Queue

**الأزرار:**
- Update Now: مزامنة فورية
- Test Connection: اختبار الاتصال بالخادم النشط

**التصميم:** Minimal — مساحات بيضاء كافية، تسلسل هرمي واضح، بدون ظلال أو ألوان زخرفية.

---

### 4.3 شاشة الطلبات (Orders)

**الغرض:** عرض طلبات الدفع/الشحن التي يعالجها الـ Agent فقط.

**Tabs:**
الكل — جديد — جاري الفحص — يحتاج مراجعة — مؤكد — مرفوض — مكرر — منتهي — انتظار مزامنة

**بيانات كل Card:**
- order_id، amount، sender_phone، sender_name (إن وُجد)، Provider، status، وقت الطلب، آخر فحص

**القيود:**
- لا تعرض Regular Orders أو Gemini/service orders
- استخدم discriminator الفعلي الموجود في الخادم للتمييز

---

### 4.4 شاشة تفاصيل الطلب (Order Details)

**البيانات المعروضة:**
- بيانات الطلب القادمة من الخادم (Raw Order محفوظ)
- بيانات الرسالة المكتشفة (Raw SMS محفوظ)
- النموذج الداخلي الموحد: order_id، customer/user، payment_method، provider، amount، sender_phone، receiver_phone، sender_name، transaction_id، transaction_reference، order_created_at، message_received_at، service/type
- نتيجة كل خطوة من خطوات التحقق
- rejection_reason أو duplicate_reason عند الانطباق
- سجل زمني (Timeline) لكل الأحداث

**Timeline متعدد المراحل:**
Order Received → Message Search → Message Matched → Provider Verified → Amount Verified → Sender Verified → Receiver Verified → Transaction ID Verified → Timestamp Verified → Duplicate Check → Verification Complete → Confirm/Reject → Sync Complete

يعرض لكل خطوة: timestamp والنتيجة والتفاصيل ذات الصلة.

---

### 4.5 شاشة مصادر الدفع (Payment Sources)

**الغرض:** إدارة Providers وإعداداتهم.

**Providers المدعومة:** Vodafone Cash، Orange Cash، InstaPay (Architecture قابلة للإضافة)

**لكل Provider:**
- enabled / disabled
- receiving account / wallet
- approved sender/origin identifiers
- message patterns / verification status
- Provider Test Mode: يعرض Detected Provider، Parsed Amount، Sender، Recipient، Transaction ID، Date، Time، Balance، Confidence، Validation Errors — دون إرسال أي بيانات إلى الخادم

**Learning / Source Verification Mode:** للمسؤول فقط — تحديد رسالة حقيقية واستخراج قواعد غير حساسة للمصدر.

---

### 4.6 شاشة ملفات الخادم (Server Profiles)

**الغرض:** إدارة عدة Backend Profiles مع إمكانية التبديل بينها.

**لكل Profile:**
- اسم Profile (مثال: Nader Pay، Backend آخر)
- Base URL
- API Key/Token
- نوع المصادقة
- حالة الاتصال
- آخر مزامنة ناجحة
- Endpoints المكتشفة (للعرض فقط في قسم Advanced)

**الأزرار لكل Profile:**
- Connect / Test Connection
- Auto Discovery
- تعيين كـ Active Profile
- حذف Profile

**إضافة Profile جديد:**
- إدخال Base URL وبيانات المصادقة
- الضغط على Connect يبدأ: Authenticate → Discover Config → Validate API Contract → Register Device → Start Realtime أو Polling → Fetch Pending Orders → Start Sync Engine

**ممنوع إضافة:** Service Role Key، Webhook Secret، Database Password، Telegram Token، Nader Pay API Key.

---

### 4.7 شاشة الإعدادات (Settings)

**أقسام الإعدادات:**
- Active Server Profile: عرض Profile النشط مع رابط لشاشة Server Profiles
- SMS: حالة الصلاحية، طلب الصلاحية
- Background Agent: حالة الخدمة، إعدادات التشغيل
- Notifications: تفعيل/تعطيل أنواع الإشعارات
- Battery Optimization: توجيهات استثناء التطبيق
- Diagnostics:
  - Connection: HTTP status، endpoint، method، response body، request ID، authentication state، last successful connection، last successful sync
  - Realtime: حالة Realtime، retry count
  - Device: Device ID، حالة التسجيل
  - SMS Permission، Agent Status
  - Last SMS، Last Scan، Active Orders، Queued Syncs
  - Local DB، Provider Parser status
  - Pending Sync Queue

**الأزرار:** حفظ الإعدادات، Test Connection

---

## 5. منطق الأعمال والقواعد

### 5.1 Backend Connector

- مكوّن مستقل لا يرتبط بـ Supabase أو بعنوان API ثابت
- يقبل: Base URL، API Key/Token، نوع المصادقة
- يدير: الاتصال، الاكتشاف، التسجيل، المزامنة، Realtime/Polling
- لا يحتوي على أي Hardcoded Endpoint
- يدعم أنواع مصادقة متعددة (Bearer Token، API Key Header، وغيرها)

---

### 5.2 API Discovery

- بعد إدخال Base URL وبيانات المصادقة والضغط على Connect:
  1. يستدعي Configuration/Discovery Endpoint الذي يقدمه الخادم
  2. إذا كان متاحًا OpenAPI/API metadata يقرأه
  3. إذا أعاد الخادم معلومات Endpoints في /config يستخدمها التطبيق
- لا يخمّن أو يستدعي عناوين عشوائية
- يتحقق من أن الـEndpoints المكتشفة تعمل وتعيد schema متوافقًا قبل اعتماد Server Profile
- يحفظ الـEndpoints المكتشفة كـ Server Profile

**مثال على API Contract الذي يعيده الخادم:**
- orders: /functions/v1/mobile-topup/orders
- receive: /functions/v1/mobile-topup/orders/{id}/receive
- verify: /functions/v1/mobile-topup/orders/{id}/verify
- confirm: /functions/v1/mobile-topup/orders/{id}/confirm
- reject: /functions/v1/mobile-topup/orders/{id}/reject
- duplicate: /functions/v1/mobile-topup/orders/{id}/duplicate
- config: /functions/v1/mobile-topup/config
- realtime/sync: حسب ما يعيده الخادم

التطبيق يتعرف على هذه المسارات ويحفظها، ولا يفترض شكلها مسبقًا.

---

### 5.3 Order Normalizer

- يحول البيانات القادمة من أي Backend متوافق إلى نموذج داخلي موحد
- يحتفظ بالـ Raw Payload كاملًا
- النموذج الداخلي يدعم على الأقل:
  - order_id، customer/user، payment_method، provider، amount
  - sender_phone، receiver_phone، sender_name
  - transaction_id، transaction_reference
  - order_created_at، message_received_at
  - service/type، raw_order، raw_sms، status
- إذا كانت بعض الحقول غير موجودة في الطلب (مثل transaction_id أو transaction_reference أو message_received_at)، لا يعتبرها خطأ تلقائيًا؛ يستكملها من رسالة SMS بعد العثور على المعاملة، ثم يرسل البيانات المكتملة إلى الخادم وفق الـAPI Contract

---

### 5.4 Provider Architecture

- مستقل تمامًا عن Backend Connector
- Abstraction موحد مع implementations مستقلة لكل Provider
- كل Provider يملك: name، service type، receiving account، approved sender identifiers، parser مستقل، validation rules، message signatures، enabled status
- لا يُستخدم Parser واحد لجميع Providers
- لا تُقبل SMS غير موثقة المصدر للتأكيد التلقائي
- إضافة Providers جديدة لا تتطلب تغيير نظام الاتصال بالخادم

---

### 5.5 Vodafone Cash Parser

مثال الرسالة:
```
تم استلام مبلغ 100 جنيه من رقم 01091216432 المسجل بإسم Mahmoud S Rouby على رقم محفظتك 01097273680. رصيدك الحالي: 84353.90 جنيه. تاريخ العملية: 22:28 26-08-26. رقم العملية: 023080824104
```

يستخرج: amount، currency=EGP، sender_phone، sender_name، recipient_phone، balance_after، transaction_time، transaction_date، transaction_id، raw_sms.

Parser مرن تجاه المسافات والأرقام العربية/الإنجليزية والفواصل واختلافات الصياغة، مع تحقق صارم للحقول الأساسية.

---

### 5.6 Orange Cash Parser

- Parser مستقل لـ Orange Cash
- يستخرج: amount، sender، recipient/account، transaction reference، date/time، balance عند وجوده، raw SMS
- لا يُعدَّل Vodafone parser للتعامل مع Orange
- يُبنى بناءً على الرسائل الحقيقية المتاحة في المشروع/البيئة

---

### 5.7 InstaPay Parser

- Parser مستقل لـ InstaPay
- لا يستخدم Regex Vodafone
- يستخرج: transaction/reference ID، amount، sender/account، destination، timestamp، raw SMS، identifiers بنكية متاحة
- قابل لإضافة templates جديدة

---

### 5.8 Incoming Order Contract

حقول الطلب الأساسية: order_id، amount، sender_phone، sender_name (اختياري)، recipient_phone، payment_method/provider، created_at، expires_at أو سياسة الانتهاء، metadata.

transaction_id ليس مطلوبًا في الطلب؛ مصدره SMS.

---

### 5.9 Request Filtering

- سحب طلبات الدفع/الشحن المخصصة للـ Agent فقط
- استبعاد Regular Orders وGemini/service orders وأي نوع آخر
- استخدام discriminator/type/status الموجود فعليًا في الخادم

---

### 5.10 Order State Machine

```
NEW → QUEUED → SCANNING → MATCHED → VERIFYING → CONFIRMED
NEW → QUEUED → SCANNING → NOT_FOUND/WAITING → إعادة الفحص → EXPIRED
NEW → QUEUED → SCANNING → REVIEW_REQUIRED
NEW → QUEUED → SCANNING → REJECTED
```

إذا كانت سياسة الخادم تتطلب إبقاء الطلب Pending بدلًا من REJECTED، يُتبع ذلك.

---

### 5.11 Verification متعدد المراحل

لا يتم Confirm إلا بعد نجاح جميع المراحل التالية:
Order Received → Message Search → Message Matched → Provider Verified → Amount Verified → Sender Verified → Receiver Verified → Transaction ID Verified → Timestamp Verified → Duplicate Check → Verification Complete → Confirm/Reject → Sync Complete

---

### 5.12 Automatic Verification

- يبدأ Scan تلقائيًا عند وصول الطلب
- المطابقة وفق: Provider، amount، sender_phone، recipient_phone، sender_name، source signature، transaction date/time
- لا تعتمد على amount وحده أو sender_phone وحده

---

### 5.13 Time Window

- نافذة البحث لا تتجاوز 24 ساعة من timestamp الطلب وفق سياسة الخادم
- Offline لا يبدأ نافذة جديدة ولا يلغي الطلب
- إذا أُنشئ الطلب أثناء Offline لا يُرفض لمجرد مرور أكثر من 24 ساعة قبل عودة الإنترنت؛ يتم تقييم الصلاحية اعتمادًا على وقت وصول الرسالة الفعلي المحفوظ محليًا ووقت إنشاء الطلب وفق قواعد الـVerification
- SMS التي تصل أثناء Offline تُسجَّل محليًا مع وقت الاستلام الفعلي وتُطابَق عند الاتصال

---

### 5.14 Match Scoring

ترتيب المرشحين عند وجود عدة SMS بنفس المبلغ:
1. Provider / source
2. recipient
3. sender phone
4. amount
5. timestamp
6. sender name
7. transaction ID validity

إذا لم يوجد تطابق واحد واضح → REVIEW_REQUIRED، لا تأكيد تلقائي.

---

### 5.15 Transaction Deduplication

- Composite Key: order_id + provider + transaction_id + amount + receiver
- قبل Confirm: تحقق Local DB ثم Server-side عند توفره
- لا تعتمد على transaction_id وحده إذا كان غير موثوق
- transaction_id واحد لا يرتبط بطلبين مؤكدين
- order_id واحد لا يؤكد مرتين
- Idempotency Key مناسبة لكل عملية Confirm
- الخادم هو المصدر النهائي لمنع التأكيد المكرر

---

### 5.16 Confirmation

عند المطابقة الناجحة يُرسَل إلى الخادم وفق الـAPI Contract:
- order_id، status = confirmed، transaction_id، matched_amount، sender_phone، sender_name، transaction_time، device_id، verification timestamp

إذا كانت أسماء الحقول مختلفة في implementation الخادم، تُستخدم كما هي.

---

### 5.17 Rejection

عند الرفض يُرسَل إلى الخادم:
- order_id، status = rejected، rejection_reason، device_id، verification timestamp

---

### 5.18 Realtime وPolling

- يدعم Realtime إذا كان الخادم يدعمه
- Fallback تلقائي إلى Polling عند عدم توفر Realtime
- عند عودة الإنترنت: Reconnect تلقائي → إعادة تشغيل Realtime → مزامنة Pending Queue

---

### 5.19 Automatic Retry

- Exponential backoff لإعادة المحاولة عند فشل الشبكة
- Idempotent requests لمنع duplicate confirmation عند تكرار Confirm بسبب timeout
- منع إرسال نفس العملية أكثر من مرة باستخدام idempotency keys

---

### 5.20 Offline-First Queue

Local DB تحفظ: pending orders، scan state، parsed messages، verification results، used transaction IDs، sync queue، structured logs، وقت استلام SMS الفعلي.

عند Match Offline: local verification → CONFIRMED_LOCAL/SYNC_PENDING → reconnect → server confirmation → SYNCED.

لا تُحذف الطلبات عند انقطاع الإنترنت.

---

### 5.21 Background Agent

- Foreground Service للمراقبة المستمرة
- WorkManager للمهام المؤجلة
- Network callbacks للمصالحة عند استعادة الاتصال
- Boot Receiver: عند تشغيل الهاتف يبدأ في الخلفية وفق قيود Android، يتحقق من الشبكة، يحاول الاتصال تلقائيًا، يعيد تشغيل Realtime، يزامن Pending Queue، يواصل مراقبة SMS
- Notification Channel لخدمة Agent
- التعامل مع Doze وBattery/OEM restrictions
- منع duplicate workers
- retry آمن عند فشل الشبكة

---

### 5.22 SMS Listener

- استقبال حدث SMS الجديدة بدل إعادة قراءة كل الرسائل
- تحديد Provider/source ثم Parse ثم تخزين ParsedMessage مع وقت الاستلام الفعلي ثم مطابقة مع الطلبات النشطة
- طلب صلاحية READ_SMS وRECEIVE_SMS بوضوح من المستخدم
- قراءة رسائل Vodafone Cash وOrange Cash وInstaPay فقط
- لا تُخزَّن رسائل غير مرتبطة

---

### 5.23 Device Registration

- بعد نجاح API Discovery: اختبر الاتصال، سجّل الجهاز، احصل على device_id/token، خزّن credentials بأمان في local storage
- لا تعرض credentials في UI أو logs
- لا تنشئ نظام صلاحيات موازٍ إذا كان الخادم لديه device authorization قائم

---

### 5.24 Notifications

| الحدث | الرسالة |
|---|---|
| New order | طلب شحن جديد يحتاج للفحص |
| SMS found | تم العثور على معاملة مطابقة |
| Confirmed | تم تأكيد الطلب |
| Review | طلب يحتاج مراجعة يدوية |
| Rejected | تم رفض الطلب |
| Duplicate | تم رصد معاملة مكررة |
| Offline | تم فقد الاتصال — الطلبات محفوظة وسيتم استكمالها تلقائيًا |
| Online | تم استعادة الاتصال ومزامنة الطلبات |

---

### 5.25 Logging

Structured logs تحتوي: timestamp، order_id، provider، action، result، masked transaction_id، error_code، HTTP status، endpoint، method، request ID إن وجد.

ممنوع تسجيل: API keys، Anon Key، passwords، secrets، authorization headers، raw credentials، raw SMS.

---

### 5.26 Local Persistence

يُخزَّن محليًا: settings، server profiles، device state، processing locks، processed order IDs، transaction IDs المستخدمة، pending orders، scan state، parsed messages، verification results، sync queue، structured logs، وقت استلام SMS الفعلي.

لا تُخزَّن SMS كاملة بلا ضرورة.

---

## 6. متطلبات الأمان

- لا توضع Service Role Key أو database password أو private backend secret في التطبيق أو APK أو repository
- أي authorization حساس يتحقق server-side في الخادم
- لا يُثق في device_id المرسل من التطبيق وحده
- Secure local storage للـ credentials
- HTTPS/TLS إلزامي
- Logs آمنة لا تظهر credentials أو SMS حساسة
- API Key/Token يُستخدم فقط وفق التصميم الحالي للخادم
- Minimal SMS handling: لا تُرفع SMS غير الضرورية
- API Discovery آمن: لا تخمين أو استدعاء عشوائي لعناوين كثيرة

---

## 7. الحالات الاستثنائية والحدود

| الحالة | السلوك المتوقع |
|---|---|
| اتصال أول مرة | Discovery → Validate → Register → Start |
| API Key خاطئ | عرض خطأ 401 مع التفاصيل في Diagnostics |
| Backend غير متاح | عرض آخر خطأ في Home وإعادة المحاولة بـ exponential backoff |
| Backend يعيد 400/401/403/404/409/500 | عرض HTTP status وendpoint وmethod وresponse body وrequest ID في Diagnostics |
| Internet disconnected | حفظ الحالة محليًا وإعادة المحاولة تلقائيًا عند الاتصال |
| Internet returns | Reconnect → Realtime → Sync Pending Queue |
| App restarted | استئناف المعالجة من الحالة المحفوظة |
| Device restarted | Boot Receiver يبدأ Agent في الخلفية |
| New order عبر Realtime | معالجة فورية |
| Realtime غير متاح | Fallback تلقائي إلى Polling |
| Order موجود أثناء Offline | حفظ محلي ومعالجة عند الاتصال |
| SMS تصل أثناء Offline | تسجيل محلي مع وقت الاستلام الفعلي ومطابقة عند الاتصال |
| SMS تصل قبل وصول الطلب | تخزين SMS محليًا ومطابقتها عند وصول الطلب |
| Order يصل قبل SMS | الانتظار ضمن نافذة الوقت |
| Missing transaction_id في الطلب | استكماله من SMS بعد العثور على المعاملة |
| Duplicate transaction | رفض مع سبب واضح |
| Same order received multiple times | Idempotent processing |
| Confirm يتكرر بسبب network timeout | Idempotent request بـ order_id + transaction_id |
| SMS permission مرفوضة | عرض رسالة واضحة وإيقاف المسح |
| جهاز غير مسجّل | رفض المعالجة مع رسالة توضيحية |
| تطابق مبلغ فقط مع توفر sender_phone | عدم التأكيد |
| نتائج متعددة غير قابلة للحسم | REVIEW_REQUIRED |
| Regular Order يدخل queue | استبعاده فورًا عبر discriminator |
| Gemini/service order | استبعاده فورًا |
| SMS من Provider غير مطابق | لا تؤكد الطلب |
| SMS غير موثقة المصدر | لا تستخدم للتأكيد التلقائي |
| duplicate worker | منع تشغيل worker ثانٍ |
| app restart أثناء SCANNING | استئناف المعالجة من الحالة المحفوظة |
| أكثر من Server Profile | التبديل بينها دون إعادة بناء التطبيق |
| Discovery Endpoint غير متاح | عرض خطأ واضح وعدم اعتماد Profile |

---

## 8. مراحل التنفيذ

### المرحلة الأولى (Phase 1) — البنية الأساسية

- Backend Connector المستقل وAPI Discovery
- Order Normalizer
- Server Profiles (إضافة، تعديل، تبديل، حذف)
- Provider Architecture (Vodafone Cash، Orange Cash، InstaPay)
- SMS Parsing (parsers مستقلة لكل Provider)
- Message Source Verification
- Verification Engine متعدد المراحل
- Transaction Deduplication (Local + Server-side)
- Local Queue وOffline-First مع حفظ وقت SMS الفعلي
- Orders UI وOrder Details وTimeline

بعد اكتمال المرحلة الأولى: typecheck، lint، build، parser tests، verification tests، local queue tests، discovery tests.

### المرحلة الثانية (Phase 2) — الخدمات والواجهة

- Background Agent (Foreground Service، WorkManager، Boot Receiver)
- Realtime مع Fallback إلى Polling
- Auto Sync وOffline Recovery وAuto Reconnect
- Automatic Retry مع exponential backoff
- Notifications
- Payment Sources UI
- Server Profiles UI
- Dashboard احترافي
- Settings وDiagnostics المحدّث
- End-to-End Testing

بعد اكتمال المرحلة الثانية: typecheck، lint، build، integration tests، Android build.

---

## 9. الاختبارات المطلوبة

### اختبارات الاتصال والاكتشاف

- اتصال أول مرة ناجح
- API Key خاطئ (401)
- Backend غير متاح
- Discovery Endpoint غير متاح
- Backend يعيد 400/403/404/409/500
- أكثر من Server Profile والتبديل بينها

### اختبارات Parser والتحقق

**Vodafone Cash:** valid، amount mismatch، sender mismatch، recipient mismatch، duplicate transaction، old SMS، unverified source، same amount multiple SMS، name variation.

**Orange Cash:** valid، incomplete، duplicate reference، wrong amount.

**InstaPay:** valid، look-alike message، duplicate reference.

**Provider isolation:** SMS من Provider آخر لا تؤكد الطلب.

### اختبارات Reliability

- Device registration وTest Connection
- Shipping Order appearance وNotification
- Auto scan وSMS match وtransaction extraction
- Confirm وServer update
- Offline قبل/بعد الطلب، SMS أثناء Offline، reconnect، automatic sync
- SMS تصل قبل وصول الطلب
- Order يصل قبل SMS
- Missing transaction_id في الطلب ثم استكماله من SMS
- App close، reboot، عدة طلبات
- Duplicate order / SMS / transaction
- Confirm يتكرر بسبب network timeout
- Realtime unavailable والانتقال إلى polling
- استبعاد Regular Orders وGemini/service orders

---

## 10. التوثيق المطلوب

إنشاء/تحديث ملف `NADERPAY_AGENT_ARCHITECTURE.md` ليعكس implementation الفعلي فقط، يشمل:
- Architecture وGeneric Backend Connector
- API Discovery وServer Profiles
- Device registration وpolling/realtime
- Request filtering وOrder contract
- Order Normalizer والنموذج الداخلي الموحد
- Provider architecture وparsers
- Verification rules متعددة المراحل و24h time window
- Transaction uniqueness وidempotency
- Offline queue وbackground agent
- Notifications وdiagnostics
- Testing وdeployment

ممنوع توثيق Payment Gateway أو Webhook architecture.

---

## 11. معايير القبول

1. يفتح المستخدم التطبيق ويضغط على إضافة Server Profile جديد
2. يدخل Base URL وAPI Key/Token ونوع المصادقة ويضغط Connect
3. التطبيق يكتشف API Contract تلقائيًا ويتحقق من صحة الـEndpoints ويحفظ Profile
4. يسجّل الجهاز ويبدأ Realtime أو Polling
5. تظهر في Dashboard حالة Agent والإنترنت والخادم وRealtime وإحصائيات الطلبات
6. يضغط Update Now فيسحب التطبيق الطلبات من الخادم وتظهر في Orders بحالة NEW
7. ينتقل الطلب إلى SCANNING ويبدأ التطبيق قراءة SMS تلقائيًا
8. يحدد التطبيق Provider ويستخرج Parser المخصص بيانات التحويل بشكل صحيح
9. Order Normalizer يحول البيانات إلى النموذج الداخلي الموحد مع الاحتفاظ بـ Raw Payload
10. عند اكتمال جميع مراحل التحقق: ينتقل الطلب إلى MATCHED ثم VERIFYING ثم CONFIRMED ويُرسَل تأكيد إلى الخادم
11. الخادم يحدّث حالة الطلب
12. عند غموض النتائج: ينتقل الطلب إلى REVIEW_REQUIRED
13. عند عدم التطابق: يُرسَل رفض إلى الخادم مع rejection_reason
14. إعادة نفس Confirmation لا تؤدي إلى double confirmation
15. نفس transaction_id لا يؤكد طلبًا ثانيًا
16. Regular Orders وGemini/service orders لا تظهر في شاشة Orders
17. عند انقطاع الشبكة: تُحفظ الحالة محليًا ويُعاد المحاولة تلقائيًا عند الاتصال
18. SMS من Provider غير مطابق لا تؤكد الطلب
19. Provider Test Mode يعرض نتائج التحليل دون إرسال أي بيانات إلى الخادم
20. يمكن إضافة Server Profile ثانٍ والتبديل بينهما دون إعادة بناء التطبيق
21. عند تشغيل الجهاز يبدأ Agent تلقائيًا في الخلفية ويستأنف المراقبة
22. Diagnostics يعرض HTTP status وendpoint وmethod وresponse body وrequest ID وauthentication state وRetry count
23. لا يوجد في التطبيق أي شاشة أو منطق خاص بـ Payment Gateway أو Webhook أو Hardcoded Endpoint

---

## 12. الوظائف غير المشمولة في هذه المرحلة

- إنشاء طلبات الدفع/الشحن من داخل التطبيق
- Payment Gateway أو Payment Request creation
- Webhook dispatcher أو Webhook Secret
- Merchant API
- إدارة المستخدمين أو الحسابات
- Dashboard إحصائي متقدم
- دعم Bank Transfer (Architecture جاهزة للإضافة لاحقًا)
- iOS build
- SDKs رسمية
- Auto-generation لـ API Contract من جانب التطبيق (التطبيق يقرأ فقط ما يقدمه الخادم)