# وثيقة المتطلبات

## 1. نظرة عامة على التطبيق

**اسم التطبيق:** Nader Pay Agent

**وصف التطبيق:** وكيل التحقق الآلي للمدفوعات — تطبيق Android عام لمراقبة وتحقق التحويلات المالية عبر SMS. يعمل كـ Generic Payment Verification Agent قابل للربط بأي Backend متوافق يوفر API Contract محددًا. يستلم طلبات الشحن من الخادم، يقرأ رسائل SMS محليًا، يحلل التحويلات عبر Parsers مستقلة لكل Provider، يطابق البيانات مع الطلبات، يمنع التكرار، ثم يرسل نتيجة التحقق إلى الخادم. يدعم عدة Server Profiles مع إمكانية التبديل بينها دون إعادة بناء التطبيق.

**قاعدة التنفيذ:** تطوير فوق النسخة الحالية فقط. لا إعادة بناء من الصفر. إعادة استخدام Backend Connector وVerification Engine وLocal Queue وSMS Reader وProviders وBackground Services وNotifications وPermissions وRealtime/Polling الموجودة. الأنظمة المستقرة التالية لا تُعدَّل: Orders، Backend Connector، Realtime، Verification Engine، Notifications، Local Ledger، Offline Queue، API، Dashboard.

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
7. يحدد Provider من رسائل SMS الواردة من مصدر موثق فقط
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
- أي Provider يظهر حالة «مفعّل» أو «موثق» دون وجود verified=true + source config صحيحة + successful verification فعلية في قاعدة البيانات

**ممنوع حذف:** بيانات الإنتاج أو بيانات المستخدمين أو سجلات الخادم.

---

## 4. هيكل الشاشات والوظائف

### 4.1 خريطة الشاشات

