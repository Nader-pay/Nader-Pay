# وثيقة المتطلبات

## 1. نظرة عامة على التطبيق

**اسم التطبيق:** Nader Pay Agent

**وصف التطبيق:** وكيل التحقق الآلي للمدفوعات — تطبيق Android عام لمراقبة وتحقق التحويلات المالية عبر SMS. يعمل كـ Generic Payment Verification Agent قابل للربط بأي Backend متوافق يوفر API Contract محددًا. يستلم طلبات الشحن من الخادم، يقرأ رسائل SMS محليًا، يحلل التحويلات عبر Parsers مستقلة لكل Provider، يطابق البيانات مع الطلبات، يمنع التكرار، ثم يرسل نتيجة التحقق إلى الخادم. يدعم عدة Server Profiles مع إمكانية التبديل بينها دون إعادة بناء التطبيق.

**قاعدة التنفيذ:** تطوير فوق النسخة الحالية فقط. لا إعادة بناء من الصفر. إعادة استخدام Backend Connector وVerification Engine وLocal Queue وSMS Reader وProviders وBackground Services وNotifications وPermissions وRealtime/Polling الموجودة.

**المعمارية الثابتة:**
- Nader AI = مصدر طلبات الشحن
- Nader Pay Agent = Android Verification Agent
- الربط = Nader AI Supabase URL + Anon Key + Device Registration/Device ID
- ممنوع: Payment Gateway، Payment API، Webhook architecture جديدة، Nader Pay API Key، Webhook Secret

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
- docs/prd.md

---

## 2. المستخدمون وسيناريوهات الاستخدام

**المستخدم المستهدف:** مشغّل الجهاز الذي يثبّت التطبيق ويربطه بـ Nader AI Backend لمراقبة تحويلات Vodafone Cash وOrange Cash وInstaPay.

**السيناريو الكامل:**
1. المستخدم يدخل Base URL وAPI Key/Token ونوع المصادقة
2. التطبيق يكتشف API Contract تلقائيًا ويتحقق من صحة الـEndpoints ويحفظ Server Profile
3. يسجّل الجهاز ويبدأ Realtime أو Polling
4. الخادم ينشئ طلبًا بحالة Pending
5. Agent يسحب الطلب → NEW → QUEUED
6. يبدأ Scan تلقائيًا → SCANNING
7. يحدد Provider من رسائل SMS الواردة
8. Parser المخصص يستخرج بيانات التحويل
9. Order Normalizer يحول البيانات إلى نموذج داخلي موحد
10. Matching Engine يطابق البيانات مع الطلب عبر مراحل التحقق المتعددة
11. يتحقق من عدم التكرار محليًا وعلى الخادم
12. عند تطابق ناجح: MATCHED → VERIFYING → CONFIRMED → Sync إلى الخادم
13. عند غموض: REVIEW_REQUIRED
14. عند عدم التطابق أو انتهاء الصلاحية: REJECTED / EXPIRED

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
Nader Pay Agent
├── الرئيسية / Dashboard (Home)
├── الطلبات (Orders)
│   └── تفاصيل الطلب (Order Details)
├── مصادر الدفع (Payment Sources)
├── ملفات الخادم (Server Profiles)
└── الإعدادات (Settings)
    └── التشخيص (Diagnostics)
