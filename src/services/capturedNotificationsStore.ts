/**
 * capturedNotificationsStore.ts
 * ═══════════════════════════════════════════════════════════════════
 * تخزين إشعارات Android فوراً عند وصولها — قبل أن تختفي من Notification Shade.
 *
 * القواعد:
 * - يُخزَّن الإشعار فور وصوله بدون انتظار طلب الدفع.
 * - Deduplication متعدد المستويات: key + fingerprint + postTime.
 * - لا تُخزَّن إشعارات من packages غير موثقة كمصادر معتمدة.
 * - سياسة احتفاظ: 30 يوم افتراضي (قابل للتعديل).
 * ═══════════════════════════════════════════════════════════════════
 */

import { dbReady } from '@/lib/database';
import { createHash } from '@/lib/hash';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CapturedNotification = {
  id: string;
  packageName: string;       // com.instapay.app — الهوية التقنية
  notificationKey: string;   // key فريد من Android StatusBarNotification
  postTimeMs: number;        // وقت النشر بالـ milliseconds من Android
  title: string | null;
  text: string | null;
  bigText: string | null;    // expanded text
  subText: string | null;
  contentFingerprint: string; // sha256 للـ deduplication
  providerId: string | null; // مرتبط بـ notification_sources
  receivedAt: string;        // ISO timestamp وقت الاستلام داخل التطبيق
  processed: number;         // 0 = لم تُعالج، 1 = عُولجت
  processedAt: string | null;
};

export type CapturedNotificationInput = {
  packageName: string;
  notificationKey: string;
  postTimeMs: number;
  title?: string | null;
  text?: string | null;
  bigText?: string | null;
  subText?: string | null;
  providerId?: string | null;
};

// ─── Migration: إنشاء الجدول إذا لم يكن موجوداً ──────────────────────────────

export async function ensureCapturedNotificationsTable(): Promise<void> {
  const db = await dbReady;
  const has = (await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='captured_android_notifications'"
  )).length > 0;

  if (!has) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS captured_android_notifications (
        id TEXT PRIMARY KEY,
        package_name TEXT NOT NULL,
        notification_key TEXT NOT NULL,
        post_time_ms INTEGER NOT NULL,
        title TEXT,
        text TEXT,
        big_text TEXT,
        sub_text TEXT,
        content_fingerprint TEXT NOT NULL,
        provider_id TEXT,
        received_at TEXT NOT NULL DEFAULT (datetime('now')),
        processed INTEGER NOT NULL DEFAULT 0,
        processed_at TEXT
      )
    `);
    await db.execAsync(
      'CREATE INDEX IF NOT EXISTS idx_can_pkg ON captured_android_notifications(package_name)'
    );
    await db.execAsync(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_can_fingerprint ON captured_android_notifications(content_fingerprint)'
    );
    await db.execAsync(
      'CREATE INDEX IF NOT EXISTS idx_can_received ON captured_android_notifications(received_at DESC)'
    );
    await db.execAsync(
      'CREATE INDEX IF NOT EXISTS idx_can_processed ON captured_android_notifications(processed)'
    );
    console.log('[capturedNotificationsStore] جدول captured_android_notifications أُنشئ');
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * تخزين إشعار Android فوراً عند وصوله.
 * يعيد null إذا كان مكرراً أو تجاهله deduplication.
 */
export async function captureAndroidNotification(
  input: CapturedNotificationInput
): Promise<CapturedNotification | null> {
  await ensureCapturedNotificationsTable();
  const db = await dbReady;

  const fingerprint = buildFingerprint(input);
  const now = new Date().toISOString();
  const id = createHash(`capture:${input.packageName}:${fingerprint}`);

  // ── Deduplication Level 1: content fingerprint ──────────────────────────────
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM captured_android_notifications WHERE content_fingerprint = ?',
    [fingerprint]
  );
  if (existing) {
    console.log(`[capturedNotificationsStore] مكرر (fingerprint): ${fingerprint.slice(0, 16)}…`);
    return null;
  }

  // ── Deduplication Level 2: notification_key + postTime (تحديثات Android) ──
  if (input.notificationKey) {
    const byKey = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM captured_android_notifications
       WHERE package_name = ? AND notification_key = ? AND post_time_ms = ?`,
      [input.packageName, input.notificationKey, input.postTimeMs]
    );
    if (byKey) {
      console.log(`[capturedNotificationsStore] مكرر (key+postTime): ${input.notificationKey}`);
      return null;
    }
  }

  const row: CapturedNotification = {
    id,
    packageName: input.packageName,
    notificationKey: input.notificationKey,
    postTimeMs: input.postTimeMs,
    title: input.title ?? null,
    text: input.text ?? null,
    bigText: input.bigText ?? null,
    subText: input.subText ?? null,
    contentFingerprint: fingerprint,
    providerId: input.providerId ?? null,
    receivedAt: now,
    processed: 0,
    processedAt: null,
  };

  try {
    await db.runAsync(
      `INSERT INTO captured_android_notifications
         (id, package_name, notification_key, post_time_ms,
          title, text, big_text, sub_text,
          content_fingerprint, provider_id, received_at, processed, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
      [
        id, row.packageName, row.notificationKey, row.postTimeMs,
        row.title, row.text, row.bigText, row.subText,
        fingerprint, row.providerId, now,
      ]
    );

    console.log(
      `[capturedNotificationsStore] ✓ إشعار مُخزَّن: ${input.packageName} | ${now}`
    );
    return row;
  } catch (err) {
    // UNIQUE constraint → مكرر (race condition)
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) {
      console.log('[capturedNotificationsStore] مكرر (UNIQUE constraint)');
      return null;
    }
    console.warn('[capturedNotificationsStore] خطأ في الحفظ:', err);
    return null;
  }
}

// ─── Query ────────────────────────────────────────────────────────────────────

/** قراءة الإشعارات المحفوظة لـ package معين */
export async function getCapturedForPackage(
  packageName: string,
  limit = 50
): Promise<CapturedNotification[]> {
  await ensureCapturedNotificationsTable();
  const db = await dbReady;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM captured_android_notifications
     WHERE package_name = ?
     ORDER BY received_at DESC LIMIT ?`,
    [packageName, limit]
  );
  return rows.map(mapRow);
}

