/**
 * Notification Source Service
 * ─────────────────────────────────────────────────────────────
 * يتيح اكتشاف التطبيقات المثبتة فعلياً على الجهاز وتوثيقها كمصادر إشعارات.
 * يحفظ packageName كهوية تقنية أساسية — لا يعتمد على الاسم الظاهر فقط.
 * Android only — يعمل مع صلاحية BIND_NOTIFICATION_LISTENER_SERVICE.
 *
 * الفصل الكامل عن SMS:
 * - هذا الملف للإشعارات فقط
 * - لا يُخلط مع SMS Source Discovery
 * - كل نوع له storage + verification state + آلية قراءة مستقلة
 */

import { dbReady } from '@/lib/database';
import { createHash } from '@/lib/hash';
import {
  getInstalledApps,
  checkNotificationListenerPermission,
  openNotificationListenerSettings,
  type InstalledApp,
} from './installedAppsService';

// ─── Re-export للاستخدام من discovery.tsx ────────────────────────────────────
export { checkNotificationListenerPermission, openNotificationListenerSettings };
export type { InstalledApp };

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationSourceStatus =
  | 'unverified'
  | 'selected'
  | 'verified'
  | 'permission_required'  // محفوظ لكن Notification Listener غير مفعّل
  | 'failed';

export type NotificationSource = {
  id: string;
  providerId: string;
  packageId: string;        // package identifier الحقيقي — الهوية التقنية
  displayName: string;      // للعرض فقط — قد يتغير
  sourceType: 'notification';
  status: NotificationSourceStatus;
  notificationListenerEnabled: boolean;  // حالة الصلاحية وقت التوثيق
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ─── قائمة المرجعية (fallback فقط — لا تُستخدم إذا توفّر PackageManager) ────

/**
 * قائمة مرجعية بأسماء التطبيقات المعروفة.
 * تُستخدم فقط لإثراء displayName عند قراءة التطبيقات من PackageManager.
 * لا تُستخدم كمصدر اكتشاف أساسي.
 */
const KNOWN_APP_NAMES: Record<string, string> = {
  'com.instapay.app':            'InstaPay',
  'com.nbe.mobilebanking':       'NBE Mobile — بنك مصر',
  'com.banquemisr.mobilebank':   'Banque Misr',
  'com.cib.mobilebanking':       'CIB Mobile',
  'com.vodafone.cash':           'Vodafone Cash',
  'com.vodafone.mobileplus':     'أنا فودافون',
  'com.orange.fintech.android':  'Orange Cash',
  'com.fawry.merchant':          'فوري',
  'com.alexbank.mobilebanking':  'بنك الإسكندرية',
  'com.qnb.egypt.mobilebanking': 'QNB Mobile',
  'com.ahlibank.mobile':         'الأهلي موبايل',
};

/**
 * اكتشاف التطبيقات المثبتة فعلياً على الجهاز من PackageManager.
 *
 * - إذا كان NativeModule متاحاً: يقرأ من PackageManager الحقيقي (كل التطبيقات).
 * - إذا لم يكن متاحاً: يعيد قائمة فارغة — لا mock، المستخدم يُضيف يدوياً.
 *
 * ملاحظة: financialOnly=false افتراضياً — يعرض كل التطبيقات ويُتيح للمستخدم
 * الاختيار بنفسه. التصفية الذكية اختيارية وليست شرطاً للعرض.
 */
export async function discoverInstalledPaymentApps(): Promise<InstalledApp[]> {
  if (process.env.EXPO_OS === 'web') return [];

  try {
    // financialOnly=false — نعرض كل التطبيقات، المستخدم يختار
    const apps = await getInstalledApps(false);

    if (__DEV__) {
      console.log(`[notificationSourceService] PackageManager: ${apps.length} تطبيق`);
      if (apps.length === 0) {
        console.warn('[notificationSourceService] PackageManager أعاد 0 تطبيقات — NativeModule قد لا يكون متاحاً');
      }
    }

    // إثراء displayName من القائمة المرجعية عند الحاجة
    return apps.map((app) => ({
      ...app,
      displayName: KNOWN_APP_NAMES[app.packageName] ?? app.displayName,
    }));
  } catch (err) {
    console.warn('[notificationSourceService] discoverInstalledPaymentApps error:', err);
    return [];
  }
}

/**
 * تشخيص سبب إرجاع PackageManager قائمة فارغة.
 * يُستخدم في UI لعرض رسالة تشخيصية دقيقة بدلاً من "لا توجد تطبيقات مالية".
 */
export type PackageManagerDiagnostic =
  | 'NO_NATIVE_MODULE'      // NativeModule غير متاح
  | 'PERMISSION_ERROR'      // خطأ صلاحية
  | 'EMPTY_RESULT'          // PackageManager أعاد 0
  | 'OK';                   // يعمل

export async function diagnosePackageManager(): Promise<PackageManagerDiagnostic> {
  if (process.env.EXPO_OS === 'web') return 'NO_NATIVE_MODULE';
  try {
    const apps = await getInstalledApps(false);
    return apps.length > 0 ? 'OK' : 'EMPTY_RESULT';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('permission')) return 'PERMISSION_ERROR';
    return 'NO_NATIVE_MODULE';
  }
}

