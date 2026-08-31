# قائمة الجاهزية للإنتاج

## 1. Environment

- [ ] بيئة إنتاج منفصلة عن staging.
- [ ] `EXPO_PUBLIC_SUPABASE_URL` و `EXPO_PUBLIC_SUPABASE_ANON_KEY` إنتاجية.
- [ ] Edge Functions منشورة على الإنتاج.
- [ ] app.json يشير إلى slug الإنتاج.

## 2. Secrets

- [ ] API keys و secrets في Supabase Secrets (لا في الكود).
- [ ] Secrets manager للإنتاج.
- [ ] Android keystore لـ release signing.
- [ ] Webhook secrets فريدة لكل endpoint.

## 3. TLS

- [ ] HTTPS على كل endpoint.
- [ ] TLS 1.3 مفضل.
- [ ] Certificate صالح ولا ينتهي قريبًا.

## 4. Database

- [ ] RLS مفعّل على كل الجداول.
- [ ] Backups تلقائية.
- [ ] Migrations منفذة.
- [ ] Indexes على الحقول المُستعلَمة (status, account_id, created_at).

## 5. Monitoring

- [ ] Dashboards جاهزة.
- [ ] Alerts مُفعّلة.
- [ ] Sentry يستقبل الأخطاء.
- [ ] Logs مُراجعون.

## 6. API

- [ ] API versioned (v1).
- [ ] Rate limiting مفعّل.
- [ ] HMAC + nonce + timestamp.
- [ ] API docs منشورة.

## 7. Webhooks

- [ ] توقيع webhook مفعّل.
- [ ] Retries مُعدة.
- [ ] Failed deliveries dashboard جاهز.
- [ ] Idempotency مُطبّقة.

## 8. Android

- [ ] Release build موقّع.
- [ ] ProGuard/R8 مفعّل.
- [ ] SQLCipher مفعّل.
- [ ] Notification Access flow مختبر.
- [ ] Offline queue مختبر.

## 9. Documentation

- [ ] API docs.
- [ ] Integration guide.
- [ ] Security review.
- [ ] Privacy policy.
- [ ] Terms of service.
- [ ] Runbook.

## 10. Legal / Compliance

- [ ] Privacy policy منشورة.
- [ ] Terms of service منشورة.
- [ ] موافقة المستخدم على جمع الإشعارات.
- [ ] حق الوصول/التصحيح/الحذف متاح.

## 11. Deployment Rollback

- [ ] خطة rollback للـ Edge Functions.
- [ ] خطة rollback لـ database migrations.
- [ ] خطة rollback لـ تطبيق Android.
- [ ] فريق العمليات مدرب.

## 12. Definition of Done

- [ ] موقع يُنشئ Payment Request.
- [ ] الطلب يصل للـ backend.
- [ ] الجهاز المسجل يستقبل الحدث.
- [ ] Android يلتقط Evidence.
- [ ] Parser يستخرج الحقول.
- [ ] Evidence تصل للسيرفر.
- [ ] Deduplication تعمل.
- [ ] Verification تعمل.
- [ ] الطلب يتحول لحالة نهائية.
- [ ] Webhook يصل للموقع.
- [ ] Dashboard يعرض العملية.
- [ ] نفس transaction لا يمكن استخدامها مرتين.
- [ ] Offline queue تعود للعمل بعد الاتصال.
- [ ] Audit trail كامل.
- [ ] API docs كاملة.
- [ ] اختبارات regression تعمل.
- [ ] لا توجد secrets في source code.

## 13. ملاحظة نهائية

لا يُعتبر النظام "100% مضمون" لأن مصدر الإثبات الخارجي (تطبيقات البنوك) قد يتغير أو يتوقف. الهدف الهندسي هو جعل القرار قابلًا للتدقيق، مقاومًا للتكرار/replay، وآمنًا قدر الإمكان، مع مراجعة يدوية للحالات غير الحاسمة.

## 14. Phase 4 — UI/UX, Realtime, Source Verification & Order Details

### 14.1 ما تم إنجازه

