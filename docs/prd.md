# وثيقة المتطلبات

## 1. نظرة عامة على التطبيق

**اسم التطبيق:** Nader Pay Android Agent

**وصف التطبيق:** تطبيق Android يعمل كـ Agent/Worker على الهاتف فقط. يسحب Shipping Requests التي أنشأها Nader AI بحالة Pending، يبحث في رسائل SMS عن تحويلات Vodafone Cash المطابقة، يتحقق من صحة التحويل وعدم إعادة استخدامه، ثم يرسل نتيجة التأكيد أو الرفض إلى Nader AI.

**البنية التقنية:**
- Framework: React Native + Expo SDK 55 + NativeWind + expo-router + TypeScript
- Backend: Supabase (Nader AI)
- الملفات الرئيسية:
  - src/app/(app)/index.tsx (Home)
  - src/app/(app)/orders/index.tsx
  - src/app/(app)/settings/index.tsx
  - src/services/smsReader.ts
  - src/services/smsParser.ts
  - src/services/matchingEngine.ts
  - src/services/pollingWorker.ts
  - src/services/naderAiClient.ts
  - src/services/deviceRegistration.ts
  - src/db/localStore.ts
  - src/types/types.ts
  - NADERPAY_AGENT_ARCHITECTURE.md

---

## 2. المستخدمون وسيناريوهات الاستخدام

**المستخدم المستهدف:** مشغّل الجهاز الذي يثبّت التطبيق ويربطه بـ Nader AI لمراقبة تحويلات Vodafone Cash.

**السيناريو الكامل:**
1. Nader AI ينشئ Shipping Request بحالة Pending
2. التطبيق يسحب الطلب دوريًا
3. الطلب ينتقل إلى حالة SCANNING
4. التطبيق يقرأ SMS المرشحة من Vodafone Cash
5. Parser يستخرج بيانات التحويل
6. Matching Engine يطابق البيانات مع الطلب
7. يتحقق من عدم استخدام transaction_id سابقًا
8. عند التطابق: ينتقل إلى MATCHED ثم يرسل تأكيدًا إلى Nader AI → CONFIRMED
9. عند عدم التطابق: يرسل رفضًا إلى Nader AI → REJECTED
10. Nader AI يحدّث حالة Shipping Request

---

## 3. ما يجب إزالته من التطبيق الحالي

يجب حذف أو تعطيل كل ما يلي إن وُجد:
- Nader Pay API integration
- Payment Request creation
- Payment Status API الخاص ببوابة Nader Pay
- Webhook dispatcher
- Nader Pay API Key / Secret
- Nader Pay Supabase credentials
- Merchant Payment Integration screens
- Webhook Secret configuration
- أي flow يجعل التطبيق مصدر الطلبات
- أي flow يجعل Nader AI ينتظر Payment API من التطبيق

**ممنوع حذف:** بيانات production أو بيانات المستخدمين أو سجلات Nader AI.

---

## 4. هيكل الشاشات والوظائف

### 4.1 خريطة الشاشات

```
Nader Pay Android Agent
├── Home (الشاشة الرئيسية)
├── Orders (قائمة الطلبات)
└── Settings (الإعدادات)
```

---

### 4.2 شاشة Home

**الغرض:** عرض الحالة التشغيلية الفورية للـ Agent.

**المعلومات المعروضة:**
- حالة الاتصال بـ Nader AI (متصل / غير متصل)
- حالة تسجيل الجهاز (مسجّل / غير مسجّل)
- آخر وقت مزامنة
- عدد الطلبات حسب كل حالة: NEW / SCANNING / CONFIRMED / REJECTED
- حالة SMS Reader (مفعّل / محظور الصلاحية)
- آخر خطأ حدث

**الأزرار:**
- Sync Now: تشغيل مزامنة فورية
- Test Connection: اختبار الاتصال بـ Nader AI

**التصميم:** Minimal — مساحات بيضاء كافية، تسلسل هرمي واضح عبر حجم الخط ووزنه، تباين لطيف، بدون ظلال أو ألوان زخرفية.

---

### 4.3 شاشة Orders

**الغرض:** عرض Shipping Requests فقط التي يعالجها الـ Agent.

**البيانات المعروضة لكل طلب:**
- order_id
- amount
- sender_phone (إن وُجد)
- sender_name (إن وُجد)
- status
- created_at
- transaction_id (بعد المطابقة)
- rejection_reason (عند الرفض)

**القيود:**
- لا تعرض Regular Orders
- لا تعرض Gemini orders
- لا تعرض E2E test orders إلا إذا كانت مصنفة صراحة كاختبار للـ Agent
- استخدم discriminator الفعلي الموجود في Nader AI للتمييز

---

### 4.4 شاشة Settings

**الغرض:** إعداد الاتصال بـ Nader AI وتسجيل الجهاز.

**الحقول:**
- Nader AI / Supabase URL
- Supabase Anon Key

**الأزرار:**
- حفظ الإعدادات
- تسجيل الجهاز
- اختبار الاتصال

