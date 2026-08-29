const { withAndroidManifest } = require('expo/config-plugins');

/**
 * بعد ما expo-file-system / expo-image بيضيفوا صلاحيات التخزين مع
 * maxSdkVersion=32، البلاجن دي بتنظفهم من الـ manifest النهائي.
 * كمان بترفع أي maxSdkVersion على uses-sdk عشان التطبيق يتثبت على Android 13+.
 */
module.exports = function withCleanAndroidManifest(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    // 1. إزالة maxSdkVersion من uses-sdk لو موجود
    if (manifest.manifest['uses-sdk']) {
      for (const sdk of manifest.manifest['uses-sdk']) {
        if (sdk.$) {
          delete sdk.$['android:maxSdkVersion'];
          delete sdk.$['tools:replace'];
        }
      }
    }

    // 2. إزالة صلاحيات التخزين الخارجي (مش محتاجينها لأننا بنستخدم app-specific dirs)
    if (manifest.manifest['uses-permission']) {
      const blocked = [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ];
      manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'].filter(
        (perm) => {
          if (!perm.$ || !perm.$['android:name']) return true;
          return !blocked.includes(perm.$['android:name']);
        }
      );
    }

    return config;
  });
};
