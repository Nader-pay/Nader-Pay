# وثيقة المتطلبات

## 1. نظرة عامة على التطبيق

**اسم التطبيق:** Nader Pay Agent

**وصف التطبيق:** وكيل التحقق الآلي للمدفوعات — تطبيق Android لمراقبة وتحقق التحويلات المالية عبر SMS. يعمل كـ Generic Payment Verification Agent مرتبط بـ Nader AI Backend عبر Supabase URL + Anon Key + Device Registration. يستلم طلبات الشحن، يقرأ رسائل SMS من مصادر موثقة فقط، يحلل التحويلات عبر Parsers مستقلة لكل Provider، يطابق البيانات مع الطلبات، يمنع التكرار، ثم يرسل نتيجة التحقق إلى الخادم.

**القاعدة:** التطوير فوق النسخة الحالية فقط. لا إعادة بناء من الصفر. الأنظمة المستقرة التالية لا تُعدَّل: Orders، Backend Connector، Realtime، Verification Engine، Notifications، Local Ledger، Offline Queue، API، Dashboard.

**المعمارية الثابتة:**
- Nader AI = مصدر طلبات الشحن
- Nader Pay Agent = Android Verification Agent
- الربط = Nader AI Supabase URL + Anon Key + Device Registration/Device ID
- ممنوع: Payment Gateway، Payment API، Webhook architecture جديدة، Nader Pay API Key، Webhook Secret، Service Role Key، Database Password

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
- زر «اختيار» أو «إضافة يدويّاً» (للمصادر غير المكتشفة تلقائياً)

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

**9. تصميم الشاشة:**
- تصميم Minimal: فراغات واضحة، تدرج هرمي بالخط، ألوان محدودة
- واجهة المستخدم باللغة العربية بالكامل
- حالات الشاشة: تحميل الرسائل، قائمة فارغة (لم يُعثر على رسائل مع نص توضيحي)، قائمة بنتائج، خطأ في الصلاحية

---

## 5. منطق الأعمال والقواعد

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

---

## 7. الحالات الاستثنائية والحدود

- Provider بدون verified source: يُعرض «غير موثق»، SMS Reader لا يستخدمه.
- SMS من مصدر غير موثق: UNTRUSTED_SOURCE، لا تدخل في التحقق المالي.
- SMS من مصدر موثق لكن Provider مختلف عن الطلب: PROVIDER_MISMATCH، لا تدخل في التحقق المالي.
- SMS Permission مرفوضة: رسالة واضحة + زر إعداد Android، إيقاف التدفق.
- لا توجد رسائل من Provider: عرض «لم يُعثر على رسائل» مع نص توضيحي.
- Parser يفشل في استخراج الحقول: حالة FAILED مع تفاصيل الحقول الناقصة.
- مصدر يطابق أكثر من Provider: يُعرض للمستخدم لاختيار Provider المناسب.
- Provider Test Mode: لا يُرسَل أي شيء للخادم.
- شاشة الاكتشاف في وضع Offline: عرض الرسائل المحلية المتاحة بدون خادم.

---

## 8. خطة التنفيذ التدريجية (محصورة على هذه المهمة)

1. **إنشاء/تحديث PRD** — حفظ متطلبات شاشة اكتشاف المصادر في docs/PRD.md.
2. **تصميم الشاشة** — تطبيق قالب Minimal، واجهة عربية، حالات التحميل/الفارغة/الخطأ.
3. **تطوير منطق الاكتشاف** — قراءة Android SMS، ترتيب احتمالات، تصفية حسب Provider.
4. **تطوير واجهة الشاشة** — قائمة مصادر، شريط تصفية، نافذة تأكيد، إضافة يدوية، حالات صلاحية.
5. **ربط Source Verification** — عند الاختيار/الإضافة اليدوية، تشغيل التوثيق وحفظ النتيجة في provider_sources.
6. **التحقق والاختبار** — Lint، Web/Android export، Runtime test.

---

## 9. معايير القبول

1. الشاشة تفتح من شاشة تفاصيل Provider.
2. التحقق من READ_SMS وعرض حالة مناسبة عند الرفض/الرفض النهائي.
3. عرض رسائل SMS الفعلية من الجهاز مع معاينة ووقت.
4. الاكتشاف الذكي يرتب المصادر المالية أولاً.
5. التصفية حسب Provider تعمل بشكل صحيح.
6. الاختيار يبدأ Source Verification ويحفظ النتيجة في قاعدة البيانات.
7. الإضافة اليدوية تُدخَل وتُخضَع للتوثيق.
8. الشاشة تعمل في وضع Offline باستخدام الرسائل المحلية.
9. الواجهة بالعربية، تصميم Minimal، لا أخطاء Lint/Build.