**ممنوع إضافة أي من التالي:**
Nader Pay API Key، Nader Pay Webhook Secret، Nader Pay Supabase Key، Payment API URL، Webhook URL، Service Role Key، Database Password، Telegram Token.

---

## 5. منطق الأعمال والقواعد

### 5.1 Device Registration

بعد إدخال Nader AI URL وAnon Key:
1. اختبر الاتصال
2. سجّل الجهاز باستخدام الآلية الموجودة فعليًا في Nader AI
3. احصل على device_id/token إذا كان النظام الحالي يستخدمهما
4. خزّن credentials بأمان في local storage
5. اربط الجهاز بالـ scope المسموح له
6. لا تعرض credentials في UI أو logs
7. لا تنشئ نظام صلاحيات موازٍ إذا كان Nader AI لديه device authorization قائم

---

### 5.2 Polling / Worker

- مزامنة دورية لسحب Shipping Requests بحالة Pending من Nader AI
- Sync Now: تشغيل مزامنة فورية عند الطلب
- Background Worker حسب Android architecture الحالية وقيود Android
- retry آمن عند فشل الشبكة
- منع duplicate processing: order_id واحد يملك processing lock واحدًا فقط
- منع معالجة نفس order_id بالتوازي
- منع duplicate workers

---

### 5.3 حالات الطلب (State Machine)

```
NEW → SCANNING → MATCHED → CONFIRMED
NEW → SCANNING → REJECTED
NEW → SCANNING → EXPIRED
NEW → SCANNING → ERROR
```

إذا كانت سياسة Nader AI تتطلب إبقاء الطلب Pending بدلًا من REJECTED، يُتبع ذلك.

---

### 5.4 SMS Reader

- طلب صلاحية READ_SMS بوضوح من المستخدم
- قراءة الرسائل الضرورية فقط (Vodafone Cash)
- عدم تخزين أو رفع SMS غير الضرورية
- دعم النص العربي الفعلي
- Parser مرن لا يعتمد على position ثابت
- قراءة SMS ليست دليل نجاح بحد ذاتها

---

### 5.5 SMS Parser

من رسالة نموذجية:
```
تم استلام مبلغ 100 جنيه من رقم 01091216432 المسجل بإسم Mahmoud S Rouby على رقم محفظتك 01097273680. رصيدك الحالي: 84353.90 جنيه. تاريخ العملية: 22:28 26-08-26. رقم العملية: 023080824104
```

يستخرج عند توفرها:
- amount
- sender_phone
- sender_name
- recipient_wallet
- transaction_time
- transaction_id

يستخدم Regex/Parsing مرنًا يدعم اختلاف المسافات والترقيم وصيغ الأرقام.

---

### 5.6 Matching Engine

ترتيب خطوات المطابقة:
1. قراءة amount من الطلب
2. قراءة sender_phone إن وُجد
3. قراءة sender_name إن وُجد
4. قراءة recipient_wallet إذا كان مطلوبًا
5. البحث في SMS المرشحة وتحليلها
6. مطابقة amount بدقة (إلزامي)
7. مطابقة sender_phone إذا كان موجودًا في الطلب (إلزامي عند توفره)
8. sender_name عامل مساعد عند توفره
9. التحقق من recipient_wallet عند الحاجة
10. التحقق من transaction_id وtimestamp
11. التحقق من أن transaction_id غير مستخدم سابقًا
12. إذا كانت هناك نتائج متعددة غير قابلة للحسم: لا يُؤكَّد الطلب

**قاعدة صارمة:** لا يُعتمد على تطابق المبلغ وحده عند توفر sender_phone.

---

### 5.7 Transaction Uniqueness

- transaction_id هو المعرف الأساسي لمنع إعادة استخدام التحويل
- قبل التأكيد: فحص الاستخدام السابق محليًا
- استخدام server-side validation في Nader AI إذا كانت متاحة
- استخدام idempotent confirmation
- transaction_id واحد لا يؤكد أكثر من order واحد
- إذا كان مستخدمًا سابقًا: رفض الطلب مع سبب واضح

---

### 5.8 Confirmation

عند المطابقة الناجحة، يُرسَل إلى Nader AI:
- order_id
- status = confirmed
- transaction_id
- matched_amount
- sender_phone
- sender_name
- transaction_time
- device_id
- verification timestamp

إذا كانت أسماء الحقول مختلفة في implementation الحالي لـ Nader AI، تُستخدم كما هي.

---

### 5.9 Rejection

عند الرفض، يُرسَل إلى Nader AI:
- order_id
- status = rejected
- rejection_reason
- device_id
- verification timestamp

---

### 5.10 Idempotency

- Confirmation يجب أن تكون idempotent
- retry بسبب network timeout أو app restart أو worker retry لا يؤدي إلى double confirmation
- يُستخدم identifier ثابت مثل order_id + transaction_id وفق API الفعلي
- لا يُنشأ random key جديد لكل retry

---

### 5.11 Background Execution

- فحص Android background constraints
- استخدام Worker/Foreground Service فقط عند الحاجة الفعلية
- منع duplicate workers
- إعادة المحاولة عند network failure
- عدم استنزاف البطارية بسبب polling مفرط