/** قراءة إشعارات غير مُعالجة لـ provider معين */
export async function getUnprocessedForProvider(
  providerId: string,
  limit = 20
): Promise<CapturedNotification[]> {
  await ensureCapturedNotificationsTable();
  const db = await dbReady;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM captured_android_notifications
     WHERE provider_id = ? AND processed = 0
     ORDER BY received_at ASC LIMIT ?`,
    [providerId, limit]
  );
  return rows.map(mapRow);
}

/** إجمالي الإشعارات المخزنة لكل package */
export async function getCapturedNotificationStats(): Promise<
  Array<{ packageName: string; total: number; unprocessed: number; lastAt: string | null }>
> {
  await ensureCapturedNotificationsTable();
  const db = await dbReady;
  const rows = await db.getAllAsync<{
    package_name: string;
    total: number;
    unprocessed: number;
    last_at: string | null;
  }>(
    `SELECT package_name,
            COUNT(*) as total,
            SUM(CASE WHEN processed = 0 THEN 1 ELSE 0 END) as unprocessed,
            MAX(received_at) as last_at
     FROM captured_android_notifications
     GROUP BY package_name
     ORDER BY last_at DESC`
  );
  return rows.map((r) => ({
    packageName: r.package_name,
    total: r.total,
    unprocessed: r.unprocessed,
    lastAt: r.last_at,
  }));
}

/** تحديد إشعار كـ معالَج */
export async function markNotificationProcessed(id: string): Promise<void> {
  await ensureCapturedNotificationsTable();
  const db = await dbReady;
  await db.runAsync(
    `UPDATE captured_android_notifications
     SET processed = 1, processed_at = ? WHERE id = ?`,
    [new Date().toISOString(), id]
  );
}

// ─── Retention Cleanup ────────────────────────────────────────────────────────

/**
 * تنظيف الإشعارات القديمة المُعالجة (سياسة الاحتفاظ).
 * @param retentionDays - عدد أيام الاحتفاظ (افتراضي: 30)
 */
export async function cleanupOldCapturedNotifications(
  retentionDays = 30
): Promise<number> {
  await ensureCapturedNotificationsTable();
  const db = await dbReady;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.runAsync(
    `DELETE FROM captured_android_notifications
     WHERE processed = 1 AND received_at < ?`,
    [cutoff]
  );
  const deleted = result.changes ?? 0;
  if (deleted > 0) {
    console.log(`[capturedNotificationsStore] نظّفت ${deleted} إشعار قديم (>${retentionDays}d)`);
  }
  return deleted;
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/**
 * بصمة محتوى الإشعار للـ deduplication.
 * تعتمد على محتوى الرسالة + package + وقت النشر.
 * لا تعتمد على notification_key وحده لأنه يتغير مع تحديثات Android.
 */
function buildFingerprint(input: CapturedNotificationInput): string {
  const content = [
    input.packageName,
    String(input.postTimeMs),
    (input.bigText ?? input.text ?? input.title ?? '').slice(0, 200),
  ].join('|');
  return createHash(content);
}

function mapRow(row: Record<string, unknown>): CapturedNotification {
  return {
    id: String(row.id ?? ''),
    packageName: String(row.package_name ?? ''),
    notificationKey: String(row.notification_key ?? ''),
    postTimeMs: Number(row.post_time_ms ?? 0),
    title: row.title != null ? String(row.title) : null,
    text: row.text != null ? String(row.text) : null,
    bigText: row.big_text != null ? String(row.big_text) : null,
    subText: row.sub_text != null ? String(row.sub_text) : null,
    contentFingerprint: String(row.content_fingerprint ?? ''),
    providerId: row.provider_id != null ? String(row.provider_id) : null,
    receivedAt: String(row.received_at ?? ''),
    processed: Number(row.processed ?? 0),
    processedAt: row.processed_at != null ? String(row.processed_at) : null,
  };
}
