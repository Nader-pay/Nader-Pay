# وثيقة المتطلبات

## 1. نظرة عامة على التطبيق

**اسم التطبيق:** Nader Pay Agent

**وصف التطبيق:** وكيل التحقق الآلي للمدفوعات — تطبيق Android لمراقبة وتحقق التحويلات المالية عبر SMS. يعمل كـ Generic Payment Verification Agent مرتبط بـ Nader AI Backend عبر Supabase URL + Anon Key + Device Registration. يستلم طلبات الشحن، يقرأ رسائل SMS من مصادر موثقة فقط، يحلل التحويلات عبر Parsers مستقلة لكل Provider، يطابق البيانات مع الطلبات، يمنع التكرار، ثم يرسل نتيجة التحقق إلى الخادم.

**قاعدة التنفيذ:** تطوير فوق النسخة الحالية فقط. لا إعادة بناء من الصفر. الأنظمة المستقرة التالية لا تُعدَّل: Orders، Backend Connector، Realtime، Verification Engine، Notifications، Local Ledger، Offline Queue، API، Dashboard.

**المعمارية الثابتة:**
- Nader AI = مصدر طلبات الشحن
- Nader Pay Agent = Android Verification Agent
- الربط = Nader AI Supabase URL + Anon Key + Device Registration/Device ID
- ممنوع: Payment Gateway، Payment API، Webhook architecture جديدة، Nader Pay API Key، Webhook Secret، Service Role Key، Database Password

**الملفات الرئيسية الحالية:**
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
2. التطبيق يكتشف API Contract تلقائياً ويتحقق من صحة الـ Endpoints ويحفظ Server Profile
3. يسجّل الجهاز ويبدأ Realtime أو Polling
4. الخادم ينشئ طلباً بحالة Pending
5. Agent يسحب الطلب: NEW → QUEUED
6. يبدأ Scan تلقائياً: SCANNING
7. يحدد Provider من رسائل SMS الواردة من مصدر موثق فقط ومطابق لنوع Provider الطلب
8. Parser المخصص يستخرج بيانات التحويل
9. Order Normalizer يحول البيانات إلى نموذج داخلي موحد
10. Matching Engine يطابق البيانات مع الطلب
11. يتحقق من عدم التكرار محلياً وعلى الخادم
12. عند تطابق ناجح: MATCHED → VERIFYING → CONFIRMED → Sync إلى الخادم
13. عند غموض: REVIEW_REQUIRED
14. عند عدم التطابق أو انتهاء الصلاحية: REJECTED / EXPIRED

---

## 3. ما يجب إزالته من التطبيق الحالي

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
├── مصادر الدفع (Payment Sources)
│   ├── قائمة Providers
│   ├── تفاصيل Provider
│   │   ├── اكتشاف المصادر (Source Discovery)
│   │   │   └── شاشة اكتشاف واختيار مصادر SMS [جديد]
│   │   ├── اختيار المصدر (Source Selection)
│   │   └── توثيق المصدر (Source Verification)
│   └── Live Status لكل Provider
├── ملفات الخادم (Server Profiles)
└── الإعدادات (Settings)
    └── التشخيص (Diagnostics)