---

### 5.12 Local Persistence

يُخزَّن محليًا:
- settings
- device state
- processing locks
- processed order IDs
- transaction IDs المستخدمة

لا تُخزَّن SMS كاملة بلا ضرورة.

---

### 5.13 Nader AI Audit

يجب فحص Nader AI لمعرفة:
- Shipping Request table/model
- status values
- device registration mechanism
- polling endpoint/function
- confirmation/rejection endpoint/function
- idempotency implementation
- transaction uniqueness
- RLS
- timestamps
- discriminator الذي يميز Shipping Requests عن Regular Orders

يُستخدم implementation الفعلي في كل ما سبق.

---

## 6. متطلبات الأمان

- لا توضع Service Role Key أو database password أو private backend secret في التطبيق
- أي authorization حساس يتحقق server-side في Nader AI
- لا يُثق في device_id المرسل من التطبيق وحده — يتحقق من device registration والـ scope server-side
- secure local storage للـ credentials
- لا credentials في APK أو repository
- HTTPS/TLS إلزامي
- Logs آمنة (لا تظهر credentials أو SMS حساسة)
- Anon Key يُستخدم فقط وفق التصميم الحالي لـ Nader AI
- minimal SMS handling: لا تُرفع SMS غير الضرورية

---

## 7. الحالات الاستثنائية والحدود

| الحالة | السلوك المتوقع |
|---|---|
| SMS permission مرفوضة | عرض رسالة واضحة وإيقاف المسح |
| جهاز غير مسجّل | رفض المعالجة مع رسالة توضيحية |
| transaction_id مستخدم سابقًا | رفض الطلب مع سبب واضح |
| تطابق مبلغ فقط مع توفر sender_phone | عدم التأكيد |
| نتائج متعددة غير قابلة للحسم | عدم التأكيد |
| انقطاع الشبكة | retry آمن مع حفظ الحالة محليًا |
| فشل Confirmation بسبب timeout | إعادة المحاولة بـ idempotent request |
| Regular Order يدخل queue | استبعاده فورًا عبر discriminator |
| E2E test order | استبعاده إلا إذا كان مصنفًا صراحة للـ Agent |
| duplicate worker | منع تشغيل worker ثانٍ |
| app restart أثناء SCANNING | استئناف المعالجة من الحالة المحفوظة |
| Nader AI لا يستجيب | عرض آخر خطأ في Home وإعادة المحاولة |

---

## 8. التوثيق المطلوب

إنشاء/تحديث ملف `NADERPAY_AGENT_ARCHITECTURE.md` يشرح implementation الفعلي فقط:
- architecture
- Nader AI connection
- device registration
- polling
- Shipping Request contract
- SMS permissions
- parser
- matching rules
- transaction uniqueness
- confirmation/rejection
- security
- local storage
- background worker
- testing
- deployment

ممنوع توثيق Payment Gateway/Webhook architecture بعد إزالتها.

---

## 9. معايير القبول

1. يفتح المستخدم التطبيق ويدخل Nader AI URL وAnon Key في Settings
2. يضغط Test Connection ويرى تأكيد الاتصال
3. يضغط Register Device ويرى تأكيد تسجيل الجهاز
4. تظهر في Home حالة الاتصال وتسجيل الجهاز وحالة SMS Reader
5. يضغط Sync Now فيسحب التطبيق Shipping Requests بحالة Pending من Nader AI
6. تظهر الطلبات في شاشة Orders بحالة NEW
7. ينتقل الطلب إلى SCANNING ويبدأ التطبيق قراءة SMS
8. يستخرج Parser بيانات التحويل من رسالة Vodafone Cash العربية بشكل صحيح
9. عند تطابق amount وsender_phone وtransaction_id: ينتقل الطلب إلى MATCHED ثم يُرسَل تأكيد إلى Nader AI → CONFIRMED
10. Nader AI يحدّث حالة Shipping Request
11. عند عدم التطابق: يُرسَل رفض إلى Nader AI → REJECTED مع rejection_reason
12. إعادة نفس Confirmation لا تؤدي إلى double confirmation
13. نفس transaction_id لا يؤكد طلبًا ثانيًا
14. Regular Orders لا تظهر في شاشة Orders
15. لا تظهر أي credentials أو SMS حساسة في UI أو logs
16. عند رفض صلاحية SMS: تظهر رسالة واضحة في Home
17. عند انقطاع الشبكة: يُعاد المحاولة تلقائيًا دون فقدان الحالة
18. لا يوجد في التطبيق أي شاشة أو منطق خاص بـ Payment Gateway أو Webhook أو Nader Pay API Key

---

## 10. الوظائف غير المشمولة في هذه المرحلة

- إنشاء Shipping Requests من داخل التطبيق
- Payment Gateway أو Payment Request creation
- Webhook dispatcher أو Webhook Secret
- Nader Pay API Key/Secret
- Merchant API
- إدارة المستخدمين أو الحسابات
- Dashboard إحصائي متقدم
- دعم مزودين آخرين غير Vodafone Cash
- iOS build
- SDKs رسمية