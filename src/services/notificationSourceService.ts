/**
 * Notification Source Service — InstaPay Notification Source
 * ─────────────────────────────────────────────────────────────
 * يتيح اختيار تطبيق InstaPay كمصدر موثوق للإشعارات.
 * يحفظ package identifier وليس اسم التطبيق فقط.
 * Android only — يعمل مع صلاحية BIND_NOTIFICATION_LISTENER_SERVICE.
 * في هذه المرحلة: Discovery + Storage فقط. لا يُؤكد طلبات تلقائياً.
 */

import { dbReady } from '@/lib/database';
import { createHash } from '@/lib/hash';

export type NotificationSourceStatus =
  | 'unverified'
  | 'selected'
  | 'verified'
  | 'failed';

export type NotificationSource = {
  id: string;
  providerId: string;
  packageId: string;         // package identifier الحقيقي
  displayName: string;
  sourceType: 'notification';
  status: NotificationSourceStatus;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ─── قائمة ثابتة بالتطبيقات المعروفة التي قد ترسل إشعارات دفع ───────────────

export const KNOWN_PAYMENT_APPS: Array<{ packageId: string; displayName: string; provider: string }> = [
  { packageId: 'com.instapay.app',          displayName: 'InstaPay',        provider: 'insta_pay' },
  { packageId: 'com.nbe.mobilebanking',     displayName: 'NBE Mobile',      provider: 'insta_pay' },
  { packageId: 'com.banquemisr.mobilebank', displayName: 'Banque Misr',     provider: 'insta_pay' },
  { packageId: 'com.cib.mobilebanking',     displayName: 'CIB Mobile',      provider: 'insta_pay' },
  { packageId: 'com.vodafone.cash',         displayName: 'Vodafone Cash',   provider: 'vodafone_cash' },
  { packageId: 'com.vodafone.mobileplus',   displayName: 'أنا فودافون',     provider: 'vodafone_cash' },
  { packageId: 'com.orange.fintech.android',displayName: 'Orange Cash',     provider: 'orange_cash' },
];

/**
 * احصل على قائمة التطبيقات المرشحة لمصدر الإشعارات لـ provider معين.
 * على Android الحقيقي: يُفضَّل مطابقة مع التطبيقات المثبتة فعلياً (Phase 2).
 * في هذه المرحلة: نعرض القائمة الثابتة المعروفة فقط.
 */
export function getCandidateNotificationApps(
  provider: string
): Array<{ packageId: string; displayName: string }> {
  return KNOWN_PAYMENT_APPS
    .filter((a) => a.provider === provider)
    .map(({ packageId, displayName }) => ({ packageId, displayName }));
}

// ─── CRUD على notification_sources ──────────────────────────────────────────

export async function saveNotificationSource(source: Omit<NotificationSource, 'id'>): Promise<NotificationSource> {
  const db = await dbReady;
  const id = createHash(`notif:${source.providerId}:${source.packageId}`);
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO notification_sources
       (id, provider_id, package_id, display_name, status, verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       display_name  = excluded.display_name,
       status        = excluded.status,
       verified_at   = excluded.verified_at,
       updated_at    = excluded.updated_at`,
    [id, source.providerId, source.packageId, source.displayName,
     source.status, source.verifiedAt, source.createdAt ?? now, now]
  );
  return { ...source, id };
}

export async function getNotificationSourcesForProvider(
  providerId: string
): Promise<NotificationSource[]> {
  const db = await dbReady;
  const rows = await db.getAllAsync<{
    id: string; provider_id: string; package_id: string; display_name: string;
    status: string; verified_at: string | null; created_at: string; updated_at: string;
  }>(
    'SELECT * FROM notification_sources WHERE provider_id = ? ORDER BY updated_at DESC',
    [providerId]
  );
  return rows.map(mapRow);
}

export async function getAllNotificationSources(): Promise<NotificationSource[]> {
  const db = await dbReady;
  const rows = await db.getAllAsync<{
    id: string; provider_id: string; package_id: string; display_name: string;
    status: string; verified_at: string | null; created_at: string; updated_at: string;
  }>('SELECT * FROM notification_sources ORDER BY updated_at DESC');
  return rows.map(mapRow);
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
}

/**
 * هل الـ package هو مصدر إشعار موثوق لهذا الـ provider؟
 * يُستخدم في الخلفية لتصفية الإشعارات.
 */
export async function isVerifiedNotificationSource(
  packageId: string,
  providerId?: string
): Promise<boolean> {
  const db = await dbReady;
  let sql = `SELECT COUNT(*) as c FROM notification_sources
             WHERE package_id = ? AND status = ?`;
  const baseParams: import('expo-sqlite').SQLiteBindValue[] = [packageId, 'verified'];
  if (providerId) {
    sql += ' AND provider_id = ?';
    baseParams.push(providerId);
  }
  const row = await db.getFirstAsync<{ c: number }>(sql, baseParams);
  return (row?.c ?? 0) > 0;
}

function mapRow(row: {
  id: string; provider_id: string; package_id: string; display_name: string;
  status: string; verified_at: string | null; created_at: string; updated_at: string;
}): NotificationSource {
  return {
    id: row.id,
    providerId: row.provider_id,
    packageId: row.package_id,
    displayName: row.display_name,
    sourceType: 'notification',
    status: row.status as NotificationSourceStatus,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
