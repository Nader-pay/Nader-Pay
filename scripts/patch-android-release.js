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

const buildGradlePath = path.join(process.cwd(), 'android', 'app', 'build.gradle');
let content = fs.readFileSync(buildGradlePath, 'utf8');

// 1. Add release signing config after the debug block inside signingConfigs
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

// 2. Use release signing config for release build type
content = content.replace(
  /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
  '$1signingConfig signingConfigs.release'
);

// 3. Add ABI splits after defaultConfig block
if (!content.includes('splits {')) {
  content = content.replace(
    /(defaultConfig\s*\{[\s\S]*?\}\s*\n)/,
    `$1    splits {
        abi {
            enable true
            reset()
            include 'armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'
            universalApk true
        }
    }
`
  );
}

fs.writeFileSync(buildGradlePath, content);
console.log('Patched android/app/build.gradle for release signing + ABI splits');
