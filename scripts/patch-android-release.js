const fs = require('fs');
const path = require('path');

const androidDir = path.join(process.cwd(), 'android');
const keystoreDir = path.join(androidDir, 'keystore');
const destKeystore = path.join(keystoreDir, 'naderpay-release.keystore');
const sourceKeystore = path.join(process.cwd(), 'certs', 'naderpay-release.keystore');

if (!fs.existsSync(sourceKeystore)) {
  throw new Error(`Keystore not found: ${sourceKeystore}`);
}

fs.mkdirSync(keystoreDir, { recursive: true });
fs.copyFileSync(sourceKeystore, destKeystore);
console.log('Copied release keystore to', destKeystore);

// 1. Patch gradle.properties: نسخة واحدة تشتغل على كل التليفونات، واستخراج المكتبات الأصلية، وتقليل الحجم
const gradlePropertiesPath = path.join(process.cwd(), 'android', 'gradle.properties');
if (fs.existsSync(gradlePropertiesPath)) {
  let props = fs.readFileSync(gradlePropertiesPath, 'utf8');
  // نسخة واحدة لكل الأجهزة الحقيقية (arm64 + 32-bit arm)
  props = props.replace(/reactNativeArchitectures=.*/g, 'reactNativeArchitectures=armeabi-v7a,arm64-v8a');
  // استخراج المكتبات الأصلية لتجنب مشاكل التثبيت
  props = props.replace(/expo\.useLegacyPackaging=.*/g, 'expo.useLegacyPackaging=true');
  // تفعيل minify + shrink resources لتقليل الحجم
  if (!props.includes('android.enableMinifyInReleaseBuilds')) {
    props += '\nandroid.enableMinifyInReleaseBuilds=true\n';
  }
  if (!props.includes('android.enableShrinkResourcesInReleaseBuilds')) {
    props += 'android.enableShrinkResourcesInReleaseBuilds=true\n';
  }
  fs.writeFileSync(gradlePropertiesPath, props);
  console.log('Patched android/gradle.properties for single APK + legacy packaging + minify');
}

const buildGradlePath = path.join(process.cwd(), 'android', 'app', 'build.gradle');
let content = fs.readFileSync(buildGradlePath, 'utf8');

// 2. Add release signing config after the debug block inside signingConfigs
const releaseSigningConfig = `        release {
            storeFile file('../keystore/naderpay-release.keystore')
            storePassword 'naderpay123'
            keyAlias 'naderpay-key'
            keyPassword 'naderpay123'
        }
`;

content = content.replace(
  /(signingConfigs\s*\{\s*debug\s*\{[\s\S]*?\}\s*\n)/,
  `$1${releaseSigningConfig}`
);

// 3. Use release signing config for release build type
content = content.replace(
  /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
  '$1signingConfig signingConfigs.release'
);

// 4. Restrict native ABIs to real phones only (arm64 + 32-bit arm) inside defaultConfig
if (!content.includes('abiFilters')) {
  content = content.replace(
    /(defaultConfig\s*\{[\s\S]*?)(versionName[^\n]+\n)/,
    `$1$2        ndk {\n            abiFilters 'armeabi-v7a', 'arm64-v8a'\n        }\n`
  );
}

// 5. Ensure no maxSdkVersion sneaks into uses-sdk
content = content.replace(/maxSdkVersion\s+\d+/g, '');

fs.writeFileSync(buildGradlePath, content);
console.log('Patched android/app/build.gradle for release signing + single ABI APK');

// 6. Clean the source manifest: remove storage permissions and any stray maxSdkVersion
const manifestPath = path.join(process.cwd(), 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  manifest = manifest.replace(/<uses-permission[^>]*android:name="android\.permission\.READ_EXTERNAL_STORAGE"[^>]*>\s*\n?/g, '');
  manifest = manifest.replace(/<uses-permission[^>]*android:name="android\.permission\.WRITE_EXTERNAL_STORAGE"[^>]*>\s*\n?/g, '');
  manifest = manifest.replace(/android:maxSdkVersion="\d+"\s*/g, '');
  fs.writeFileSync(manifestPath, manifest);
  console.log('Cleaned AndroidManifest.xml storage permissions / maxSdkVersion');
}

// 7. Add ProGuard keep rules to avoid crashes after minification
const proguardPath = path.join(process.cwd(), 'android', 'app', 'proguard-rules.pro');
if (fs.existsSync(proguardPath)) {
  let proguard = fs.readFileSync(proguardPath, 'utf8');
  const extraRules = [
    '# React Native',
    '-keep class com.facebook.react.** { *; }',
    '-keep class com.facebook.hermes.** { *; }',
    '-keep class com.facebook.react.turbomodule.** { *; }',
    '-keep class com.facebook.react.bridge.** { *; }',
    '-keepattributes *Annotation*',
    '-keepattributes SourceFile,LineNumberTable',
    '-keep public class * extends java.lang.Exception',
    '',
    '# Expo modules',
    '-keep class expo.modules.** { *; }',
    '-keepclassmembers class expo.modules.** { *; }',
    '',
    '# Reanimated / Gesture handler',
    '-keep class com.swmansion.reanimated.** { *; }',
    '-keep class com.swmansion.gesturehandler.** { *; }',
    '',
    '# Sentry',
    '-keep class io.sentry.** { *; }',
    '-keep class io.sentry.android.** { *; }',
    '',
    '# RN Screens / SafeArea / SVG',
    '-keep class com.swmansion.rnscreens.** { *; }',
    '-keep class com.th3rdwave.safeareacontext.** { *; }',
    '-keep class com.horcrux.svg.** { *; }',
  ].join('\n');

  const missingRules = extraRules.split('\n').filter((line) => {
    if (!line.trim() || line.startsWith('#')) return false;
    return !proguard.includes(line.trim().split(' ').slice(0, 3).join(' '));
  });

  if (missingRules.length > 0) {
    proguard += '\n# Clean single-APK release rules\n' + missingRules.join('\n') + '\n';
    fs.writeFileSync(proguardPath, proguard);
    console.log('Patched android/app/proguard-rules.pro');
  } else {
    console.log('proguard-rules.pro already contains all keep rules');
  }
}
