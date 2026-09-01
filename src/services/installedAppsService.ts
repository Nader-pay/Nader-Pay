/**
 * installedAppsService.ts
 * ═══════════════════════════════════════════════════════════════════
 * اكتشاف التطبيقات المثبتة على الجهاز عبر expo-sms-listener NativeModule
 * وفحص حالة Notification Listener Permissions.
 *
 * الفصل الكامل عن SMS — هذا الملف للتطبيقات/الإشعارات فقط.
 * ═══════════════════════════════════════════════════════════════════
 */

import { NativeModules, Linking, Platform } from 'react-native';

export type InstalledApp = {
  packageName: string;   // com.instapay.app — الهوية التقنية الأساسية
  displayName: string;   // الاسم الظاهر فقط للعرض
  icon?: string;         // base64 أو uri إن كان متاحاً
};

/** فئات التطبيقات المالية المعروفة — لتصفية أولية ذكية */
const FINANCIAL_PACKAGE_HINTS = [
  'vodafone', 'orange', 'instapay', 'nbe', 'banquemisr', 'cib',
  'fawry', 'aman', 'ahly', 'masreq', 'qnb', 'alexbank', 'hsbc',
  'pay', 'wallet', 'cash', 'bank', 'mobile',
];

/**
 * قراءة التطبيقات المثبتة من PackageManager عبر NativeModule.
 * تعيد قائمة بجميع التطبيقات أو قائمة مفلترة للتطبيقات المالية.
 *
 * @param financialOnly - إذا true تعيد التطبيقات المالية المحتملة فقط (افتراضي: false)
 */
export async function getInstalledApps(financialOnly = false): Promise<InstalledApp[]> {
  if (process.env.EXPO_OS === 'web') return [];

  const apps = await readInstalledAppsFromNative();

  if (!financialOnly) {
    return apps;
  }

  // تصفية ذكية للتطبيقات المالية المحتملة
  return apps.filter((app) => {
    const pkg = app.packageName.toLowerCase();
    const name = app.displayName.toLowerCase();
    return FINANCIAL_PACKAGE_HINTS.some((hint) => pkg.includes(hint) || name.includes(hint));
  });
}

/**
 * قراءة حالة صلاحية Notification Listener.
 * يتحقق من Settings.Secure.enabled_notification_listeners.
 * يعيد true فقط إذا كانت الصلاحية مفعّلة فعلياً.
 */
export async function checkNotificationListenerPermission(): Promise<boolean> {
  if (process.env.EXPO_OS === 'web') return false;
  if (Platform.OS !== 'android') return false;

  try {
    // محاولة الوصول عبر NativeModule (expo-sms-listener أو SmsAndroid bridge)
    const mod = getNativeAgentModule();
    if (mod?.checkNotificationListenerEnabled) {
      const result = await mod.checkNotificationListenerEnabled();
      return Boolean(result);
    }
    // fallback: نفترض غير مفعّلة
    return false;
  } catch {
    return false;
  }
}

/**
 * فتح إعدادات Notification Listener في Android.
 * يوجّه المستخدم لتفعيل صلاحية استقبال الإشعارات.
 */
export async function openNotificationListenerSettings(): Promise<void> {
  if (process.env.EXPO_OS === 'web') return;

  try {
    const mod = getNativeAgentModule();
    if (mod?.openNotificationListenerSettings) {
      await mod.openNotificationListenerSettings();
      return;
    }
    // fallback عبر Linking
    await Linking.openSettings();
  } catch {
    await Linking.openSettings();
  }
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/**
 * قراءة التطبيقات المثبتة من Native Module.
 * يدعم عدة مسارات:
 * 1. NativeModule.NaderPayAgent.getInstalledApps()
 * 2. NativeModule.ExpoSmsListener.getInstalledApps()
 * 3. Fallback: قائمة فارغة (المستخدم يُضيف يدوياً)
 */
async function readInstalledAppsFromNative(): Promise<InstalledApp[]> {
  try {
    const mod = getNativeAgentModule();

    if (mod?.getInstalledApps) {
      const result = await mod.getInstalledApps();
      if (Array.isArray(result)) {
        return result
          .filter((item: unknown) => item && typeof item === 'object')
          .map((item: Record<string, unknown>) => ({
            packageName: String(item.packageName ?? item.package_name ?? ''),
            displayName: String(item.displayName ?? item.label ?? item.name ?? item.packageName ?? ''),
            icon: item.icon ? String(item.icon) : undefined,
          }))
          .filter((app) => app.packageName.length > 0);
      }
    }

    // fallback: لا يوجد native module يدعم getInstalledApps
    // في هذه الحالة نعيد قائمة فارغة لنجبر المستخدم على الإضافة اليدوية
    return [];
  } catch (err) {
    console.warn('[installedAppsService] getInstalledApps error:', err);
    return [];
  }
}

function getNativeAgentModule(): Record<string, (...args: unknown[]) => unknown> | null {
  try {
    // محاولة مختلف أسماء NativeModules المحتملة
    const candidates = [
      NativeModules.NaderPayAgent,
      NativeModules.ExpoSmsListener,
      NativeModules.SmsListener,
      NativeModules.AgentModule,
    ];
    for (const mod of candidates) {
      if (mod && typeof mod === 'object') {
        return mod as Record<string, (...args: unknown[]) => unknown>;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * تنبيه للتطوير: السجّل الكامل لحالة Native Modules.
 */
export function logInstalledAppsCapabilities(): void {
  if (__DEV__) {
    const keys = Object.keys(NativeModules);
    console.log('[installedAppsService] NativeModules keys:', keys);
    const mod = getNativeAgentModule();
    if (mod) {
      console.log('[installedAppsService] Found NativeModule, methods:', Object.keys(mod));
    } else {
      console.warn('[installedAppsService] No NativeAgentModule found — installed apps will be empty');
    }
  }
}