```

---

### 4.2 شاشة الرئيسية / Dashboard

**Header/Card علوي:**
- الاسم: Nader Pay Agent
- الوصف: وكيل التحقق الآلي للمدفوعات
- حالة Agent (نشط / متوقف) — مشتقة من Status Engine الفعلي
- زر Notifications مع Badge لعدد التنبيهات غير المقروءة

**ملخص حالة الوكيل الذكي (Agent Smart Summary):**
يُعرض في أعلى الصفحة الرئيسية بعد Header مباشرة. يحتوي على:
- مؤشر حالة مركّب يعكس الحالة الإجمالية للوكيل: جاهز / يحتاج انتباه / متوقف
- الحالة الإجمالية مشتقة من Status Engine وتجمع: حالة الاتصال + حالة SMS Permission + حالة Provider الموثق + حالة Background Service
- نص ملخص قصير يصف الحالة الحالية للوكيل بالعربية
- الملخص يتحدث تلقائياً عند تغيير أي حالة فعلية

**المعلومات المعروضة (حالات حقيقية فقط من Status Engine):**
- حالة الإنترنت
- حالة الاتصال بالخادم النشط: متصل / يتصل / غير متصل / غير مصرح / إعداد غير صحيح / خطأ خادم / Timeout / Offline
- حالة Realtime (نشط / Polling / غير متاح)
- حالة SMS Permission
- حالة تسجيل الجهاز
- آخر مزامنة (Last Sync) — لا يتغير إلا بعد Sync فعلي
- آخر تحقق (Last Verification)
- آخر خطأ (Last Error)
- حالة Payment Sources لكل Provider

**إحصائيات الطلبات — تفاعلية:**
تُعرض كـ Cards قابلة للضغط. كل Card تمثل حالة طلب: معلّق، جاري الفحص، مؤكد، مرفوض، مكرر، يحتاج مراجعة، Offline Queue. عند الضغط على أي Card: ينتقل المستخدم مباشرة إلى شاشة الطلبات مع تفعيل الفلتر المقابل تلقائياً.

**الأزرار:** Update Now، Test Connection.

**قاعدة صارمة:** لا يُعرض أي حالة افتراضية إيجابية. كل حالة مشتقة من Status Engine الفعلي.

---

### 4.3 شاشة الطلبات (Orders)

**الغرض:** عرض طلبات الشحن التي يعالجها الـ Agent فقط — لا تُعرض Regular Orders أو Gemini/service orders.

**Filters:** الكل — جاري الفحص — مؤكد — مرفوض — مكرر — يحتاج مراجعة — Offline/Pending Sync — حسب Provider — حسب المبلغ — حسب التاريخ — حسب المصدر

**ملاحظة:** عند الانتقال من Dashboard بالضغط على Card إحصائية، يُفعَّل الفلتر المقابل تلقائياً.

**Search:** Order ID، رقم المرسل، رقم العملية

**Sort:** الأحدث / الأقدم

**بيانات كل Card:** order_id، amount، sender_phone، sender_name (إن وُجد)، Provider، status، وقت الطلب، آخر فحص

---

### 4.4 شاشة تفاصيل الطلب (Order Details)

**البيانات المعروضة:**
- Original Order Data (Raw Order محفوظ من الخادم) منفصلة عن Verified fields
- Verified Payment Data: order_id، customer/user، payment_method، provider، amount، sender_phone، receiver_phone، sender_name، transaction_id، transaction_reference، order_created_at، message_received_at، service/type
- Comparison Checks: نتيجة كل خطوة من خطوات التحقق
- rejection_reason أو duplicate_reason عند الانطباق
- Raw SMS كـ Evidence مرتبطة بالـ Parsed Fields (بدون تعديل)
- سجل زمني (Timeline) لكل الأحداث

**Timeline:**
Order Received → Message Search → Message Matched → Provider Verified → Amount Verified → Sender Verified → Receiver Verified → Transaction ID Verified → Timestamp Verified → Duplicate Check → Verification Complete → Confirm/Reject → Sync Complete

---

### 4.5 شاشة مصادر الدفع (Payment Sources)

#### 4.5.1 قائمة Providers

**Providers المدعومة:** Vodafone Cash، Orange Cash، InstaPay، Bank Transfer (Architecture جاهزة)، وأي Provider يدعمه الخادم مستقبلاً.

**الحالة الافتراضية:** غير موثق / UNVERIFIED لكل Provider.

**بيانات كل Provider:**
- اسم Provider ووصفه
- حالة التوثيق: UNVERIFIED / DISCOVERING / SELECTED / VERIFYING / VERIFIED / FAILED
- المصدر الموثق (Source ID / Sender Address) إن وُجد
- آخر رسالة مكتشفة (ملخص)
- عدد الرسائل المقروءة / المطابقة / المرفوضة / يحتاج مراجعة
- آخر توثيق ناجح
- زر «إضافة مصدر رسائل» أو «إعادة فحص» أو «إلغاء التوثيق» حسب الحالة

**قاعدة العرض:** أي Provider بدون verified=true + source config صحيحة + successful verification في SQLite يُعرض «غير موثق».

#### 4.5.2 تفاصيل Provider

**البيانات:**
- Provider ID، اسم Provider، نوع الخدمة
- حالة التوثيق الحالية مع وصف واضح
- Source ID / Sender Address الموثق
- Source metadata: نوع المصدر، عدد الرسائل، آخر وقت وصول
- Parser version المستخدم
- آخر رسالة مكتشفة (Raw SMS بدون تعديل)
- آخر مطابقة ناجحة / آخر رفض
- تاريخ آخر توثيق ناجح
- Receiving account / wallet
- Approved sender/origin identifiers

**الأزرار:**
- «إضافة مصدر رسائل»: يفتح شاشة اكتشاف واختيار مصادر SMS
- «إعادة فحص المصدر»: يعيد Source Discovery من جديد
- «إلغاء التوثيق»: يلغي التوثيق الحالي
- «Provider Test Mode»: يعرض نتائج تحليل رسالة دون إرسال بيانات للخادم

#### 4.5.3 شاشة اكتشاف واختيار مصادر SMS [جديد]

**الغرض:** تتيح للمستخدم استعراض رسائل SMS المخزنة على الجهاز، واكتشاف الأرقام/المعرفات التي ترسل رسائل مالية، وتصفيتها حسب مزود الخدمة، واختيار المصادر الموثوقة لتسجيلها في قاعدة البيانات.

**المشغّل:** الضغط على «إضافة مصدر رسائل» أو «إعادة فحص» من شاشة تفاصيل Provider.

**1. التحقق من صلاحية READ_SMS:**
- عند فتح الشاشة: التحقق من منح صلاحية READ_SMS
- إذا لم تكن ممنوحة: عرض شاشة توضيحية تشرح سبب الحاجة للصلاحية مع زر «منح الصلاحية»
- إذا رُفض الإذن نهائياً (Permanently Denied): عرض رسالة واضحة + زر مباشر لإعدادات Android، إيقاف التدفق
- دعم وضع عدم الاتصال: استعراض الرسائل المحلية المتاحة بدون الحاجة لخادم

**2. قراءة وعرض رسائل SMS:**
- قراءة بيانات الرسائل من Android SMS Provider (sender/address, body, date, thread)
- لا تُعامَل SMS كملفات خارجية؛ تُعرض فقط البيانات الفعلية من Android SMS Provider
- عرض قائمة برسائل SMS تحتوي لكل رسالة:
  - رقم/معرّف المرسل (Sender Address)
  - معاينة محتوى الرسالة (أول سطر أو أول 80 حرفاً)
  - وقت الاستلام
  - Provider المكتشف (إن أمكن تحديده)
  - مؤشر احتمالية المصدر المالي (مرتفع / متوسط / منخفض)

**3. الاكتشاف الذكي وترتيب الرسائل:**
- ترتيب الرسائل حسب احتمالية كونها من مصدر مالي باستخدام قواعد بسيطة مبنية على مفاتيح محتوى كل Provider:
  - Vodafone Cash: كلمات مثل «تم استلام مبلغ»، «محفظتك»، «رصيدك الحالي»، «رقم العملية»
  - Orange Cash: مفاتيح محتوى Orange Cash المتاحة في المشروع
  - InstaPay: مفاتيح محتوى InstaPay المتاحة في المشروع
  - Bank Transfer: مفاتيح محتوى التحويل البنكي
- الرسائل ذات الاحتمالية المرتفعة تظهر أولاً
- تجميع المصادر الفريدة (Sender Address) وعرض عدد الرسائل لكل مصدر

**4. التصفية حسب Provider:**
- شريط تصفية في أعلى الشاشة يحتوي على:
  - كل المصادر
  - Vodafone Cash
  - Orange Cash
  - InstaPay
  - Bank Transfer
- عند اختيار Provider: تُعرض فقط الرسائل التي تطابق مفاتيح محتوى ذلك Provider
- زر «إعادة فحص»: يعيد قراءة Android SMS Provider وتحديث القائمة

**5. بيانات كل مصدر في القائمة:**
- اسم/رقم المرسل (Sender Address)
- نوع المصدر (SMS Sender / Short Code / Application)
- عدد الرسائل المتاحة من هذا المصدر
- آخر رسالة (معاينة أول سطر)
- آخر وقت وصول
- Provider المكتشف تلقائياً (إن أمكن)
- مؤشر احتمالية المصدر المالي
- زر «اختيار» أو «إضافة يدوياً» (للمصادر غير المكتشفة تلقائياً)

**6. اختيار المصدر والموافقة عليه:**
- عند الضغط على «اختيار»: عرض نافذة تأكيد تحتوي على:
  - Sender Address المختار
  - Provider المرتبط به
  - عدد الرسائل المتاحة
  - معاينة آخر رسالة (Raw SMS بدون تعديل)
  - زر «تأكيد الاختيار» وزر «إلغاء»
- عند التأكيد: الحالة → SELECTED وتبدأ Source Verification تلقائياً
- الاختيار وحده لا يعني التوثيق

**7. الإضافة اليدوية للمصدر:**
- زر «إضافة مصدر يدوياً» في أسفل الشاشة
- نموذج يحتوي على:
  - حقل Sender Address (رقم أو معرّف)
  - اختيار Provider من قائمة (Vodafone Cash / Orange Cash / InstaPay / Bank Transfer)
  - زر «إضافة»
- بعد الإضافة اليدوية: تبدأ Source Verification تلقائياً على المصدر المُدخَل

**8. تحديث قاعدة البيانات (provider_sources):**
عند نجاح Source Verification يُحفظ في SQLite (جدول provider_sources):
- provider_id، provider_name، service_type
- source_id (Sender Address)
- source_metadata
- parser_version
- enabled = true، verified = true
- last_verification_at، last_verification_result = VERIFIED
- last_message_at، last_message_summary
- receiving_account، approved_sender_identifiers، message_patterns

البيانات تبقى بعد إعادة تشغيل التطبيق أو الجهاز.

**9. تصميم الشاشة:**
- تصميم Minimal: فراغات واضحة، تدرج هرمي بالخط، ألوان محدودة
- واجهة المستخدم باللغة العربية بالكامل
- حالات الشاشة: تحميل الرسائل، قائمة فارغة (لم يُعثر على رسائل مع نص توضيحي)، قائمة بنتائج، خطأ في الصلاحية

#### 4.5.4 توثيق المصدر (Source Verification)

**حالات التوثيق:** DISCOVERING → SELECTED → VERIFYING → VERIFIED أو FAILED

**خطوات التوثيق:**
1. تشغيل Provider Parser الخاص على عدة رسائل من المصدر المختار
2. التحقق من استخراج الحقول المتوقعة: amount، sender، recipient، transaction_id/reference، date/time
3. التحقق من تطابق صيغة الرسائل مع قواعد Provider
4. إذا نجح التحقق: الحالة → VERIFIED
5. إذا فشل: الحالة → FAILED مع سبب الفشل وتفاصيل الحقول التي لم تُستخرج

#### 4.5.5 إلغاء التوثيق

- verified = false، source config = null في SQLite
- SMS Reader يتوقف فوراً عن استخدام هذا المصدر
- حالة Provider → UNVERIFIED
- لا تُحذف المعاملات السابقة
- لا يرث أي توثيق جديد بيانات التوثيق القديم

#### 4.5.6 Provider Test Mode

**المعروض:** Detected Provider، Parsed Amount، Sender، Recipient، Transaction ID/Reference، Date، Time، Balance (إن وُجد)، Confidence، Validation Errors.

**قاعدة صارمة:** لا يُرسَل أي شيء إلى الخادم في هذا الوضع.

#### 4.5.7 Live Status لكل Provider

- حالة المصدر الحالية (VERIFIED / UNVERIFIED / FAILED)
- حالة SMS Reader لهذا Provider
- حالة Parser
- آخر رسالة مستلمة
- آخر مطابقة ناجحة
- آخر رفض مع السبب
- عداد الرسائل الواردة في الجلسة الحالية

---

### 4.6 شاشة ملفات الخادم (Server Profiles)

**لكل Profile:** اسم Profile، Base URL، API Key/Token، نوع المصادقة، حالة الاتصال، آخر مزامنة ناجحة، Endpoints المكتشفة (قسم Advanced للعرض فقط).

**الأزرار:** Connect / Test Connection، Auto Discovery، تعيين كـ Active Profile، حذف Profile.

**إضافة Profile جديد:**
Authenticate → Discover Config → Validate API Contract → Register Device → Start Realtime أو Polling → Fetch Pending Orders → Start Sync Engine

**ممنوع إضافة:** Service Role Key، Webhook Secret، Database Password، Telegram Token، Nader Pay API Key.

---

### 4.7 شاشة الإعدادات (Settings)

**أقسام:**
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

**قسم التشخيص — أقسام:**
System، Permissions، SMS، Payment Sources، Backend، Realtime، Notifications، Background، Database، Device، Orders.

**لكل قسم:** حالة (OK / Warning / Error / Checking)، السبب، آخر فحص، الإجراء الموصى به، زر إصلاح إن أمكن، تفاصيل تقنية.

**بيانات System:** Device Model، Android Version، App Version، Device ID (بشكل آمن)، Backend URL (مختصر).

**بيانات Connection:** HTTP status، endpoint، method، response body، request ID، authentication state، last successful connection، last successful sync.

**بيانات Realtime:** حالة Realtime، retry count.

**بيانات Providers:** Message Source Verification status لكل Provider، Parser status.

**أزرار التشخيص:** Test Connection، Test SMS Parser، Test Background Agent، Run Sync، Refresh Orders.

---

## 5. منطق الأعمال والقواعد

### 5.1 المرحلة A — Audit الكامل

قبل أي تعديل: فحص شامل للمشروع يشمل:
- هيكل المشروع، entry points، navigation، screens، components
- state management، networking، Supabase configuration، API contracts
- Realtime، polling، device registration، authentication، permissions
- SMS listeners/receivers، Provider architecture، source configuration، parsers
- Verification Engine، SQLite/local DB، migrations، Local Queue، Sync Engine
- Foreground Service، WorkManager، boot/startup، network callbacks
- notifications، diagnostics، logs، errors، retry/idempotency
- locks/mutexes، uniqueness constraints، dashboard status calculations
- AndroidManifest، app.json، Gradle، TypeScript/JavaScript configuration، tests

**مصفوفة Audit الداخلية:**
Feature | Existing implementation | Working? | Reusable? | Broken? | Required change | Risk

---

### 5.2 المرحلة B — الاستقرار أولاً

**الأخطاء المطلوب إصلاحها:**
- NativeStatement.getColumnNamesAsync rejected — released/disposed object reused
- Cannot use shared object that was already released
- NativeDatabase.execAsync rejected — transaction inside another transaction
- poll_error
- concurrent SQLite writes
- duplicate sync/poll jobs
- duplicate listeners/realtime subscriptions
- foreground/background lifecycle races
- resource leaks
- unnecessary rerenders
- stale async callbacks

**قواعد قاعدة البيانات:**
- طبقة Database Access Layer واحدة منظمة
- عدم استخدام released statements/database handles
- دورة حياة صحيحة للـ statement/cursor/resource
- منع nested transactions غير المقصودة
- تسلسل الكتابات المتعارضة بـ queue/mutex
- منع duplicate polling/sync jobs
- startup/shutdown idempotent
- إزالة listeners/subscriptions مرة واحدة فقط
- حفظ الحالة المهمة قبل الانتقال للحالة التالية
- الأخطاء تذهب إلى Diagnostics دون تعطل التطبيق

---

### 5.3 المرحلة C — Status Engine الموحد

إنشاء أو توحيد Status Engine يغطي:
Permissions، SMS Reader، Payment Source Verification، Backend، Realtime، Notifications، Background Service، Database، Device Registration.

**قاعدة صارمة:** جميع الشاشات تشتق حالتها من نفس Status Engine الفعلي. ممنوع default=true/active=true/connected=true/registered=true/synced=true لمجرد إنشاء كائن.

**Agent Smart Summary مشتق من Status Engine:**
يحسب Status Engine حالة مركّبة تجمع: حالة الاتصال + SMS Permission + عدد Providers الموثقة + حالة Background Service.

---

### 5.4 Backend Connector (محافظ عليه — لا تعديل)

- مكوّن مستقل لا يرتبط بـ Supabase أو عنوان API ثابت
- يقبل: Base URL، API Key/Token، نوع المصادقة
- يدير: الاتصال، الاكتشاف، التسجيل، المزامنة، Realtime/Polling
- لا يحتوي على أي Hardcoded Endpoint

**مثال على API Contract:**
- orders: /functions/v1/mobile-topup/orders
- receive: /functions/v1/mobile-topup/orders/{id}/receive
- verify: /functions/v1/mobile-topup/orders/{id}/verify
- confirm: /functions/v1/mobile-topup/orders/{id}/confirm
- reject: /functions/v1/mobile-topup/orders/{id}/reject
- duplicate: /functions/v1/mobile-topup/orders/{id}/duplicate
- config: /functions/v1/mobile-topup/config

---

### 5.5 Realtime (إصلاح وتحسين)

**الهدف:** تشغيل حي، ليس Polling كل دقائق.

**تدفق الطلب الجديد:**
Backend → Realtime Event → App receives event → Local persistence → Order يظهر فوراً → Notification → تحديث Dashboard counters.

**المتطلبات:**
- reconnect مع backoff
- heartbeat حيث ينطبق
- حالة الاتصال
- حماية من duplicate events بـ event IDs
- last event timestamp
- offline queue وresync بعد reconnect
- Polling كـ fallback محكوم عند عدم توفر Realtime
- لا تُنشأ بنية Realtime مكررة

---

### 5.6 نظام Source Verification — القواعد الجوهرية

#### 5.6.1 نموذج بيانات Provider في SQLite (جدول provider_sources)

- provider_id، provider_name، service_type
- source_id (Sender Address)
- source_metadata
- parser_version
- enabled (boolean)، verified (boolean)
- last_verification_at، last_verification_result
- last_message_at، last_message_summary
- receiving_account، approved_sender_identifiers، message_patterns

#### 5.6.2 قاعدة SMS Reader — مطابقة المصدر بنوع الطلب

قبل تمرير أي رسالة SMS إلى Parser:
1. التحقق من أن Provider لديه verified = true في SQLite
2. التحقق من أن source_id المسجّل يطابق Sender Address الرسالة
3. التحقق من أن نوع Provider المسجّل يطابق نوع Provider المطلوب في الطلب الحالي

القاعدة: رسالة Vodafone Cash لا تُستخدم للتحقق من طلب Orange Cash، ورسالة InstaPay لا تُستخدم للتحقق من طلب Vodafone Cash.

إذا لم يتحقق أي من الشروط الثلاثة: الرسالة → UNTRUSTED_SOURCE أو PROVIDER_MISMATCH، لا تدخل في التحقق المالي.

#### 5.6.3 استقلالية Providers

- كل Provider: إعداد مستقل، Parser خاص، Validation rules خاصة
- لا يُستخدم Parser واحد لجميع Providers
- إضافة Provider جديد لا تتطلب تغيير Backend Connector أو Verification Engine

#### 5.6.4 سجلات الرسائل المحلية

تمييز واضح بين: RAW_MESSAGE، PARSED_MESSAGE، PAYMENT_CANDIDATE، VERIFIED_PAYMENT، REJECTED_PAYMENT، REVIEW_REQUIRED.

قراءة SMS لا تعني تأكيد الدفع.

---

### 5.7 Vodafone Cash Parser

مثال الرسالة:
```
تم استلام مبلغ 100 جنيه من رقم 01091216432 المسجل بإسم Mahmoud S Rouby على رقم محفظتك 01097273680. رصيدك الحالي: 84353.90 جنيه. تاريخ العملية: 22:28 26-08-26. رقم العملية: 023080824104
```

يستخرج: amount، currency=EGP، sender_phone، sender_name، recipient_phone، balance_after، transaction_time، transaction_date، transaction_id، raw_sms.

Parser مرن تجاه المسافات والأرقام العربية/الإنجليزية والفواصل واختلافات الصياغة، مع تحقق صارم للحقول الأساسية.

---

### 5.8 Orange Cash Parser

- Parser مستقل لـ Orange Cash
- يستخرج: amount، sender، recipient/account، transaction reference، date/time، balance عند وجوده، raw SMS
- لا يُعدَّل Vodafone parser للتعامل مع Orange
- يُبنى بناءً على الرسائل الحقيقية المتاحة في المشروع

---

### 5.9 InstaPay Parser

- Parser مستقل لـ InstaPay
- لا يستخدم Regex Vodafone
- يستخرج: transaction/reference ID، amount، sender/account، destination، timestamp، raw SMS، identifiers بنكية متاحة
- قابل لإضافة templates جديدة

---

### 5.10 SMS Reader وLocal Transaction Ledger

**مسار معالجة SMS المحدَّث:**
Capture locally → حفظ Raw SMS كما وصلت → timestamp الحقيقي → Source Validation → Provider Type Matching → إذا UNTRUSTED_SOURCE أو PROVIDER_MISMATCH: تسجيل وإيقاف → Provider Detection → Provider Parser → Validation → Local Ledger → Matching

**Local Transaction Ledger:**
Raw SMS، Provider، Source، Source Verification Status، Provider Match Status، Received At، Parsed Amount، Sender، Receiver، Transaction ID، Transaction Reference، Parsing Status، Verification Status، Matched Order ID، Duplicate Status.

**قواعد:**
- لا تُخزَّن رسائل غير مرتبطة
- لا تعتمد على Raw SMS وحدها لإثبات الدفع
- لا ترفع كل رسائل الهاتف للخادم
- SMS Listener يستقبل أحداث SMS الجديدة بدل إعادة قراءة كل الرسائل
- يقرأ رسائل Vodafone Cash وOrange Cash وInstaPay فقط من مصادر موثقة ومطابقة لنوع Provider الطلب

---

### 5.11 Order ↔ SMS Matching (محافظ عليه)

- عند وصول Order: البحث أولاً في Local Transaction Ledger
- إذا لم توجد رسالة مناسبة: انتظار ضمن نافذة الوقت
- عند وجود Match: ربطها بالطلب واستكمال الحقول الناقصة
- الاحتفاظ بـ Original Order fields منفصلة عن Verified fields

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

### 5.12 Verification Pipeline (محافظ عليه — لا تعديل)

```
RECEIVED → SCANNING → MESSAGE_FOUND → SOURCE_VERIFIED → PROVIDER_VERIFIED
→ AMOUNT_VERIFIED → SENDER_VERIFIED → RECEIVER_VERIFIED → TRANSACTION_VERIFIED
→ DUPLICATE_CHECK → VERIFIED → CONFIRMED
```

بدائل: REJECTED، DUPLICATE، NEEDS_REVIEW

**Anti-Fraud / Anti-Replay:**
- Required checks: Provider، Receiver، Amount، Sender، Transaction ID/Reference، Timestamp، Source، Duplicate Status
- Backend هو المصدر النهائي للتأكيد
- نفس transaction_id لا يستخدم لأكثر من Order
- نفس Order لا يؤكد مرتين
- Idempotency Keys لكل عملية Confirm

---

### 5.13 Order State Machine (محافظ عليه)

```
NEW → QUEUED → SCANNING → MATCHED → VERIFYING → CONFIRMED
NEW → QUEUED → SCANNING → NOT_FOUND/WAITING → إعادة الفحص → EXPIRED
NEW → QUEUED → SCANNING → REVIEW_REQUIRED
NEW → QUEUED → SCANNING → REJECTED
```

---

### 5.14 Transaction Deduplication (محافظ عليه)

- Composite Key: order_id + provider + transaction_id + amount + receiver
- قبل Confirm: تحقق Local DB ثم Server-side
- Idempotency Key مناسبة لكل عملية Confirm
- الخادم هو المصدر النهائي لمنع التأكيد المكرر

---

### 5.15 نظام الإشعارات الموحد

**إصلاح زر Bell الموجود في Header.**

**Notification Center يحتوي:**
طلبات جديدة، نتائج التحقق، أخطاء الاتصال، أخطاء SMS، مشاكل الصلاحيات، مشاكل Backend، إشعارات النظام.

**لكل إشعار:** title، body، timestamp، type، read/unread، related order/provider، deep link حيث ينطبق.

| الحدث | الرسالة |
|---|---|
| New order | طلب شحن جديد يحتاج للفحص |
| Scan started | بدأ فحص الطلب |
| SMS found | تم العثور على معاملة مطابقة |
| Confirmed | تم تأكيد الطلب |
| Review | طلب يحتاج مراجعة يدوية |
| Rejected | تم رفض الطلب + السبب |
| Duplicate | تم رصد معاملة مكررة |
| Offline | تم فقد الاتصال — الطلبات محفوظة |
| Online | تم استعادة الاتصال ومزامنة الطلبات |
| Sync error | مشكلة في المزامنة |
| Source verified | تم توثيق مصدر Provider بنجاح |
| Source verification failed | فشل توثيق مصدر Provider + السبب |

**قواعد:** منع تكرار نفس الإشعار بـ event/idempotency ID. ممنوع عرض API keys أو credentials في الإشعارات.

---

### 5.16 Permission Manager الموحد

- Permission Manager واحد — لا حالات متعارضة عبر الشاشات
- الصلاحيات المطلوبة في AndroidManifest وapp.json:
  - READ_SMS
  - RECEIVE_SMS
  - POST_NOTIFICATIONS (Android 13+)
  - FOREGROUND_SERVICE
  - RECEIVE_BOOT_COMPLETED
  - REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
  - INTERNET
  - ACCESS_NETWORK_STATE
- مراجعة app.json والتأكد من إدراج جميع الصلاحيات المذكورة أعلاه
- لا تُطلب صلاحيات غير ضرورية
- الحالات: Granted، Denied، Permanently Denied، Restricted، Not Required
- توجيه مباشر لإعدادات Android عند الرفض
- POST_NOTIFICATIONS تُطلب في Runtime على Android 13+ مع شرح واضح للمستخدم

---

### 5.17 وضع عدم الاتصال (Offline-First) — تعزيز

**التخزين المحلي عند Offline:**
- حفظ جميع القراءات المحلية (SMS المستلمة، نتائج Parsing، حالات التحقق) في SQLite فور حدوثها
- حفظ وقت استلام SMS الفعلي بدقة
- حفظ حالة Source Verification لكل Provider
- حفظ Pending Orders وScan State وVerification Results وSync Queue
- شاشة اكتشاف واختيار مصادر SMS تعمل بالكامل بدون اتصال بالخادم

**قائمة انتظار الإجراءات (Offline Action Queue):**
- كل إجراء يتطلب اتصالاً بالخادم (Confirm، Reject، Sync) يُضاف إلى Offline Queue محلياً
- كل عنصر في Queue يحمل: action_type، payload، idempotency_key، created_at، retry_count
- Queue تُعرض في Dashboard ضمن إحصائية «Offline Queue»

**إعادة المزامنة التلقائية عند استعادة الاتصال:**
- Network callback يُشغّل مسار المصالحة فور استعادة الاتصال
- مسار المصالحة: Reconnect → تحقق Device Registration → Fetch Pending Orders → Reconcile Local Queue → Match Local Transactions → Sync Results → تحديث Last Sync
- كل عنصر في Queue يُعالَج بترتيب FIFO مع exponential backoff عند الفشل
- عند فشل Sync بعد عدد محدد من المحاولات: تصنيف العنصر SYNC_FAILED وإظهاره في Diagnostics

**قاعدة الصلاحية الزمنية Offline:**
- SMS التي تصل أثناء Offline تُسجَّل محلياً مع وقت الاستلام الفعلي وتُطابَق عند الاتصال
- نافذة البحث لا تتجاوز 24 ساعة من timestamp الطلب وفق سياسة الخادم

---

### 5.18 Live Synchronization (محافظ عليه)

- Realtime كقناة أساسية
- Polling كـ fallback محكوم عند عدم توفر Realtime

**مسار عودة الاتصال:**
Reconnect → تحقق Device Registration → Fetch Pending Orders → Reconcile Local Queue → Match Local Transactions → Sync Results → تحديث Last Sync

---

### 5.19 Background Agent (محافظ عليه)

- Foreground Service للمراقبة المستمرة
- WorkManager للمهام المؤجلة
- Network callbacks للمصالحة عند استعادة الاتصال
- Boot Receiver: عند تشغيل الهاتف يبدأ في الخلفية، يتحقق من الشبكة، يعيد تشغيل Realtime، يزامن Pending Queue
- التعامل مع Doze وBattery/OEM restrictions
- منع duplicate workers
- retry آمن مع exponential backoff

**أزرار Agent الفعلية:**
- تشغيل الوكيل: التحقق من المتطلبات، بدء الخدمات، Realtime، SMS monitoring، Notifications، Sync
- مسح SMS: إعادة فحص/مصالحة SMS المتاحة محلياً
- تحديث الحالة: Health Check فعلي
- تشخيص مفصل: فتح Diagnostics بنتائج حقيقية

**قاعدة:** جميع أزرار Agent تنفذ إجراءات فعلية وليست وهمية.

---

### 5.20 Activity / Diagnostics Log

**مستويات:** INFO، SUCCESS، WARNING، ERROR، CRITICAL

**الحقول:** timestamp، module، event، user-readable message، technical details، related Order/Provider.

**أحداث Source Verification المضافة:**
- Source discovery started
- Sources discovered (count)
- Source selected (masked source_id)
- Source verification started
- Source verification passed
- Source verification failed (reason)
- Source revoked
- SMS from untrusted source blocked
- SMS provider mismatch blocked
- Manual source added (masked source_id)

**ممنوع تسجيل:** API keys، Anon Key، passwords، secrets، authorization headers، raw credentials، raw SMS حساسة.

---

### 5.21 Device Registration (محافظ عليه)

- حالة موحدة: Registered/Not Registered، Device ID، Last Registration، Last Heartbeat
- لا تعيد التسجيل دون ضرورة
- لا تعرض credentials في UI أو logs

---

### 5.22 Order Normalizer (محافظ عليه)

النموذج الداخلي: order_id، customer/user، payment_method، provider، amount، sender_phone، receiver_phone، sender_name، transaction_id، transaction_reference، order_created_at، message_received_at، service/type، raw_order، raw_sms، status.

يحتفظ بالـ Raw Payload كاملاً. الحقول الغائبة لا تُعتبر خطأ تلقائياً.

---

## 6. متطلبات الأمان

- لا توضع Service Role Key أو database password أو private backend secret في التطبيق أو APK أو repository
- أي authorization حساس يتحقق server-side
- Secure local storage للـ credentials (Android Keystore للأسرار التي تستوجب ذلك)
- HTTPS/TLS إلزامي
- Logs آمنة لا تظهر credentials أو SMS حساسة
- Minimal SMS handling: لا تُرفع SMS غير الضرورية
- لا تعرض أسرار API أو Tokens كاملة في أي شاشة
- Source ID / Sender Address لا يُعرض كاملاً في Logs
- مراجعة: API keys في الكود، secrets في logs، credentials في insecure storage، replay vulnerabilities، duplicate confirmation، race conditions

---

## 7. الحالات الاستثنائية والحدود

| الحالة | السلوك المتوقع |
|---|---|
| Provider بدون verified source | يُعرض «غير موثق»، SMS Reader لا يستخدمه |
| SMS من مصدر غير موثق | UNTRUSTED_SOURCE، لا تدخل في التحقق المالي |
| SMS من مصدر موثق لكن Provider مختلف عن الطلب | PROVIDER_MISMATCH، لا تدخل في التحقق المالي |
| SMS Permission مرفوضة | رسالة واضحة + زر إعداد Android، إيقاف التدفق |
| SMS Permission مرفوضة نهائياً في شاشة الاكتشاف | رسالة واضحة + زر مباشر لإعدادات Android، إيقاف التدفق |
| POST_NOTIFICATIONS مرفوضة | عرض تحذير في Diagnostics، الإشعارات لا تعمل |
| لا توجد رسائل من Provider | عرض «لم يُعثر على رسائل» مع نص توضيحي |
| Parser يفشل في استخراج الحقول | حالة FAILED مع تفاصيل الحقول الناقصة |
| مصدر يطابق أكثر من Provider | يُعرض للمستخدم لاختيار Provider المناسب |
| إعادة توثيق مصدر | إلغاء القديم أولاً، لا يرث الجديد بيانات القديم |
| إلغاء توثيق أثناء معالجة Order | Order الجاري يكمل دورته، الطلبات الجديدة لا تستخدم المصدر الملغى |
| Crash أثناء Source Verification | عند الاستئناف: حالة FAILED، يطلب إعادة التوثيق |
| Provider Test Mode | لا يُرسَل أي شيء للخادم |
| verified=true بدون source config صحيحة | يُعامَل كـ UNVERIFIED |
| API Key خاطئ | عرض خطأ 401 مع التفاصيل في Diagnostics |
| Backend غير متاح | عرض آخر خطأ في Home وإعادة المحاولة بـ exponential backoff |
| Internet disconnected | حفظ الحالة محلياً، إضافة الإجراءات لـ Offline Queue، إعادة المزامنة تلقائياً عند الاتصال |
| Offline Queue ممتلئة | عرض عدد العناصر في Dashboard، معالجة بترتيب FIFO عند الاتصال |
| Sync فاشل بعد عدة محاولات | تصنيف SYNC_FAILED وإظهاره في Diagnostics |
| App restarted | استئناف المعالجة من الحالة المحفوظة بما فيها Source Verification State |
| Device restarted | Boot Receiver يبدأ Agent في الخلفية |
| Realtime غير متاح | Fallback تلقائي إلى Polling |
| Duplicate transaction | رفض مع سبب واضح |
| Regular Order يدخل queue | استبعاده فوراً عبر discriminator |
| حالة Connected بدون Sync فعلي | ممنوع — Status مشتق من حالة فعلية فقط |
| SQLite released object | إصلاح دورة حياة الـ statement، منع الاستخدام بعد التحرير |
| Nested transaction | منع بـ queue/mutex، تسلسل الكتابات |
| الضغط على Card إحصائية في Dashboard | الانتقال لشاشة Orders مع تفعيل الفلتر المقابل تلقائياً |
| مصدر مُضاف يدوياً لا تجد له رسائل | Source Verification تُشغَّل وتُعيد FAILED مع سبب واضح |
| شاشة الاكتشاف في وضع Offline | عرض الرسائل المحلية المتاحة بدون الحاجة لخادم |

---

## 8. خطة التنفيذ التدريجية

### المرحلة A — Audit الكامل
1. فحص شامل للمشروع وإنشاء مصفوفة Audit الداخلية
2. تحديد: ما يعمل، ما هو جزئي، ما هو مزيف، ما هو معطوب، ما هو مكرر، ما هو متعارض
3. التحقق من اكتمال تنفيذ Phase I السابقة وتوثيق أي ثغرات

### المرحلة B — الاستقرار
1. إصلاح SQLite lifecycle: released objects، nested transactions، concurrent writes
2. إصلاح duplicate polling/sync jobs
3. إصلاح duplicate listeners/realtime subscriptions
4. إصلاح foreground/background lifecycle races وresource leaks
5. إصلاح stale async callbacks وunnecessary rerenders

**التحقق:** typecheck، lint، build، unit tests لـ Database Layer

### المرحلة C — Status Engine الموحد
1. إنشاء أو توحيد Status Engine
2. إنشاء Permission Manager الموحد
3. مراجعة app.json وإضافة الصلاحيات الناقصة
4. تحديث جميع الشاشات لتشتق حالتها من Status Engine
5. إزالة جميع الحالات الافتراضية الإيجابية الزائفة
6. بناء Agent Smart Summary المشتق من Status Engine

### المرحلة D — Provider Sources
1. تحديث نموذج بيانات Provider في SQLite (جدول provider_sources)
2. إصلاح الحالة الحالية: أي Provider بدون verified=true يُعرض «غير موثق»
3. تطوير شاشة اكتشاف واختيار مصادر SMS [جديد]:
   - التحقق من صلاحية READ_SMS وتوجيه المستخدم
   - قراءة Android SMS Provider وعرض القائمة
   - تطوير منطق الاكتشاف الذكي وترتيب الرسائل حسب احتمالية المصدر المالي
   - تطوير شريط التصفية حسب Provider
   - تطوير تدفق الاختيار والتأكيد
   - تطوير نموذج الإضافة اليدوية
   - دعم وضع عدم الاتصال
4. تطوير Source Verification Engine
5. حفظ نتيجة التوثيق في SQLite (جدول provider_sources)
6. تحديث SMS Reader: إضافة Source Validation + Provider Type Matching
7. تسجيل UNTRUSTED_SOURCE وPROVIDER_MISMATCH في Local Transaction Ledger

**التحقق:** unit tests لـ Source Verification Engine، SMS Reader tests، اختبار شاشة الاكتشاف

### المرحلة E — Backend/Realtime
1. مراجعة وإعادة استخدام Backend Connector الموجود
2. إصلاح Realtime: تشغيل حي، reconnect مع backoff، event deduplication
3. Polling كـ fallback محكوم
4. إصلاح مسار عودة الاتصال

### المرحلة F — Offline Queue التعزيز
1. تعزيز Offline Action Queue: هيكل البيانات، idempotency_key، retry_count
2. تطوير مسار إعادة المزامنة التلقائية عند استعادة الاتصال
3. معالجة SYNC_FAILED وعرضه في Diagnostics
4. التحقق من صحة وقت استلام SMS المحفوظ محلياً عند المطابقة بعد Offline

### المرحلة G — Notifications
1. إصلاح زر Bell وNotification Center
2. إصلاح Android notifications مع مراعاة POST_NOTIFICATIONS على Android 13+
3. event deduplication بـ idempotency ID
4. إضافة إشعارات Source Verified / Source Verification Failed

### المرحلة H — Dashboard التفاعلي
1. تحويل Cards إحصائيات الطلبات إلى عناصر قابلة للضغط
2. تطوير التنقل من Dashboard إلى Orders مع تمرير الفلتر المحدد
3. تطوير Agent Smart Summary في Dashboard
4. التأكد من تحديث Counters فورياً عند وصول Realtime events

### المرحلة I — Agent Services
1. التحقق من اكتمال تنفيذ Phase I السابقة لخدمات Agent
2. إصلاح أزرار Agent لتكون فعلية
3. إصلاح SMS lifecycle
4. إصلاح Background Agent وBoot Receiver

### المرحلة J — Orders/Diagnostics
1. تحديث شاشة Orders: filters، search، details، timeline
2. دعم تفعيل الفلتر تلقائياً عند الانتقال من Dashboard
3. تحديث Diagnostics: أقسام حقيقية بحالات فعلية
4. تحديث Activity Log بأحداث PROVIDER_MISMATCH والأحداث الجديدة لشاشة الاكتشاف

### المرحلة K — Validation
1. تنفيذ مصفوفة الاختبارات الكاملة
2. Android build وRelease APK/AAB
3. Runtime validation
4. تحديث NADERPAY_AGENT_ARCHITECTURE.md وdocs/prd.md

---

## 9. الاختبارات الإلزامية

### A — التطبيق
أول تشغيل، تحميل الإعداد، إعادة التشغيل، إعادة تشغيل الجهاز.

### B — الصلاحيات
SMS مرفوضة/ممنوحة، POST_NOTIFICATIONS مرفوضة/ممنوحة، قيود الخلفية، تغيير الصلاحيات.

### C — Provider
اكتشاف، اختيار، توثيق ناجح/فاشل، مصدر غير موثق/موثق، إلغاء، إعادة توثيق، Provider Type Mismatch.

### D — SMS
حدث جديد، SMS مكررة، Parser ناجح/فاشل، رسالة غير مدعومة، معاملة صحيحة/مكررة، SMS من Provider مختلف عن الطلب.

### E — Backend
متصل، منقطع، غير مصرح، timeout، خطأ خادم، retry.

### F — Realtime
متصل، Order جديد، حدث مكرر، انقطاع، إعادة اتصال، resync، Polling fallback.

### G — Notifications
طلب جديد، تحقق، رفض، معاملة مكررة، خطأ اتصال، عدد غير مقروء، تحديد كمقروء، deep link، منع تكرار الحدث، POST_NOTIFICATIONS على Android 13+.

### H — Database
عمليات متزامنة، SQLite transaction safety، statement lifecycle، released-object protection، migration، recovery بعد restart.

### I — Orders
طلب حي، تفاصيل، تحديث حالة، Provider filter، بحث، ترتيب، pending sync، تفعيل الفلتر تلقائياً من Dashboard.

### J — Dashboard التفاعلي
الضغط على كل Card إحصائية والتحقق من الانتقال لشاشة Orders مع الفلتر الصحيح، تحديث Counters فورياً، عرض Agent Smart Summary الصحيح.

### K — Offline
انقطاع الاتصال أثناء معالجة Order، حفظ SMS محلياً، إضافة إجراءات لـ Offline Queue، إعادة المزامنة التلقائية عند الاتصال، SYNC_FAILED بعد عدة محاولات.

### L — شاشة اكتشاف واختيار مصادر SMS [جديد]
- فتح الشاشة مع صلاحية READ_SMS ممنوحة: عرض قائمة الرسائل
- فتح الشاشة بدون صلاحية: عرض شاشة طلب الصلاحية
- رفض الصلاحية نهائياً: عرض رسالة + زر إعدادات Android
- التصفية حسب كل Provider: عرض الرسائل المطابقة فقط
- الاكتشاف الذكي: ترتيب الرسائل حسب الاحتمالية
- اختيار مصدر والتأكيد: بدء Source Verification تلقائياً
- إضافة مصدر يدوياً: بدء Source Verification على المصدر المُدخَل
- وضع Offline: عرض الرسائل المحلية بدون خادم
- مصدر مُضاف يدوياً بدون رسائل مطابقة: FAILED مع سبب واضح
- حفظ نتيجة التوثيق في جدول provider_sources

### M — End-to-End
Nader AI ينشئ طلب شحن → Agent يستلم → Realtime فوري → إشعار → مصدر موثق ومطابق لنوع Provider الطلب → SMS مستلمة → تحليل → فحوصات مطلوبة → فحص تكرار → تأكيد → Sync إلى Nader AI → تحديث counters/status → لا تأكيد مكرر.

**قاعدة الإبلاغ:** إذا لم يمكن تشغيل اختبار بسبب عدم توفر الجهاز/البيئة يُصنَّف NOT RUN أو BLOCKED — لا يُدَّعى PASS.

---

## 10. التوثيق المطلوب

**docs/prd.md** — وثيقة المتطلبات الكاملة (هذا الملف)

**NADERPAY_AGENT_ARCHITECTURE.md** يشمل:
- Architecture وGeneric Backend Connector
- API Discovery وServer Profiles
- Device registration وpolling/realtime
- Request filtering وOrder contract
- Order Normalizer والنموذج الداخلي الموحد
- Provider architecture وparsers
- Source Verification System: نموذج البيانات (جدول provider_sources)، تدفق التوثيق، قواعد SMS Reader، Provider Type Matching
- شاشة اكتشاف واختيار مصادر SMS: تدفق الاكتشاف، منطق الترتيب الذكي، الإضافة اليدوية، دعم Offline
- Verification rules متعددة المراحل و24h time window
- Transaction uniqueness وidempotency
- Offline Queue التعزيز: هيكل البيانات، مسار إعادة المزامنة، SYNC_FAILED
- Background agent وnotifications وdiagnostics
- Permissions: قائمة كاملة، app.json، Runtime requests
- Dashboard التفاعلي: Cards إحصائيات، Agent Smart Summary
- Testing وdeployment

ممنوع توثيق Payment Gateway أو Webhook architecture.

---

## 11. معايير القبول

1. لا يوجد Provider بحالة Active/Enabled/Verified دون توثيق فعلي
2. أي Provider بدون verified=true + source config صحيحة + successful verification في SQLite يُعرض «غير موثق»
3. الصلاحيات متسقة عبر جميع الشاشات
4. SMS Reader يعالج فقط المصادر الموثقة المطابقة لنوع Provider الطلب
5. حالات Backend وRealtime حقيقية من Status Engine
6. الطلبات تصل فورياً عند توفر Realtime
7. Polling هو fallback محكوم فقط
8. Notification Center يعمل من زر Bell
9. Android notifications تعمل ضمن قواعد Android بما فيها POST_NOTIFICATIONS على Android 13+
10. Diagnostics تعكس الحالة الفعلية
11. أزرار Agent فعلية وليست وهمية
12. أخطاء SQLite transaction conflicts مُصلَحة
13. أخطاء released-object/use-after-release مُصلَحة
14. منع التكرار في المعالجة
15. تغييرات lifecycle لا تعطل التطبيق
16. Providers معزولة
17. العمليات المالية لها audit trails
18. تشابه نص SMS وحده لا يؤكد الدفع
19. الأنظمة المستقرة محفوظة دون تغيير
20. لا بنية مكررة
21. Build ناجح
22. الضغط على Card إحصائية في Dashboard ينقل لشاشة Orders مع الفلتر الصحيح
23. Agent Smart Summary يعكس الحالة الفعلية المشتقة من Status Engine
24. Offline Queue تحفظ الإجراءات وتزامنها تلقائياً عند استعادة الاتصال
25. app.json يحتوي على جميع الصلاحيات المطلوبة
26. الاختبارات مُنفَّذة ومُبلَّغ عنها بصدق
27. Runtime مُتحقَّق منه
28. جميع واجهات المستخدم باللغة العربية
29. شاشة اكتشاف واختيار مصادر SMS تعمل بالكامل في وضع Offline
30. الاكتشاف الذكي يرتب المصادر المالية أولاً بناءً على مفاتيح محتوى كل Provider
31. الإضافة اليدوية للمصدر تُشغّل Source Verification تلقائياً
32. نتيجة التوثيق تُحفظ في جدول provider_sources في SQLite
33. شاشة الاكتشاف تعرض رسالة واضحة وزر إعدادات Android عند رفض READ_SMS نهائياً

---

## 12. الوظائف غير المشمولة في هذه المرحلة

- إنشاء طلبات الشحن من داخل التطبيق
- Payment Gateway أو Payment Request creation
- Webhook dispatcher أو Webhook Secret
- Merchant API
- إدارة المستخدمين أو الحسابات
- Dashboard إحصائي متقدم
- دعم Bank Transfer كامل (Architecture جاهزة للإضافة لاحقاً)
- مزامنة Source Verification State مع الخادم
- iOS build
- SDKs رسمية
- Auto-generation لـ API Contract من جانب التطبيق