```

---

### 4.2 شاشة الرئيسية / Dashboard (Home)

**الهوية:** Header/Card علوي يحتوي:
- الاسم: Nader Pay Agent
- الوصف: وكيل التحقق الآلي للمدفوعات
- حالة Agent (نشط / متوقف) — مشتقة من حالة فعلية
- زر Notifications واضح مع Badge لعدد التنبيهات غير المقروءة

**المعلومات المعروضة (حالات حقيقية فقط — لا Status زائف):**
- حالة الإنترنت
- حالة الاتصال بالخادم النشط (Backend Status)
- حالة Realtime (نشط / Polling / غير متاح)
- حالة SMS Permission
- حالة تسجيل الجهاز
- آخر مزامنة (Last Sync) — لا يتغير إلا بعد Sync فعلي
- آخر تحقق (Last Verification)
- آخر خطأ (Last Error)
- إحصائيات الطلبات: معلّق، جاري الفحص، مؤكد، مرفوض، مكرر، يحتاج مراجعة، Offline Queue

**الأزرار:**
- Update Now: مزامنة فورية
- Test Connection: اختبار الاتصال بالخادم النشط

**التصميم:** Minimal — مساحات بيضاء كافية، تسلسل هرمي واضح، بدون ظلال أو ألوان زخرفية. الواجهة Provider-independent وليست Vodafone Cash فقط.

---

### 4.3 شاشة الطلبات (Orders)

**الغرض:** عرض طلبات الشحن التي يعالجها الـ Agent فقط.

**Filters:**
الكل — جاري الفحص — مؤكد — مرفوض — مكرر — يحتاج مراجعة — Offline/Pending Sync

**Provider Filter:** Vodafone Cash، Orange Cash، InstaPay وأي Provider يرسله الخادم

**Search:** Order ID، رقم المرسل، رقم العملية

**Sort:** الأحدث / الأقدم

**Refresh:** يدوي وتلقائي

**بيانات كل Card:**
- order_id، amount، sender_phone، sender_name (إن وُجد)، Provider، status، وقت الطلب، آخر فحص

**القيود:**
- لا تعرض Regular Orders أو Gemini/service orders
- استخدم discriminator الفعلي الموجود في الخادم للتمييز

---

### 4.4 شاشة تفاصيل الطلب (Order Details)

**البيانات المعروضة:**
- Original Order Data (Raw Order محفوظ من الخادم) منفصلة عن Verified fields
- Verified Payment Data: order_id، customer/user، payment_method، provider، amount، sender_phone، receiver_phone، sender_name، transaction_id، transaction_reference، order_created_at، message_received_at، service/type
- Comparison Checks: نتيجة كل خطوة من خطوات التحقق
- rejection_reason أو duplicate_reason عند الانطباق
- Raw SMS كـEvidence مرتبطة بالـParsed Fields (بدون تعديل)
- سجل زمني (Timeline) لكل الأحداث

**Timeline متعدد المراحل:**
Order Received → Message Search → Message Matched → Provider Verified → Amount Verified → Sender Verified → Receiver Verified → Transaction ID Verified → Timestamp Verified → Duplicate Check → Verification Complete → Confirm/Reject → Sync Complete

يعرض لكل خطوة: timestamp والنتيجة والتفاصيل ذات الصلة.

---

### 4.5 شاشة مصادر الدفع (Payment Sources)

**الغرض:** إدارة Providers وإعداداتهم وحالة توثيق مصادر الرسائل.

**Providers المدعومة:** Vodafone Cash، Orange Cash، InstaPay (Architecture قابلة للإضافة)

**لكل Provider:**
- enabled / disabled
- Source/Package/Sender Identifier المتاح تقنيًا
- Verification Status
- Last Detected Message
- Message Format/Version
- عدد الرسائل المقروءة والمطابقة والمرفوضة
- receiving account / wallet
- approved sender/origin identifiers
- message patterns / verification status

**Provider Test Mode:** يعرض Detected Provider، Parsed Amount، Sender، Recipient، Transaction ID، Date، Time، Balance، Confidence، Validation Errors — دون إرسال أي بيانات إلى الخادم.

**قاعدة المصدر:** لا تثق برسالة لمجرد وجود كلمات مثل «تم استلام» أو «تم إضافة مبلغ». إذا كان المصدر غير موثق أو الرسالة لا تطابق قواعد Provider، تُعتبر Untrusted ولا تدخل في التحقق المالي.

**Learning / Source Verification Mode:** للمسؤول فقط — تحديد رسالة حقيقية واستخراج قواعد غير حساسة للمصدر.

---

### 4.6 شاشة ملفات الخادم (Server Profiles)

**الغرض:** إدارة عدة Backend Profiles مع إمكانية التبديل بينها.

**لكل Profile:**
- اسم Profile
- Base URL
- API Key/Token
- نوع المصادقة
- حالة الاتصال
- آخر مزامنة ناجحة
- Endpoints المكتشفة (للعرض فقط في قسم Advanced)

**الأزرار لكل Profile:** Connect / Test Connection، Auto Discovery، تعيين كـ Active Profile، حذف Profile

**إضافة Profile جديد:**
- إدخال Base URL وبيانات المصادقة
- الضغط على Connect يبدأ: Authenticate → Discover Config → Validate API Contract → Register Device → Start Realtime أو Polling → Fetch Pending Orders → Start Sync Engine

**ممنوع إضافة:** Service Role Key، Webhook Secret، Database Password، Telegram Token، Nader Pay API Key.

---

### 4.7 شاشة الإعدادات (Settings)

**أقسام الإعدادات:**

1. **الاتصال بالخادم:** Active Server Profile مع رابط لشاشة Server Profiles
2. **مصادر الرسائل الموثقة:** Providers وحالة التوثيق
3. **Providers:** إعدادات كل Provider
4. **SMS:** حالة الصلاحية، طلب الصلاحية
5. **الخدمة الخلفية:** حالة الخدمة، إعدادات التشغيل
6. **الإشعارات:** تفعيل/تعطيل أنواع الإشعارات
7. **المزامنة:** إعدادات Sync وOffline Queue
8. **Battery Optimization:** توجيهات استثناء التطبيق
9. **الأمان:** لا تعرض أسرار API أو Tokens كاملة
10. **التشخيص (Diagnostics):**

**قسم التشخيص يعرض:**
- Device Model، Android Version، App Version
- Device ID (بشكل آمن)
- Backend / Server URL (مختصر)
- Connection: HTTP status، endpoint، method، response body، request ID، authentication state، last successful connection، last successful sync
- Realtime: حالة Realtime، retry count
- SMS Permission، Notification Permission
- Background Agent، Battery Optimization
- Database، Sync Queue، Active Orders، Pending Orders
- Last SMS، Last Scan، Last Sync، Last Error
- Provider Parser status، Pending Sync Queue
- Message Source Verification status

**الحالات:** جاهز / غير جاهز / يحتاج مراجعة — الضغط على أي عنصر يعرض السبب وطريقة الحل.

**أزرار التشخيص:**
- Test Connection
- Test SMS Parser
- Test Background Agent
- Run Sync
- Refresh Orders

**الأزرار العامة:** حفظ الإعدادات، Test Connection

---

## 5. منطق الأعمال والقواعد

### 5.1 Backend Connector (محافظ عليه)

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

**مثال على API Contract:**
- orders: /functions/v1/mobile-topup/orders
- receive: /functions/v1/mobile-topup/orders/{id}/receive
- verify: /functions/v1/mobile-topup/orders/{id}/verify
- confirm: /functions/v1/mobile-topup/orders/{id}/confirm
- reject: /functions/v1/mobile-topup/orders/{id}/reject
- duplicate: /functions/v1/mobile-topup/orders/{id}/duplicate
- config: /functions/v1/mobile-topup/config
- realtime/sync: حسب ما يعيده الخادم

---

### 5.3 نظام الإشعارات الموحد

**الإشعارات المطلوبة:**

| الحدث | الرسالة |
|---|---|
| New order | طلب شحن جديد يحتاج للفحص |
| Scan started | بدأ فحص الطلب |
| SMS found | تم العثور على معاملة مطابقة |
| Confirmed | تم تأكيد الطلب |
| Review | طلب يحتاج مراجعة يدوية |
| Rejected | تم رفض الطلب + السبب |
| Duplicate | تم رصد معاملة مكررة |
| Offline | تم فقد الاتصال — الطلبات محفوظة وسيتم استكمالها تلقائيًا |
| Online | تم استعادة الاتصال ومزامنة الطلبات |
| Sync error | مشكلة في المزامنة |

**قواعد الإشعارات:**
- إشعارات داخل التطبيق وAndroid
- تعمل في الخلفية باستخدام الآليات الموجودة
- منع تكرار نفس الإشعار باستخدام event/idempotency ID
- ممنوع عرض API keys أو Anon Key أو tokens أو credentials أو بيانات حساسة

---

### 5.4 Order Normalizer

- يحول البيانات القادمة من أي Backend متوافق إلى نموذج داخلي موحد
- يحتفظ بالـ Raw Payload كاملًا
- النموذج الداخلي: order_id، customer/user، payment_method، provider، amount، sender_phone، receiver_phone، sender_name، transaction_id، transaction_reference، order_created_at، message_received_at، service/type، raw_order، raw_sms، status
- إذا كانت بعض الحقول غير موجودة في الطلب (مثل transaction_id أو transaction_reference أو message_received_at)، لا يعتبرها خطأ تلقائيًا؛ يستكملها من رسالة SMS بعد العثور على المعاملة

---

### 5.5 Provider Architecture (محافظ عليها)

- مستقل تمامًا عن Backend Connector
- Abstraction موحد مع implementations مستقلة لكل Provider
- كل Provider يملك: name، service type، receiving account، approved sender identifiers، parser مستقل، validation rules، message signatures، enabled status
- لا يُستخدم Parser واحد لجميع Providers
- لا تُقبل SMS غير موثقة المصدر للتأكيد التلقائي
- إضافة Providers جديدة لا تتطلب تغيير نظام الاتصال بالخادم
- Core Verification Engine لا يعتمد على Provider واحد

---

### 5.6 Vodafone Cash Parser

مثال الرسالة:
```
تم استلام مبلغ 100 جنيه من رقم 01091216432 المسجل بإسم Mahmoud S Rouby على رقم محفظتك 01097273680. رصيدك الحالي: 84353.90 جنيه. تاريخ العملية: 22:28 26-08-26. رقم العملية: 023080824104
```

يستخرج: amount، currency=EGP، sender_phone، sender_name، recipient_phone، balance_after، transaction_time، transaction_date، transaction_id، raw_sms.

Parser مرن تجاه المسافات والأرقام العربية/الإنجليزية والفواصل واختلافات الصياغة، مع تحقق صارم للحقول الأساسية.

---

### 5.7 Orange Cash Parser

- Parser مستقل لـ Orange Cash
- يستخرج: amount، sender، recipient/account، transaction reference، date/time، balance عند وجوده، raw SMS
- لا يُعدَّل Vodafone parser للتعامل مع Orange
- يُبنى بناءً على الرسائل الحقيقية المتاحة في المشروع/البيئة

---

### 5.8 InstaPay Parser

- Parser مستقل لـ InstaPay
- لا يستخدم Regex Vodafone
- يستخرج: transaction/reference ID، amount، sender/account، destination، timestamp، raw SMS، identifiers بنكية متاحة
- قابل لإضافة templates جديدة

---

### 5.9 SMS Reader وLocal Transaction Ledger

**مسار معالجة SMS:**
Capture locally → حفظ Raw SMS كما وصلت → timestamp الحقيقي → Provider Detection → Source Validation → Provider Parser → Validation → Local Ledger → Matching

**Local Transaction Ledger (تطوير الموجود):**
- Raw SMS، Provider، Source، Received At، Parsed Amount، Sender، Receiver، Transaction ID، Transaction Reference، Parsing Status، Verification Status، Matched Order ID، Duplicate Status
- يُستخدم للعمل Offline ومنع إعادة استخدام المعاملات
- لا تُخزَّن رسائل غير مرتبطة
- لا تعتمد على Raw SMS وحدها لإثبات الدفع
- لا ترفع كل رسائل الهاتف للخادم

**SMS Listener:**
- استقبال حدث SMS الجديدة بدل إعادة قراءة كل الرسائل
- طلب صلاحية READ_SMS وRECEIVE_SMS بوضوح من المستخدم
- قراءة رسائل Vodafone Cash وOrange Cash وInstaPay فقط

---

### 5.10 Order ↔ SMS Matching

- عند وصول Order ابحث أولًا في Local Transaction Ledger
- إذا لم توجد رسالة مناسبة، انتظر واستمر في الفحص ضمن نافذة الوقت
- إذا وجدت Match، اربطها بالطلب واستكمل الحقول الناقصة
- احتفظ بـOriginal Order fields منفصلة عن Verified fields
- أرسل النتيجة عبر Backend Connector الحالي

**Match Scoring عند وجود عدة SMS بنفس المبلغ:**
1. Provider / source
2. recipient
3. sender phone
4. amount
5. timestamp
6. sender name
7. transaction ID validity

إذا لم يوجد تطابق واحد واضح → REVIEW_REQUIRED، لا تأكيد تلقائي.

---

### 5.11 Verification Pipeline (محافظ عليه)

```
RECEIVED → SCANNING → MESSAGE_FOUND → SOURCE_VERIFIED → PROVIDER_VERIFIED
→ AMOUNT_VERIFIED → SENDER_VERIFIED → RECEIVER_VERIFIED → TRANSACTION_VERIFIED
→ DUPLICATE_CHECK → VERIFIED → CONFIRMED
```

بدائل: REJECTED، DUPLICATE، NEEDS_REVIEW

لا يتم Confirm قبل اكتمال جميع Required Checks. لا تغيّر Verification Engine المستقر إلا عند وجود خطأ فعلي.

**Anti-Fraud / Anti-Replay:**
- Required checks: Provider، Receiver، Amount، Sender عند توفره، Transaction ID/Reference، Timestamp، Source، Duplicate Status
- Backend هو المصدر النهائي للتأكيد
- نفس transaction_id لا يستخدم لأكثر من Order
- نفس Order لا يؤكد مرتين
- Idempotency Keys لكل عملية Confirm

---

### 5.12 Order State Machine

```
NEW → QUEUED → SCANNING → MATCHED → VERIFYING → CONFIRMED
NEW → QUEUED → SCANNING → NOT_FOUND/WAITING → إعادة الفحص → EXPIRED
NEW → QUEUED → SCANNING → REVIEW_REQUIRED
NEW → QUEUED → SCANNING → REJECTED
```

---

### 5.13 Request Filtering

- سحب طلبات الشحن المخصصة للـ Agent فقط
- استبعاد Regular Orders وGemini/service orders وأي نوع آخر
- استخدام discriminator/type/status الموجود فعليًا في الخادم

---

### 5.14 Incoming Order Contract

حقول الطلب الأساسية: order_id، amount، sender_phone، sender_name (اختياري)، recipient_phone، payment_method/provider، created_at، expires_at أو سياسة الانتهاء، metadata.

transaction_id ليس مطلوبًا في الطلب؛ مصدره SMS.

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

### 5.16 Confirmation والرفض

**عند المطابقة الناجحة يُرسَل إلى الخادم:**
order_id، status = confirmed، transaction_id، matched_amount، sender_phone، sender_name، transaction_time، device_id، verification timestamp

**عند الرفض يُرسَل إلى الخادم:**
order_id، status = rejected، rejection_reason، device_id، verification timestamp

---

### 5.17 Live Synchronization

- Realtime كقناة أساسية إذا كان Backend Connector يدعمه
- Polling كـfallback عند عدم توفر Realtime أو فقد الاتصال
- لا تستخدم Polling ثابتًا إذا كان Realtime يعمل بشكل صحيح

**مسار عودة الاتصال:**
Reconnect → تحقق Device Registration → Fetch Pending Orders → Reconcile Local Queue → Match Local Transactions → Sync Results → تحديث Last Sync

---

### 5.18 Time Window

- نافذة البحث لا تتجاوز 24 ساعة من timestamp الطلب وفق سياسة الخادم
- Offline لا يبدأ نافذة جديدة ولا يلغي الطلب
- إذا أُنشئ الطلب أثناء Offline لا يُرفض لمجرد مرور أكثر من 24 ساعة قبل عودة الإنترنت؛ يتم تقييم الصلاحية اعتمادًا على وقت وصول الرسالة الفعلي المحفوظ محليًا ووقت إنشاء الطلب
- SMS التي تصل أثناء Offline تُسجَّل محليًا مع وقت الاستلام الفعلي وتُطابَق عند الاتصال

---

### 5.19 Offline-First Queue

Local DB تحفظ: pending orders، scan state، parsed messages، verification results، used transaction IDs، sync queue، structured logs، وقت استلام SMS الفعلي.

عند Match Offline: local verification → CONFIRMED_LOCAL/SYNC_PENDING → reconnect → server confirmation → SYNCED.

لا تُحذف الطلبات عند انقطاع الإنترنت.

**Reliability & Recovery:**
- Persist كل عملية مهمة قبل الانتقال للحالة التالية
- Crash أو process kill لا يفقد Orders أو Parsed SMS أو Verification Results أو Sync Queue أو Transaction IDs
- بعد Restart: استعد Local DB → Configuration → Device Registration → Pending Orders → Sync Queue → Agent
- لا تعيد Confirmation سابقة

---

### 5.20 Background Agent

- Foreground Service للمراقبة المستمرة
- WorkManager للمهام المؤجلة
- Network callbacks للمصالحة عند استعادة الاتصال
- Boot Receiver: عند تشغيل الهاتف يبدأ في الخلفية وفق قيود Android، يتحقق من الشبكة، يحاول الاتصال تلقائيًا، يعيد تشغيل Realtime، يزامن Pending Queue، يواصل مراقبة SMS
- Notification Channel لخدمة Agent
- التعامل مع Doze وBattery/OEM restrictions
- منع duplicate workers
- retry آمن عند فشل الشبكة

---

### 5.21 Automatic Retry

- Exponential backoff لإعادة المحاولة عند فشل الشبكة
- Idempotent requests لمنع duplicate confirmation عند تكرار Confirm بسبب timeout

---

### 5.22 Permissions / Onboarding

- اعرض: SMS Permission، Notification Permission، Background Execution، Battery Optimization، Internet وأي Permission ضروري فعليًا
- لا تطلب Permission غير ضروري
- عند الرفض: حالة واضحة + زر مباشر لإعداد Android
- لا تعتبر Agent جاهزًا إذا كانت صلاحية أساسية مفقودة

---

### 5.23 Device Registration

- بعد نجاح API Discovery: اختبر الاتصال، سجّل الجهاز، احصل على device_id/token، خزّن credentials بأمان في local storage
- لا تعرض credentials في UI أو logs
- لا تنشئ نظام صلاحيات موازٍ إذا كان الخادم لديه device authorization قائم

---

### 5.24 Activity / Diagnostics Log

**Structured logs تحتوي:**
timestamp، event، order_id، provider، action، result، masked transaction_id، Sync status، error_code، HTTP status، endpoint، method، request ID إن وجد

**أمثلة على الأحداث:**
Order received، SMS search started، Message found، Source verified، Amount matched، Transaction verified، Duplicate check passed، Order confirmed

**ممنوع تسجيل:** API keys، Anon Key، passwords، secrets، authorization headers، raw credentials، raw SMS

---

### 5.25 Local Persistence

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
- لا تعرض أسرار API أو Tokens كاملة في أي شاشة

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
| Connected يظهر بدون Sync فعلي | ممنوع — Status مشتق من حالة فعلية فقط |

---

## 8. خطة التنفيذ التدريجية

### المرحلة A — Audit + UI + Notifications + Orders + Live Diagnostics

**الخطوات:**
1. فحص الكود الحالي بالكامل: تحديد ما يعمل، ما يحتاج تحسينًا، ما هو ناقص
2. تحديث الهوية: Header/Card علوي بـ Nader Pay Agent + وصف + حالة Agent + Notifications Badge
3. توحيد نظام الإشعارات مع anti-duplication عبر event/idempotency ID
4. تحديث Orders UI: Filters + Provider Filter + Search + Sort + Refresh
5. Live Diagnostic Dashboard بحالات حقيقية فقط
6. إزالة أي Status زائف

**التحقق:** typecheck، lint، build، unit tests للمكونات المعدلة

---

### المرحلة B — Realtime + Polling Fallback + Source Verification + Local Ledger

**الخطوات:**
1. تطوير/تحسين Realtime كقناة أساسية مع Polling fallback
2. Offline recovery: Reconnect → Device Registration → Fetch Pending → Reconcile → Sync
3. تطوير Message Source Verification في Payment Sources
4. تطوير Local Transaction Ledger (تطوير الموجود لا إنشاء نظام مكرر)
5. ربط SMS Reader بـ Local Ledger

**التحقق:** integration tests، Offline/Online tests، Source Verification tests

---

### المرحلة C — Order Details + Timeline + Diagnostics + Recovery Validation

**الخطوات:**
1. تحديث Order Details: Original Data + Verified Data + Comparison + Timeline + Raw SMS
2. Activity/Diagnostics Log مع structured events
3. تحديث Diagnostics في Settings بجميع الحالات والأزرار
4. Recovery validation: اختبار Crash/Restart/Reboot
5. End-to-End testing
6. تحديث NADERPAY_AGENT_ARCHITECTURE.md وdocs/prd.md

**التحقق:** typecheck، lint، build، integration tests، Android build، Release APK/AAB

---

## 9. الاختبارات الإلزامية

### اختبارات الاتصال والاكتشاف
- اتصال أول مرة ناجح
- API Key خاطئ (401)
- Backend غير متاح
- Discovery Endpoint غير متاح
- Backend يعيد 400/403/404/409/500
- أكثر من Server Profile والتبديل بينها

### اختبارات السيناريوهات الأساسية
- **Online:** Order → SMS → Auto Verification → Confirmation → Sync
- **Offline:** Order → Disconnect → SMS → Local Match → Local Result → Reconnect → Sync
- **SMS before Order:** SMS محفوظة → Order لاحقًا → Match
- **Duplicate:** نفس transaction_id لطلبين → واحد فقط ينجح
- **Retry:** Local result → network failure → retry → Server result واحدة
- **Background:** التطبيق مغلق → Order/SMS → Agent يعالج
- **Permissions:** SMS denied → no false confirmation
- **Providers:** Vodafone/Orange/InstaPay valid/invalid
- **Time:** valid/expired مع timestamps صحيحة
- **Notifications:** event واحد لا يكرر الإشعار
- **Realtime:** event فوري عند توفره + polling fallback عند غيابه

### اختبارات Parser والتحقق

**Vodafone Cash:** valid، amount mismatch، sender mismatch، recipient mismatch، duplicate transaction، old SMS، unverified source، same amount multiple SMS، name variation.

**Orange Cash:** valid، incomplete، duplicate reference، wrong amount.

**InstaPay:** valid، look-alike message، duplicate reference.

**Provider isolation:** SMS من Provider آخر لا تؤكد الطلب.

---

## 10. التوثيق المطلوب

إنشاء/تحديث الملفات التالية لتعكس implementation الفعلي فقط:

**docs/prd.md** — وثيقة المتطلبات الكاملة

**NADERPAY_AGENT_ARCHITECTURE.md** يشمل:
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

1. يفتح المستخدم التطبيق ويرى Header واضح بـ Nader Pay Agent + وصف + حالة Agent + Notifications Badge
2. يضغط على إضافة Server Profile جديد، يدخل Base URL وAPI Key/Token ونوع المصادقة ويضغط Connect
3. التطبيق يكتشف API Contract تلقائيًا ويتحقق من صحة الـEndpoints ويحفظ Profile
4. يسجّل الجهاز ويبدأ Realtime أو Polling
5. تظهر في Dashboard حالات حقيقية: Agent، الإنترنت، الخادم، Realtime، إحصائيات الطلبات
6. يضغط Update Now فيسحب التطبيق الطلبات وتظهر في Orders بحالة NEW مع Filters وSearch وSort تعمل
7. ينتقل الطلب إلى SCANNING ويبدأ التطبيق قراءة SMS تلقائيًا
8. يحدد التطبيق Provider ويستخرج Parser المخصص بيانات التحويل بشكل صحيح
9. Order Normalizer يحول البيانات إلى النموذج الداخلي الموحد مع الاحتفاظ بـ Raw Payload
10. عند اكتمال جميع مراحل التحقق: ينتقل الطلب إلى CONFIRMED ويُرسَل تأكيد إلى الخادم
11. الخادم يحدّث حالة الطلب
12. عند غموض النتائج: ينتقل الطلب إلى REVIEW_REQUIRED
13. عند عدم التطابق: يُرسَل رفض إلى الخادم مع rejection_reason
14. إعادة نفس Confirmation لا تؤدي إلى double confirmation
15. نفس transaction_id لا يؤكد طلبًا ثانيًا
16. Regular Orders وGemini/service orders لا تظهر في شاشة Orders
17. عند انقطاع الشبكة: تُحفظ الحالة محليًا ويُعاد المحاولة تلقائيًا عند الاتصال
18. SMS من Provider غير مطابق لا تؤكد الطلب
19. SMS غير موثقة المصدر لا تدخل في التحقق المالي
20. Provider Test Mode يعرض نتائج التحليل دون إرسال أي بيانات إلى الخادم
21. يمكن إضافة Server Profile ثانٍ والتبديل بينهما دون إعادة بناء التطبيق
22. عند تشغيل الجهاز يبدأ Agent تلقائيًا في الخلفية ويستأنف المراقبة
23. Diagnostics يعرض HTTP status وendpoint وmethod وresponse body وrequest ID وauthentication state وRetry count وحالات حقيقية لجميع المكونات
24. Connected وAgent Running وDevice Registered وSynced مشتقة من حالات فعلية فقط
25. Last Sync لا يتغير إلا بعد Sync فعلي
26. لا يوجد في التطبيق أي شاشة أو منطق خاص بـ Payment Gateway أو Webhook أو Hardcoded Endpoint
27. Build + Runtime + End-to-End tests ناجحة أو تقرير واضح بالمشاكل

---

## 12. الوظائف غير المشمولة في هذه المرحلة

- إنشاء طلبات الشحن من داخل التطبيق
- Payment Gateway أو Payment Request creation
- Webhook dispatcher أو Webhook Secret
- Merchant API
- إدارة المستخدمين أو الحسابات
- Dashboard إحصائي متقدم
- دعم Bank Transfer (Architecture جاهزة للإضافة لاحقًا)
- iOS build
- SDKs رسمية
- Auto-generation لـ API Contract من جانب التطبيق