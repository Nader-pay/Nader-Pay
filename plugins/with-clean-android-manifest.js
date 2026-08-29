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
    if (manifest.manifest['uses-sdk']) {
      for (const sdk of manifest.manifest['uses-sdk']) {
        if (sdk.$) {
          delete sdk.$['android:maxSdkVersion'];
          delete sdk.$['tools:replace'];
        }
      }
    }
    return config;
  });
};