// ─── Notification Listener Access ────────────────────────────────────────────

/**
 * حالة موحّدة لـ Notification Listener Access.
 */
export type NotificationListenerState =
  | 'enabled'                 // مفعّل — جاهز للعمل
  | 'disabled'                // غير مفعّل — يحتاج تفعيل من الإعدادات
  | 'unknown';                // Web أو غير Android

export async function getNotificationListenerState(): Promise<NotificationListenerState> {
  if (process.env.EXPO_OS === 'web') return 'unknown';
  if (process.env.EXPO_OS !== 'android') return 'unknown';
  try {
    const enabled = await checkNotificationListenerPermission();
    return enabled ? 'enabled' : 'disabled';
  } catch {
    return 'unknown';
  }
}

// ─── CRUD على notification_sources ──────────────────────────────────────────

export async function saveNotificationSource(
  source: Omit<NotificationSource, 'id'>
): Promise<NotificationSource> {
  const db = await dbReady;
  const id = createHash(`notif:${source.providerId}:${source.packageId}`);
  const now = new Date().toISOString();

  // تحقق من حالة Notification Listener في وقت الحفظ
  const listenerEnabled = await checkNotificationListenerPermission().catch(() => false);
  const effectiveStatus: NotificationSourceStatus =
    source.status === 'verified' && !listenerEnabled
      ? 'permission_required'
      : source.status;

  await db.runAsync(
    `INSERT INTO notification_sources
       (id, provider_id, package_id, display_name, status, verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       display_name  = excluded.display_name,
       status        = excluded.status,
       verified_at   = excluded.verified_at,
       updated_at    = excluded.updated_at`,
    [
      id,
      source.providerId,
      source.packageId,
      source.displayName,
      effectiveStatus,
      source.verifiedAt,
      source.createdAt ?? now,
      now,
    ]
  );

  console.log(
    `[notificationSourceService] ✓ توثيق ${source.packageId} → provider=${source.providerId} | status=${effectiveStatus} | listener=${listenerEnabled}`
  );

  return {
    ...source,
    id,
    status: effectiveStatus,
    notificationListenerEnabled: listenerEnabled,
  };
}

export async function getNotificationSourcesForProvider(
  providerId: string
): Promise<NotificationSource[]> {
  const db = await dbReady;
  const rows = await db.getAllAsync<{
    id: string;
    provider_id: string;
    package_id: string;
    display_name: string;
    status: string;
    verified_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    'SELECT * FROM notification_sources WHERE provider_id = ? ORDER BY updated_at DESC',
    [providerId]
  );
  const listenerEnabled = await checkNotificationListenerPermission().catch(() => false);
  return rows.map((r) => mapRow(r, listenerEnabled));
}

export async function getAllNotificationSources(): Promise<NotificationSource[]> {
  const db = await dbReady;
  const rows = await db.getAllAsync<{
    id: string;
    provider_id: string;
    package_id: string;
    display_name: string;
    status: string;
    verified_at: string | null;
    created_at: string;
    updated_at: string;
  }>('SELECT * FROM notification_sources ORDER BY updated_at DESC');
  const listenerEnabled = await checkNotificationListenerPermission().catch(() => false);
  return rows.map((r) => mapRow(r, listenerEnabled));
}

export async function setNotificationSourceStatus(
  id: string,
  status: NotificationSourceStatus
): Promise<void> {
  const db = await dbReady;
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE notification_sources
     SET status = ?, verified_at = ?, updated_at = ?
     WHERE id = ?`,
    [status, status === 'verified' ? now : null, now, id]
  );
}

export async function revokeNotificationSource(id: string): Promise<void> {
  const db = await dbReady;
  await db.runAsync('DELETE FROM notification_sources WHERE id = ?', [id]);
  console.log(`[notificationSourceService] إلغاء توثيق مصدر إشعار: ${id}`);
}

/**
 * هل الـ package مصدر إشعار موثوق لهذا الـ provider؟
 * يُستخدم في الخلفية لتصفية الإشعارات.
 */
export async function isVerifiedNotificationSource(
  packageId: string,
  providerId?: string
): Promise<boolean> {
  const db = await dbReady;
  let sql = `SELECT COUNT(*) as c FROM notification_sources
             WHERE package_id = ? AND status IN ('verified', 'selected', 'permission_required')`;
  const params: import('expo-sqlite').SQLiteBindValue[] = [packageId];
  if (providerId) {
    sql += ' AND provider_id = ?';
    params.push(providerId);
  }
  const row = await db.getFirstAsync<{ c: number }>(sql, params);
  return (row?.c ?? 0) > 0;
}

// ─── Row Mapper ───────────────────────────────────────────────────────────────

function mapRow(
  row: {
    id: string;
    provider_id: string;
    package_id: string;
    display_name: string;
    status: string;
    verified_at: string | null;
    created_at: string;
    updated_at: string;
  },
  listenerEnabled: boolean
): NotificationSource {
  return {
    id: row.id,
    providerId: row.provider_id,
    packageId: row.package_id,
    displayName: KNOWN_APP_NAMES[row.package_id] ?? row.display_name,
    sourceType: 'notification',
    status: row.status as NotificationSourceStatus,
    notificationListenerEnabled: listenerEnabled,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
