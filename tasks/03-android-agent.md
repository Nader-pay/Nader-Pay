# المرحلة 3 — Android Agent: قراءة Evidence والعمل بالخلفية

## الهدف
بناء التطبيق الذي يعمل كـ Device Agent: يلتقط الإشعارات/المصادر المسموح بها، يحللها، يحفظها محليًا، ويرسل Evidence للسيرفر مع Offline Queue.

## المبدأ الأمني
Android لا يملك القرار النهائي.
التطبيق:
DETECT → PARSE → PRE-VALIDATE → QUEUE → SYNC

السيرفر:
VERIFY → CONFIRM/REJECT/REVIEW

## الصلاحيات
ابدأ بـ Notification Listener كمسار أساسي عندما تكون العملية ظاهرة في إشعار.

يجب:
- شرح سبب الصلاحية للمستخدم.
- شاشة Permission Setup.
- اكتشاف هل Notification Access enabled.
- إظهار الحالة بوضوح.
- عدم افتراض أن listener دائمًا يعمل.

SMS يكون Adapter منفصلًا وليس جزءًا متشابكًا مع باقي النظام، مع مراعاة متطلبات Android/Google Play وسياسات صلاحيات SMS.

## Android Architecture
استخدم طبقات:
```text
UI
Domain
Data
  Notification Source
  SMS Source
  Parser
  Local DB
  Sync Queue
  API Client
Security
```

## Notification Listener
عند وصول notification:
1. تحقق من package.
2. استخرج title/text/subText/bigText عند توفره.
3. سجل timestamp.
4. أنشئ normalized representation.
5. مرر المحتوى إلى Provider Parser.
6. إذا نجح parser، أنشئ Payment Evidence.
7. خزنه محليًا.
8. ضعه في Sync Queue.
9. أرسله للسيرفر عندما يكون الاتصال متاحًا.

## Provider Parser
لا تضع Regex داخل NotificationListener نفسه.

اعمل:
`ProviderParser`

Input:
- package
- title
- text
- timestamp

Output:
```json
{
  "provider": "vodafone_cash",
  "amount": 400,
  "sender_phone": "01030951228",
  "sender_name": "Wessam A Ahmed Ali",
  "recipient_wallet": "01097273680",
  "transaction_id": "022896233255",
  "occurred_at": "...",
  "confidence": "high"
}
```

## Vodafone Cash parser
يجب تصميم parser قابل لتغيير صيغة الرسالة دون إصدار التطبيق إذا أمكن ذلك، عبر provider configuration versioning.

لا تفترض صيغة رسالة واحدة إلى الأبد.
استخدم:
- field extraction
- normalization
- provider version
- parser tests

## Local Database
احفظ:
- evidence_id
- event_id
- raw_message
- parsed payload
- message_hash
- detected_at
- sync_status
- attempts
- last_error

## Offline Queue
الحالات:
- pending
- sending
- sent
- failed
- permanently_failed

عند رجوع الإنترنت:
- إرسال events بالترتيب.
- السيرفر idempotent.
- لا تحذف local evidence قبل تأكيد الاستلام.
- بعد success ضع sent.

## Duplicate handling على الجهاز
قبل الإرسال:
- event_id duplicate check.
- message_hash duplicate check.
- transaction_id duplicate check محليًا.

لكن هذه حماية إضافية فقط؛ القرار النهائي للسيرفر.

## Device Security
- لا تخزن API secrets بشكل plaintext.
- استخدم Android Keystore للأسرار المحلية.
- credentials قابلة للإلغاء من السيرفر.
- device binding.
- secure local storage.

## Heartbeat
أرسل حالة الجهاز دوريًا:
- online
- listener enabled
- network
- battery
- queue size
- app version

## Recovery
التطبيق يجب أن يتعامل مع:
- reboot.
- process restart.
- network loss.
- server unavailable.
- listener disconnect.
- app update.
- temporary permission loss.

لا تعتمد على foreground process واحد باعتباره ضمانًا للتشغيل الدائم.

## Notifications للمستخدم
أظهر:
- Payment detected.
- Confirmed.
- Rejected.
- Needs review.
- Sync restored.
- Device offline warning.

لا تعرض بيانات مالية حساسة في lock-screen notification إلا وفق إعداد المستخدم.

## شاشة التطبيق
### Dashboard
- System status.
- Server connection.
- Notification Access.
- Last sync.
- Queue.
- Today's detected payments.

### Activity
كل Evidence مع:
- provider
- amount
- transaction id
- time
- status

### Evidence details
اعرض الرسالة الأصلية داخل الطلب فقط للمستخدم المصرح له.

## المطلوب قبل الانتقال
- Notification Listener يعمل.
- Provider parser test suite يعمل.
- Evidence محفوظ محليًا.
- Offline queue تعمل.
- Sync recovery تعمل.
- Device heartbeat يعمل.
- Permission state واضح.
- Reboot/restart scenarios مختبرة.