```
Nader Pay Agent
├── الرئيسية / Dashboard (Home)
├── الطلبات (Orders)
│   └── تفاصيل الطلب (Order Details)
├── مصادر الدفع (Payment Sources)  ← التعديل الرئيسي
│   ├── قائمة Providers
│   ├── تفاصيل Provider
│   │   ├── اكتشاف المصادر (Source Discovery)
│   │   ├── اختيار المصدر (Source Selection)
│   │   └── توثيق المصدر (Source Verification)
│   └── Live Status لكل Provider
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

**التصميم:** Minimal — مساحات بيضاء كافية، تسلسل هرمي واضح، بدون ظلال أو ألوان زخرفية.

---

### 4.3 شاشة الطلبات (Orders)

**الغرض:** عرض طلبات الشحن التي يعالجها الـ Agent فقط.

**Filters:** الكل — جاري الفحص — مؤكد — مرفوض — مكرر — يحتاج مراجعة — Offline/Pending Sync

**Provider Filter:** Vodafone Cash، Orange Cash، InstaPay وأي Provider يرسله الخادم

**Search:** Order ID، رقم المرسل، رقم العملية

**Sort:** الأحدث / الأقدم

**Refresh:** يدوي وتلقائي

**بيانات كل Card:** order_id، amount، sender_phone، sender_name (إن وُجد)، Provider، status، وقت الطلب، آخر فحص

**القيود:** لا تعرض Regular Orders أو Gemini/service orders. استخدم discriminator الفعلي الموجود في الخادم للتمييز.

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

### 4.5 شاشة مصادر الدفع (Payment Sources) — التعديل الرئيسي

#### 4.5.1 قائمة Providers

**الغرض:** عرض جميع Providers المدعومة مع حالة توثيق كل منها.

**Providers المدعومة:** Vodafone Cash، Orange Cash، InstaPay، تحويل بنكي (Architecture قابلة للإضافة لأي Provider مستقبلًا)

**الحالة الافتراضية لكل Provider:** غير موثق / غير مفعّل. لا يصبح موثقًا إلا بعد نجاح عملية توثيق فعلية تُخزَّن في قاعدة البيانات المحلية.

**بيانات كل Provider في القائمة:**
- اسم Provider
- حالة التوثيق: UNVERIFIED / DISCOVERING / SELECTED / VERIFYING / VERIFIED / FAILED
- المصدر المحدد (Source ID / Sender Address) إن وُجد
- آخر رسالة مكتشفة (ملخص)
- عدد الرسائل المقروءة / المطابقة / المرفوضة
- زر «إضافة مصدر رسائل» أو «إعادة فحص» أو «إلغاء التوثيق» حسب الحالة

**قاعدة العرض:** أي Provider ليس لديه verified=true + source config صحيحة + successful verification مسجّل في قاعدة البيانات يُعرض بحالة «غير موثق» بصرف النظر عن أي حالة سابقة.

---

#### 4.5.2 تفاصيل Provider

**البيانات المعروضة لكل Provider:**
- Provider ID، اسم Provider، نوع الخدمة
- حالة التوثيق الحالية مع وصف واضح
- Source ID / Sender Address الموثق (إن وُجد)
- Source metadata: نوع المصدر، عدد الرسائل المتاحة، آخر وقت وصول
- Parser version المستخدم
- آخر رسالة مكتشفة (Raw SMS بدون تعديل)
- آخر مطابقة ناجحة / آخر رفض
- تاريخ آخر توثيق ناجح
- Receiving account / wallet
- Approved sender/origin identifiers
- Message patterns / verification status

**الأزرار:**
- «إضافة مصدر رسائل»: يبدأ تدفق Source Discovery (4.5.3)
- «إعادة فحص»: يعيد تشغيل Source Discovery من جديد
- «إلغاء التوثيق»: يلغي التوثيق الحالي (4.5.6)
- «Provider Test Mode»: يعرض نتائج تحليل رسالة دون إرسال بيانات للخادم (4.5.7)

---

#### 4.5.3 تدفق اكتشاف المصادر (Source Discovery)

**المشغّل:** الضغط على «إضافة مصدر رسائل» أو «إعادة فحص».

**الخطوات:**
1. التحقق من صلاحية READ_SMS — إذا لم تكن ممنوحة يُطلب الإذن من المستخدم مع شرح واضح للسبب
2. إذا رُفض الإذن: عرض رسالة واضحة + زر مباشر لإعداد Android، إيقاف التدفق
3. قراءة بيانات الرسائل المتاحة من Android SMS Provider (sender/address, body, date, thread) — لا يُفترض وجود ملفات SMS خارجية
4. تصفية الرسائل: استخراج المصادر الفريدة (Sender Address / Package) التي تحتوي على رسائل ذات صلة محتملة بـ Providers المدعومة
5. تجميع المصادر المكتشفة في قائمة منظمة
6. عرض شاشة اختيار المصدر (4.5.4)

**ملاحظة:** لا تُخترع معلومات غير متاحة من Android SMS Provider. تُعرض فقط البيانات الفعلية المتاحة.

---

#### 4.5.4 شاشة اختيار المصدر (Source Selection)

**التصميم:** Minimal واضح مع نص توضيحي في الأعلى يشرح الغرض من الاختيار.

**بيانات كل مصدر في القائمة:**
- اسم/رقم المرسل (Sender Address)
- نوع المصدر (SMS Sender / Short Code / Application)
- عدد الرسائل المتاحة من هذا المصدر
- آخر رسالة (ملخص أو أول سطر)
- آخر وقت وصول
- زر «اختيار»

**زر «إعادة فحص»:** يعيد قراءة Android SMS Provider ويحدّث القائمة.

**بعد الاختيار:** تنتقل الحالة إلى SELECTED وتبدأ عملية التوثيق (4.5.5) تلقائيًا.

**ملاحظة:** الاختيار وحده لا يعني التوثيق. يجب اجتياز عملية Verification الفعلية.

---

#### 4.5.5 توثيق المصدر (Source Verification)

**المشغّل:** بعد اختيار المصدر مباشرة.

**حالات التوثيق:**
- DISCOVERING: جاري اكتشاف المصادر
- SELECTED: تم اختيار مصدر، لم يبدأ التوثيق بعد
- VERIFYING: جاري تشغيل Parser واختبار الرسائل
- VERIFIED: نجح التوثيق، المصدر موثق
- FAILED: فشل التوثيق، المصدر غير موثق

**خطوات التوثيق:**
1. تشغيل Provider Parser الخاص بالـ Provider المحدد على عدة رسائل من المصدر المختار
2. التحقق من استخراج الحقول المتوقعة (amount، sender، recipient، transaction_id/reference، date/time) بنجاح
3. التحقق من تطابق صيغة الرسائل مع قواعد Provider
4. إذا نجح التحقق على عدد كافٍ من الرسائل: الحالة → VERIFIED
5. إذا فشل: الحالة → FAILED مع عرض سبب الفشل وتفاصيل الحقول التي لم تُستخرج

**عند نجاح التوثيق يُحفظ في قاعدة البيانات المحلية (SQLite):**
- Provider ID
- Source ID / Sender Address
- Source metadata
- Parser version
- تاريخ ووقت التوثيق الناجح
- verified = true

**البيانات تبقى بعد إعادة تشغيل التطبيق أو الجهاز.**

---

#### 4.5.6 إلغاء التوثيق

**السلوك:**
- يُحدَّث سجل Provider في قاعدة البيانات: verified = false، source config = null
- يتوقف SMS Reader عن استخدام هذا المصدر لهذا Provider
- حالة Provider تصبح UNVERIFIED
- لا تُحذف المعاملات السابقة المرتبطة بهذا Provider
- لا يرث أي توثيق جديد بيانات التوثيق القديم

---

#### 4.5.7 Provider Test Mode

**الغرض:** اختبار Parser على رسالة حقيقية دون إرسال أي بيانات إلى الخادم.

**المعروض:**
- Detected Provider
- Parsed Amount
- Sender
- Recipient
- Transaction ID / Reference
- Date، Time
- Balance (إن وُجد)
- Confidence
- Validation Errors (إن وُجدت)

**قاعدة صارمة:** لا يُرسَل أي شيء إلى الخادم في هذا الوضع.

---

#### 4.5.8 Live Status لكل Provider

**المعروض في الوقت الفعلي:**
- حالة المصدر الحالية (VERIFIED / UNVERIFIED / FAILED)
- حالة SMS Reader لهذا Provider (نشط / متوقف / خطأ)
- حالة Parser (جاهز / خطأ)
- آخر رسالة مستلمة من هذا المصدر
- آخر مطابقة ناجحة
- آخر رفض مع السبب
- Live Monitoring: عداد الرسائل الواردة في الجلسة الحالية

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

1. الاتصال بالخادم: Active Server Profile مع رابط لشاشة Server Profiles
2. مصادر الرسائل الموثقة: Providers وحالة التوثيق
3. Providers: إعدادات كل Provider
4. SMS: حالة الصلاحية، طلب الصلاحية
5. الخدمة الخلفية: حالة الخدمة، إعدادات التشغيل
6. الإشعارات: تفعيل/تعطيل أنواع الإشعارات
7. المزامنة: إعدادات Sync وOffline Queue
8. Battery Optimization: توجيهات استثناء التطبيق
9. الأمان: لا تعرض أسرار API أو Tokens كاملة
10. التشخيص (Diagnostics)

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
- Message Source Verification status لكل Provider

**الحالات:** جاهز / غير جاهز / يحتاج مراجعة — الضغط على أي عنصر يعرض السبب وطريقة الحل.

**أزرار التشخيص:** Test Connection، Test SMS Parser، Test Background Agent، Run Sync، Refresh Orders

---

## 5. منطق الأعمال والقواعد

### 5.1 Backend Connector (محافظ عليه — لا تعديل)

- مكوّن مستقل لا يرتبط بـ Supabase أو بعنوان API ثابت
- يقبل: Base URL، API Key/Token، نوع المصادقة
- يدير: الاتصال، الاكتشاف، التسجيل، المزامنة، Realtime/Polling
- لا يحتوي على أي Hardcoded Endpoint
- يدعم أنواع مصادقة متعددة

---

### 5.2 API Discovery (محافظ عليه — لا تعديل)

- بعد إدخال Base URL وبيانات المصادقة والضغط على Connect:
  1. يستدعي Configuration/Discovery Endpoint
  2. يقرأ OpenAPI/API metadata إن توفر
  3. يستخدم Endpoints المُعادة من /config
- لا يخمّن أو يستدعي عناوين عشوائية
- يتحقق من أن الـEndpoints المكتشفة تعمل وتعيد schema متوافقًا
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

### 5.3 نظام Source Verification — القواعد الجوهرية

#### 5.3.1 نموذج بيانات Provider في قاعدة البيانات المحلية

لكل Provider يُخزَّن:
- provider_id
- provider_name
- service_type
- source_id (Sender Address / Package)
- source_metadata (نوع المصدر، عدد الرسائل، آخر وقت وصول)
- parser_version
- enabled (boolean)
- verified (boolean)
- last_verification_at (timestamp)
- last_verification_result (VERIFIED / FAILED)
- last_message_at (timestamp)
- last_message_summary
- receiving_account
- approved_sender_identifiers
- message_patterns

**البيانات محفوظة في SQLite وتبقى بعد إعادة التشغيل.**

#### 5.3.2 قاعدة SMS Reader

- قبل تمرير أي رسالة SMS إلى Parser أو Verification Engine، يتحقق SMS Reader من:
  1. أن Provider المرتبط بهذا المصدر لديه verified = true في قاعدة البيانات
  2. أن source_id المسجّل يطابق Sender Address الرسالة الواردة
- إذا لم يتحقق الشرطان: الرسالة تُصنَّف UNTRUSTED_SOURCE ولا تدخل في التحقق المالي
- لا تُقبل SMS غير موثقة المصدر للتأكيد التلقائي

#### 5.3.3 استقلالية Providers

- كل Provider لديه إعداد مستقل: Provider ID، Source ID، Source metadata، Parser الخاص، Validation rules، Enabled، Verified، Last verification، Last message، Parser version
- لا يُستخدم Parser واحد لجميع Providers
- إضافة Provider جديد لا تتطلب تغيير نظام الاتصال بالخادم أو Verification Engine
- Core Verification Engine لا يعتمد على Provider واحد

#### 5.3.4 إعادة التوثيق

- عند بدء إعادة التوثيق: يُلغى التوثيق القديم (verified = false، source_id = null)
- يبدأ تدفق Source Discovery من جديد
- لا يرث التوثيق الجديد بيانات التوثيق القديم
- لا تُحذف المعاملات السابقة

#### 5.3.5 توثيق المصدر ليس Confirmation

- توثيق المصدر يعني فقط أن الرسائل من هذا المصدر يمكن قراءتها وتحليلها
- Backend Verification وIdempotency يستمران كما هما
- لا تعتمد على نص الرسالة وحده لإثبات الدفع

---

### 5.4 نظام الإشعارات الموحد (محافظ عليه)

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
| Source verified | تم توثيق مصدر Provider بنجاح |
| Source verification failed | فشل توثيق مصدر Provider + السبب |

**قواعد الإشعارات:**
- إشعارات داخل التطبيق وAndroid
- تعمل في الخلفية باستخدام الآليات الموجودة
- منع تكرار نفس الإشعار باستخدام event/idempotency ID
- ممنوع عرض API keys أو Anon Key أو tokens أو credentials أو بيانات حساسة

---

### 5.5 Order Normalizer (محافظ عليه)

- يحول البيانات القادمة من أي Backend متوافق إلى نموذج داخلي موحد
- يحتفظ بالـ Raw Payload كاملًا
- النموذج الداخلي: order_id، customer/user، payment_method، provider، amount، sender_phone، receiver_phone، sender_name، transaction_id، transaction_reference، order_created_at، message_received_at، service/type، raw_order، raw_sms، status
- إذا كانت بعض الحقول غير موجودة في الطلب، لا يعتبرها خطأ تلقائيًا؛ يستكملها من رسالة SMS بعد العثور على المعاملة

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

### 5.9 SMS Reader وLocal Transaction Ledger (محافظ عليهما مع إضافة Source Check)

**مسار معالجة SMS المحدَّث:**
Capture locally → حفظ Raw SMS كما وصلت → timestamp الحقيقي → Source Validation (هل المصدر موثق؟) → إذا UNTRUSTED_SOURCE: تسجيل وإيقاف → Provider Detection → Provider Parser → Validation → Local Ledger → Matching

**Local Transaction Ledger:**
- Raw SMS، Provider، Source، Source Verification Status، Received At، Parsed Amount، Sender، Receiver، Transaction ID، Transaction Reference، Parsing Status، Verification Status، Matched Order ID، Duplicate Status
- يُستخدم للعمل Offline ومنع إعادة استخدام المعاملات
- لا تُخزَّن رسائل غير مرتبطة
- لا تعتمد على Raw SMS وحدها لإثبات الدفع
- لا ترفع كل رسائل الهاتف للخادم

**SMS Listener:**
- استقبال حدث SMS الجديدة بدل إعادة قراءة كل الرسائل
- طلب صلاحية READ_SMS وRECEIVE_SMS بوضوح من المستخدم
- قراءة رسائل Vodafone Cash وOrange Cash وInstaPay فقط من مصادر موثقة

---

### 5.10 Order ↔ SMS Matching (محافظ عليه)

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

### 5.11 Verification Pipeline (محافظ عليه — لا تعديل)

```
RECEIVED → SCANNING → MESSAGE_FOUND → SOURCE_VERIFIED → PROVIDER_VERIFIED
→ AMOUNT_VERIFIED → SENDER_VERIFIED → RECEIVER_VERIFIED → TRANSACTION_VERIFIED
→ DUPLICATE_CHECK → VERIFIED → CONFIRMED
```

بدائل: REJECTED، DUPLICATE، NEEDS_REVIEW

لا يتم Confirm قبل اكتمال جميع Required Checks.

**Anti-Fraud / Anti-Replay:**
- Required checks: Provider، Receiver، Amount، Sender عند توفره، Transaction ID/Reference، Timestamp، Source، Duplicate Status
- Backend هو المصدر النهائي للتأكيد
- نفس transaction_id لا يستخدم لأكثر من Order
- نفس Order لا يؤكد مرتين
- Idempotency Keys لكل عملية Confirm

---

### 5.12 Order State Machine (محافظ عليه)

```
NEW → QUEUED → SCANNING → MATCHED → VERIFYING → CONFIRMED
NEW → QUEUED → SCANNING → NOT_FOUND/WAITING → إعادة الفحص → EXPIRED
NEW → QUEUED → SCANNING → REVIEW_REQUIRED
NEW → QUEUED → SCANNING → REJECTED
```

---

### 5.13 Request Filtering (محافظ عليه)

- سحب طلبات الشحن المخصصة للـ Agent فقط
- استبعاد Regular Orders وGemini/service orders وأي نوع آخر
- استخدام discriminator/type/status الموجود فعليًا في الخادم

---

### 5.14 Transaction Deduplication (محافظ عليه)

- Composite Key: order_id + provider + transaction_id + amount + receiver
- قبل Confirm: تحقق Local DB ثم Server-side عند توفره
- لا تعتمد على transaction_id وحده إذا كان غير موثوق
- transaction_id واحد لا يرتبط بطلبين مؤكدين
- order_id واحد لا يؤكد مرتين
- Idempotency Key مناسبة لكل عملية Confirm
- الخادم هو المصدر النهائي لمنع التأكيد المكرر

---

### 5.15 Live Synchronization (محافظ عليه)

- Realtime كقناة أساسية إذا كان Backend Connector يدعمه
- Polling كـfallback عند عدم توفر Realtime أو فقد الاتصال
- لا تستخدم Polling ثابتًا إذا كان Realtime يعمل بشكل صحيح

**مسار عودة الاتصال:**
Reconnect → تحقق Device Registration → Fetch Pending Orders → Reconcile Local Queue → Match Local Transactions → Sync Results → تحديث Last Sync

---

### 5.16 Time Window (محافظ عليه)

- نافذة البحث لا تتجاوز 24 ساعة من timestamp الطلب وفق سياسة الخادم
- Offline لا يبدأ نافذة جديدة ولا يلغي الطلب
- إذا أُنشئ الطلب أثناء Offline لا يُرفض لمجرد مرور أكثر من 24 ساعة قبل عودة الإنترنت؛ يتم تقييم الصلاحية اعتمادًا على وقت وصول الرسالة الفعلي المحفوظ محليًا ووقت إنشاء الطلب
- SMS التي تصل أثناء Offline تُسجَّل محليًا مع وقت الاستلام الفعلي وتُطابَق عند الاتصال

---

### 5.17 Offline-First Queue (محافظ عليه)

Local DB تحفظ: pending orders، scan state، parsed messages، verification results، used transaction IDs، sync queue، structured logs، وقت استلام SMS الفعلي، provider source verification state.

عند Match Offline: local verification → CONFIRMED_LOCAL/SYNC_PENDING → reconnect → server confirmation → SYNCED.

لا تُحذف الطلبات عند انقطاع الإنترنت.

**Reliability & Recovery:**
- Persist كل عملية مهمة قبل الانتقال للحالة التالية
- Crash أو process kill لا يفقد Orders أو Parsed SMS أو Verification Results أو Sync Queue أو Transaction IDs أو Source Verification State
- بعد Restart: استعد Local DB → Configuration → Device Registration → Pending Orders → Sync Queue → Agent
- لا تعيد Confirmation سابقة

---

### 5.18 Background Agent (محافظ عليه)

- Foreground Service للمراقبة المستمرة
- WorkManager للمهام المؤجلة
- Network callbacks للمصالحة عند استعادة الاتصال
- Boot Receiver: عند تشغيل الهاتف يبدأ في الخلفية وفق قيود Android، يتحقق من الشبكة، يحاول الاتصال تلقائيًا، يعيد تشغيل Realtime، يزامن Pending Queue، يواصل مراقبة SMS
- Notification Channel لخدمة Agent
- التعامل مع Doze وBattery/OEM restrictions
- منع duplicate workers
- retry آمن عند فشل الشبكة

---

### 5.19 Automatic Retry (محافظ عليه)

- Exponential backoff لإعادة المحاولة عند فشل الشبكة
- Idempotent requests لمنع duplicate confirmation عند تكرار Confirm بسبب timeout

---

### 5.20 Permissions / Onboarding (محافظ عليه)

- اعرض: SMS Permission، Notification Permission، Background Execution، Battery Optimization، Internet وأي Permission ضروري فعليًا
- لا تطلب Permission غير ضروري
- عند الرفض: حالة واضحة + زر مباشر لإعداد Android
- لا تعتبر Agent جاهزًا إذا كانت صلاحية أساسية مفقودة

---

### 5.21 Device Registration (محافظ عليه)

- بعد نجاح API Discovery: اختبر الاتصال، سجّل الجهاز، احصل على device_id/token، خزّن credentials بأمان في local storage
- لا تعرض credentials في UI أو logs

---

### 5.22 Activity / Diagnostics Log (محافظ عليه مع إضافة أحداث Source Verification)

**Structured logs تحتوي:**
timestamp، event، order_id، provider، action، result، masked transaction_id، Sync status، error_code، HTTP status، endpoint، method، request ID إن وجد

**أحداث Source Verification المضافة:**
- Source discovery started
- Sources discovered (count)
- Source selected (masked source_id)
- Source verification started
- Source verification passed
- Source verification failed (reason)
- Source revoked
- SMS from untrusted source blocked

**ممنوع تسجيل:** API keys، Anon Key، passwords، secrets، authorization headers، raw credentials، raw SMS

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
- توثيق المصدر لا يُعرض كـ Confirmation للدفع
- Source ID / Sender Address لا يُعرض كاملًا في Logs

---

## 7. الحالات الاستثنائية والحدود

| الحالة | السلوك المتوقع |
|---|---|
| Provider بدون verified source | يُعرض «غير موثق»، SMS Reader لا يستخدمه |
| SMS من مصدر غير موثق | UNTRUSTED_SOURCE، لا تدخل في التحقق المالي |
| SMS Permission مرفوضة عند Source Discovery | عرض رسالة واضحة + زر إعداد Android، إيقاف التدفق |
| لا توجد رسائل من Provider في الجهاز | عرض «لم يُعثر على رسائل» مع نص توضيحي |
| Parser يفشل في استخراج الحقول المتوقعة | حالة FAILED مع تفاصيل الحقول الناقصة |
| مصدر يطابق أكثر من Provider | يُعرض للمستخدم لاختيار Provider المناسب |
| إعادة توثيق مصدر | إلغاء القديم أولًا، لا يرث الجديد بيانات القديم |
| إلغاء توثيق أثناء معالجة Order | Order الجاري يكمل دورته، الطلبات الجديدة لا تستخدم المصدر الملغى |
| Crash أثناء Source Verification | عند الاستئناف: حالة FAILED، يطلب إعادة التوثيق |
| Provider Test Mode | لا يُرسَل أي شيء للخادم |
| verified=true بدون source config صحيحة | يُعامَل كـ UNVERIFIED |
| اتصال أول مرة | Discovery → Validate → Register → Start |
| API Key خاطئ | عرض خطأ 401 مع التفاصيل في Diagnostics |
| Backend غير متاح | عرض آخر خطأ في Home وإعادة المحاولة بـ exponential backoff |
| Internet disconnected | حفظ الحالة محليًا وإعادة المحاولة تلقائيًا عند الاتصال |
| App restarted | استئناف المعالجة من الحالة المحفوظة بما فيها Source Verification State |
| Device restarted | Boot Receiver يبدأ Agent في الخلفية |
| Realtime غير متاح | Fallback تلقائي إلى Polling |
| Duplicate transaction | رفض مع سبب واضح |
| Regular Order يدخل queue | استبعاده فورًا عبر discriminator |
| Connected يظهر بدون Sync فعلي | ممنوع — Status مشتق من حالة فعلية فقط |

---

## 8. خطة التنفيذ التدريجية

### المرحلة A — Source Verification Core

**الخطوات:**
1. تحديث نموذج بيانات Provider في SQLite ليشمل جميع حقول Source Verification
2. إصلاح الحالة الحالية: أي Provider بدون verified=true + source config صحيحة + successful verification يُعرض «غير موثق»
3. تطوير Source Discovery: قراءة Android SMS Provider وتجميع المصادر الفريدة
4. تطوير شاشة Source Selection بتصميم Minimal واضح
5. تطوير Source Verification Engine: تشغيل Parser على عدة رسائل والتحقق من الحقول المتوقعة
6. حفظ نتيجة التوثيق في SQLite

**التحقق:** typecheck، lint، build، unit tests لـ Source Verification Engine

---

### المرحلة B — SMS Reader Integration + UI

**الخطوات:**
1. تحديث SMS Reader: إضافة Source Validation قبل تمرير الرسالة للـ Parser
2. تسجيل UNTRUSTED_SOURCE في Local Transaction Ledger
3. تحديث شاشة Payment Sources: قائمة Providers + تفاصيل Provider + Live Status
4. إضافة أزرار إعادة التوثيق وإلغاء التوثيق
5. إضافة إشعارات Source Verified / Source Verification Failed
6. تحديث Diagnostics: إضافة Message Source Verification status لكل Provider

**التحقق:** integration tests، Source Verification scenarios A-I، SMS Reader tests

---

### المرحلة C — Recovery + Documentation

**الخطوات:**
1. Recovery validation: اختبار Crash/Restart/Reboot مع Source Verification State
2. End-to-End testing: Online + Offline + Untrusted Source scenarios
3. تحديث NADERPAY_AGENT_ARCHITECTURE.md وdocs/prd.md

**التحقق:** typecheck، lint، build، integration tests، Android build، Release APK/AAB

---

## 9. الاختبارات الإلزامية

### اختبارات Source Verification (السيناريوهات A-I)

**A — توثيق ناجح:**
اختيار مصدر → تشغيل Parser → استخراج جميع الحقول المتوقعة → VERIFIED → حفظ في SQLite

**B — فشل التوثيق:**
اختيار مصدر → Parser يفشل في استخراج الحقول → FAILED → Provider يبقى UNVERIFIED

**C — SMS من مصدر غير موثق:**
رسالة تصل من مصدر غير موثق → UNTRUSTED_SOURCE → لا تدخل Verification Engine

**D — إعادة التوثيق:**
إلغاء توثيق قديم → اختيار مصدر جديد → Verification من جديد → لا يرث بيانات القديم

**E — إلغاء التوثيق:**
إلغاء → verified=false → SMS Reader يتوقف عن استخدام المصدر → المعاملات السابقة محفوظة

**F — Restart مع Source Verification State:**
إغلاق التطبيق → إعادة التشغيل → Source Verification State محفوظ من SQLite

**G — SMS Permission مرفوضة:**
رفض الإذن → عرض رسالة واضحة → لا Source Discovery → لا False Verification

**H — لا رسائل من Provider:**
Source Discovery → لا رسائل مطابقة → عرض «لم يُعثر على رسائل» → لا VERIFIED

**I — Provider Test Mode:**
تشغيل Test Mode → عرض نتائج Parser → لا إرسال للخادم

### اختبارات الاتصال والاكتشاف
- اتصال أول مرة ناجح
- API Key خاطئ (401)
- Backend غير متاح
- Discovery Endpoint غير متاح
- Backend يعيد 400/403/404/409/500
- أكثر من Server Profile والتبديل بينها

### اختبارات السيناريوهات الأساسية
- Online: Order → SMS من مصدر موثق → Auto Verification → Confirmation → Sync
- Offline: Order → Disconnect → SMS → Local Match → Local Result → Reconnect → Sync
- SMS before Order: SMS محفوظة → Order لاحقًا → Match
- Duplicate: نفس transaction_id لطلبين → واحد فقط ينجح
- Background: التطبيق مغلق → Order/SMS → Agent يعالج
- Providers: Vodafone/Orange/InstaPay valid/invalid
- Provider isolation: SMS من Provider آخر لا تؤكد الطلب

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
- Source Verification System: نموذج البيانات، تدفق التوثيق، قواعد SMS Reader
- Verification rules متعددة المراحل و24h time window
- Transaction uniqueness وidempotency
- Offline queue وbackground agent
- Notifications وdiagnostics
- Testing وdeployment

ممنوع توثيق Payment Gateway أو Webhook architecture.

---

## 11. معايير القبول

1. يفتح المستخدم شاشة Payment Sources فيرى جميع Providers بحالة «غير موثق» افتراضيًا
2. أي Provider ليس لديه verified=true + source config صحيحة + successful verification في SQLite يُعرض «غير موثق» بصرف النظر عن أي حالة سابقة
3. يضغط على «إضافة مصدر رسائل» لـ Provider معين فيتحقق التطبيق من صلاحية SMS ويطلبها إن لزم
4. تظهر قائمة المصادر المكتشفة من Android SMS Provider مع بيانات كل مصدر (اسم/رقم المرسل، عدد الرسائل، آخر رسالة، آخر وقت وصول)
5. يختار المستخدم مصدرًا فيبدأ التطبيق Source Verification تلقائيًا بتشغيل Parser الخاص بالـ Provider
6. عند نجاح التوثيق: حالة Provider تصبح VERIFIED وتُحفظ في SQLite وتبقى بعد إعادة التشغيل
7. عند فشل التوثيق: حالة FAILED مع تفاصيل الحقول التي لم تُستخرج، Provider يبقى UNVERIFIED
8. SMS Reader يتحقق من توثيق المصدر قبل تمرير الرسالة للـ Parser — رسائل المصادر غير الموثقة تُصنَّف UNTRUSTED_SOURCE ولا تدخل في التحقق المالي
9. Provider Test Mode يعرض نتائج Parser دون إرسال أي بيانات للخادم
10. إلغاء التوثيق يوقف استخدام المصدر فورًا دون حذف المعاملات السابقة
11. إعادة التوثيق لا ترث بيانات التوثيق القديم
12. Source Verification State محفوظ في SQLite ويُستعاد بعد Crash أو Restart أو Reboot
13. Diagnostics يعرض Message Source Verification status لكل Provider
14. الأنظمة المستقرة (Orders، Backend Connector، Realtime، Verification Engine، Notifications، Local Ledger، Offline Queue، API، Dashboard) تعمل دون تغيير
15. Build + Runtime + End-to-End tests ناجحة أو تقرير واضح بالمشاكل

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
- مزامنة Source Verification State مع الخادم