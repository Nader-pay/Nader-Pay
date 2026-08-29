const fs = require('fs');
const path = require('path');

/**
 * Patch generated Android project after `expo prebuild` for a clean
 * universal release APK that is installable on Android 13+.
 *
 * Rules:
 * - Single universal APK (arm64-v8a + armeabi-v7a) – no ABI splits.
 * - Extract native libraries (legacy packaging) to avoid installer alignment/parse issues.
 * - Disable R8/minify and shrinkResources in the first repair build.
 * - Release signing uses environment variables from GitHub Actions secrets.
 * - Remove any maxSdkVersion left in the merged manifest.
 */

const androidDir = path.join(process.cwd(), 'android');

// 1. Patch gradle.properties
const gradlePropertiesPath = path.join(process.cwd(), 'android', 'gradle.properties');
if (fs.existsSync(gradlePropertiesPath)) {
  let props = fs.readFileSync(gradlePropertiesPath, 'utf8');

  // Universal APK for real devices only (arm64 + 32-bit arm)
  props = props.replace(/reactNativeArchitectures=.*/g, 'reactNativeArchitectures=armeabi-v7a,arm64-v8a');

  // Extract native libs -> more reliable install, especially on Xiaomi/MIUI
  props = props.replace(/expo\.useLegacyPackaging=.*/g, 'expo.useLegacyPackaging=true');

  // Explicitly disable minify/R8 + shrinkResources in the repair build
  props = props.replace(/android\.enableMinifyInReleaseBuilds=.*/g, 'android.enableMinifyInReleaseBuilds=false');
  if (!props.includes('android.enableMinifyInReleaseBuilds=')) {
    props += '\nandroid.enableMinifyInReleaseBuilds=false\n';
  }
  props = props.replace(/android\.enableShrinkResourcesInReleaseBuilds=.*/g, 'android.enableShrinkResourcesInReleaseBuilds=false');
  if (!props.includes('android.enableShrinkResourcesInReleaseBuilds=')) {
    props += 'android.enableShrinkResourcesInReleaseBuilds=false\n';
  }

  fs.writeFileSync(gradlePropertiesPath, props);
  console.log('Patched android/gradle.properties (universal ABI + legacy packaging + minify off)');
}

// 2. Patch app/build.gradle
const buildGradlePath = path.join(process.cwd(), 'android', 'app', 'build.gradle');
let content = fs.readFileSync(buildGradlePath, 'utf8');

// Add release signing config that reads from GitHub Actions secrets via env vars
const releaseSigningConfig = `        release {
            storeFile file(System.getenv('KEYSTORE_PATH') ?: '../keystore/naderpay-release.keystore')
            storePassword System.getenv('KEYSTORE_PASSWORD')
            keyAlias System.getenv('KEY_ALIAS')
            keyPassword System.getenv('KEY_PASSWORD')
        }
`;

content = content.replace(
  /(signingConfigs\s*\{\s*debug\s*\{[\s\S]*?\}\s*\n)/,
  `$1${releaseSigningConfig}`
);

// Use release signing for release build
content = content.replace(
  /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
  '$1signingConfig signingConfigs.release'
);

// Restrict native ABIs to the universal set
if (!content.includes('abiFilters')) {
  content = content.replace(
    /(defaultConfig\s*\{[\s\S]*?)(versionName[^\n]+\n)/,
    `$1$2        ndk {\n            abiFilters 'armeabi-v7a', 'arm64-v8a'\n        }\n`
  );
}

// Ensure no maxSdkVersion line gets into uses-sdk
content = content.replace(/maxSdkVersion\s+\d+/g, '');

fs.writeFileSync(buildGradlePath, content);
console.log('Patched android/app/build.gradle for release signing + universal ABI');

// 3. Clean source manifest: remove any stray maxSdkVersion from merged XML
const manifestPath = path.join(process.cwd(), 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  manifest = manifest.replace(/android:maxSdkVersion="\d+"\s*/g, '');
  fs.writeFileSync(manifestPath, manifest);
  console.log('Cleaned AndroidManifest.xml maxSdkVersion attributes');
}