- **هوية الواجهة**: اسم التطبيق والشعار والعنوان الرئيسي “Nader Pay Agent — وكيل التحقق الآلي للمدفوعات” متوافق في `home.tsx` و `app.json`.
- **Home Dashboard**: بطاقة حالة فعلية (Backend/Realtime/SMS/Notifications)، إحصائيات مفصلة (نشط/مؤكد/مرفوض/مراجعة/مكرر/إجمالي/معلّق)، أزرار تحديث/مزامنة/مسح SMS/تشخيص، وشارة إشعارات بعدد التنبيهات غير المقروءة.
- **Notifications**: مكافحة التكرار باستخدام `eventId` في `AgentContext.emitNotification` و `showAgentNotification`؛ إشعارات تفصيلية (طلب جديد، تطابق، مراجعة، مكرر، خطأ).
- **Orders Tab**: تحويل القائمة إلى `FlatList`، فلاتر الحالة (الكل، جاري الفحص، مؤكد، مرفوض، مكرر، مراجعة، Offline/Pending Sync)، فلتر المزود، بحث شامل بالرقم/المرجع/الرقم التعريفي، وفرز الأحدث/الأقدم.
- **Live Diagnostics**: حالات فعلية مع أيقونات، سبب/حل قابل للتوسيع، وثلاثة أزرار اختبار حقيقية (تحديث التشخيص، اختبار المزامنة، اختبار مسح SMS).
- **Realtime + Polling**: خدمة `realtimeSync.ts` تعطي الأولوية للاشتراك المباشر في SupabaseRealtime وترجع إلى polling تلقائيًا عند عدم الاتصال أو الخطأ.
- **Source Verification**: خدمة `sourceVerification.ts` تتحقق من المزود المفعّل، قواعد المُرسل، ونماط الرسائل قبل قبول أي SMS كدليل دفع.
- **Local Transaction Ledger**: استمرار استخدام `processed_transactions` و `local_sms_index` و `offline_queue` للعمل بدون إنترنت ومنع التكرار.
- **Payment Sources**: تبويبة جديدة `payment-sources.tsx` تعرض بيانات كل مزود (مفعل/معطل، عدد الرسائل، مؤكد/مرفوض/مراجعة، آخر رسالة).
- **Order Details**: بطاقة فحوصات التحقق (Original vs Verified) مقارنة مبلغ/عملة/مرسل/مستلم/رقم العملية/مصدر/تكرار، مع الخط الزمني وسجل التحقق والرسالة الخام.

### 14.2 ملفات معدلة/جديدة

- جديد: `src/services/notifications.ts`
- جديد: `src/services/realtimeSync.ts`
- جديد: `src/services/sourceVerification.ts`
- جديد: `src/app/(app)/(tabs)/payment-sources.tsx`
- معدّل: `src/types/agent.ts` (إضافة `duplicate` و `realtimeStatus` إضافية و `duplicate`/`review` stats)
- معدّل: `src/contexts/AgentContext.tsx` (إشعارات مضادة للتكرار، source verification، realtime lifecycle)
- معدّل: `src/app/(app)/(tabs)/home.tsx`
- معدّل: `src/app/(app)/(tabs)/orders.tsx`
- معدّل: `src/app/(app)/diagnostics.tsx`
- معدّل: `src/app/(app)/orders/[id].tsx`
- معدّل: `src/app/(app)/(tabs)/_layout.tsx`
- معدّل: `src/services/localSmsIndex.ts` (إحصائيات المزود)
- معدّل: `src/lib/database.ts` (إزالة دالة غير مستخدمة)

### 14.3 نتائج التحقق

- `npx tsc --noEmit` ✓ PASS
- `npm run lint` ✓ PASS
- `npx expo export --platform web` ✓ PASS
- `npx expo-doctor` عرض مشاكل مسبقة في `app.json` (router) و `package.json` (duplicate @expo/log-box, @sentry/react-native, @react-navigation/native versions) — لم يتم تقديمها من هذه الجلسة.

### 14.4 ما لم يُختبر

- Android runtime build و test على جهاز حقيقي (Android SDK 36 غير متوفر في بيئة التطوير).
- Background processing + Notifications + SMS في runtime فعلي.
- Realtime/Polling مع خادم فعلي.
- End-to-end: Order → SMS → Source Verification → Matching → Deduplication → Confirm → Sync.

### 14.5 ما يمنع الـ Production Ready

- لا يمكن بناء Android APK/AAB واختباره في هذه البيئة بسبب غياب Android SDK 36/Gradle tools.
- بعض فحوصات `expo-doctor` (duplicate deps, version mismatches) تحتاج إلى إعادة تثبيت/تحديث Dependencies.
