const { withAndroidManifest } = require('expo/config-plugins');

/**
 * إزالة أي android:maxSdkVersion من uses-sdk في AndroidManifest.
 * بعض مكتبات Expo (expo-file-system / expo-image) بتضيف maxSdkVersion=32
 * على صلاحيات التخزين، وده ممكن يخلي المanifest merger يحط maxSdkVersion
 * على uses-sdk ويمنع التثبيت على Android 13+. البلاجن دي بتمنع الحالة دي.
 */
module.exports = function withCleanAndroidManifest(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    // 1. Remove maxSdkVersion from <uses-sdk> if any merged config added it
    if (manifest.manifest['uses-sdk']) {
      for (const sdk of manifest.manifest['uses-sdk']) {
        if (sdk.$) {
          delete sdk.$['android:maxSdkVersion'];
          delete sdk.$['tools:replace'];
        }
      }
    }

    // 2. Remove any library-supplied android:maxSdkVersion from storage permissions.
    // Having both the attribute and tools:remove/tools:replace causes a manifest merger
    // conflict ("tools:remove specified ... but attribute also declared"). Fix: delete
    // the attribute outright so the merger has nothing to conflict on.
    const perms = manifest.manifest['uses-permission'] || [];
    for (const perm of perms) {
      if (perm.$) {
        if (perm.$['tools:replace'] === 'android:maxSdkVersion') {
          delete perm.$['tools:replace'];
        }
        if (perm.$['android:maxSdkVersion'] !== undefined) {
          delete perm.$['android:maxSdkVersion'];
        }
        if (perm.$['tools:remove'] === 'android:maxSdkVersion') {
          delete perm.$['tools:remove'];
        }
      }
    }

    return config;
  });
};
