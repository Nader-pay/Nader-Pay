# دليل بناء Nader Pay Agent

## المتطلبات

- Node.js 18+
- Android Studio مع Android SDK
- أو حساب Expo (للبناء السحابي)

## 1. بناء محلي (APK)

```bash
npm install
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

سيظهر APK في:
`android/app/build/outputs/apk/release/app-release.apk`

## 2. بناء سحابي عبر EAS

1. أنشئ حساب Expo.
2. سجّل دخول:
```bash
npx eas login
```
3. شغّل:
```bash
npx eas build -p android --profile preview
```

بعد انتهاء البناء، تحصل على رابط تحميل APK مباشر.

## 3. تطوير سريع

```bash
npx expo start --android
```

استخدم جهاز Android أو محاكي. ملاحظة: بعض ميزات SMS قد لا تعمل في Expo Go؛ استخدم development build.

## ملاحظات

- التطبيق معطل افتراضيًا (`enabled: false`)؛ فعّله من شاشة الإعدادات.
- أدخل `SUPABASE_URL` و `SUPABASE_ANON_KEY` في `.env` إذا لم تُحدد بعد.
