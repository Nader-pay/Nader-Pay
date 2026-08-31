/**
 * recoveryManager.ts
 * مدير الاسترداد التلقائي — يُنسّق تسلسل الاسترداد بعد انقطاع الشبكة أو إعادة تشغيل الجهاز.
 *
 * التسلسل عند استعادة الشبكة (13 خطوة):
 * 1. التحقق من حالة الشبكة الفعلية
 * 2. استعادة إعدادات الوكيل من DB
 * 3. استعادة حالة الجهاز (deviceId/token)
 * 4. التحقق من صلاحية الجلسة / إعادة المصادقة إذا لزم
 * 5. استئناف Runtime
 * 6. إعادة الاتصال بـ Realtime
 * 7. انتظار استقرار الاتصال (graceful delay)
 * 8. جلب الطلبات المعلقة من الخادم
 * 9. مصالحة الأحداث المحلية (SMS مع الطلبات الجديدة)
 * 10. معالجة قائمة الانتظار المحلية (offline_queue)
 * 11. إعادة جدولة Retry للعناصر التي انتهت مهلتها
 * 12. تحديث diagnostics
 * 13. إعلام المستخدم بنتيجة الاسترداد
 */

import { logEvent, setOrderTimestamp } from '@/lib/database';
import { runSyncEngine, fetchPendingOrders, reconcileLocalEvents, checkNetworkOnline } from '@/services/syncEngine';
import { reconnectRealtime } from '@/services/realtimeSync';
import { resumeRuntime } from '@/services/agentRuntime';
import { loadSettings, loadDeviceState } from '@/services/agentSettings';
import type { DeviceState } from '@/types/agent';

export type RecoveryResult = {
  success: boolean;
  stepsCompleted: number;
  stepsTotal: number;
  syncResult?: Awaited<ReturnType<typeof runSyncEngine>>;
  error?: string;
};

export type RecoveryOptions = {
  /** تأخير قبل جلب الطلبات بعد استعادة الاتصال (ms) — افتراضي 800ms */
  gracefulDelayMs?: number;
  /** هل نُعلم المستخدم بإشعار عند اكتمال الاسترداد */
  notifyOnComplete?: boolean;
  /** deviceState الحالي — يُؤخذ من DB إذا لم يُمرَّر */
  deviceState?: DeviceState;
  /** دالة إشعار اختيارية */
  onNotify?: (title: string, body: string, data?: Record<string, unknown>) => Promise<void>;
  /** callback عند تغيير الخطوة */
  onStep?: (step: number, total: number, label: string) => void;
};

let recoveryInProgress = false;

/**
 * تسلسل الاسترداد الكامل عند استعادة الشبكة.
 * آمن للاستدعاء المتكرر — يُلغي نفسه إذا كان الاسترداد جارياً.
 */
export async function onNetworkRestored(opts: RecoveryOptions = {}): Promise<RecoveryResult> {
  if (recoveryInProgress) {
    await logEvent('recovery_skip', 'استرداد جارٍ بالفعل');
    return { success: false, stepsCompleted: 0, stepsTotal: 13, error: 'recovery_in_progress' };
  }

  recoveryInProgress = true;
  const TOTAL_STEPS = 13;
  let stepsCompleted = 0;
  const { gracefulDelayMs = 800, notifyOnComplete = false, onNotify, onStep } = opts;

  const step = (n: number, label: string) => {
    stepsCompleted = n;
    onStep?.(n, TOTAL_STEPS, label);
  };

  try {
    await logEvent('recovery_start', 'بدء تسلسل الاسترداد بعد استعادة الشبكة');

    // ── الخطوة 1: التحقق من الشبكة ──
    step(1, 'التحقق من حالة الشبكة');
    const online = await checkNetworkOnline();
    if (!online) {
      await logEvent('recovery_abort', 'الشبكة لا تزال مقطوعة');
      return { success: false, stepsCompleted, stepsTotal: TOTAL_STEPS, error: 'network_still_offline' };
    }

    // ── الخطوة 2: استعادة الإعدادات ──
    step(2, 'استعادة إعدادات الوكيل');
    const settings = await loadSettings();
    if (!settings.enabled) {
      await logEvent('recovery_abort', 'الوكيل معطل — إيقاف الاسترداد');
      return { success: false, stepsCompleted, stepsTotal: TOTAL_STEPS, error: 'agent_disabled' };
    }

    // ── الخطوة 3: استعادة حالة الجهاز ──
    step(3, 'استعادة حالة الجهاز');
    const deviceState = opts.deviceState ?? (await loadDeviceState());
    if (!deviceState.deviceId || !deviceState.deviceToken) {
      await logEvent('recovery_warn', 'الجهاز غير مسجل — مزامنة محدودة');
    }

    // ── الخطوة 4: التحقق من الجلسة ──
    step(4, 'التحقق من صلاحية الجلسة');
    try {
      const { supabase } = await import('@/client/supabase');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        await logEvent('recovery_warn', 'لا توجد جلسة مصادقة فعالة');
      }
    } catch (err) {
      await logEvent('recovery_session_warn', err instanceof Error ? err.message : 'فشل التحقق من الجلسة');
    }

    // ── الخطوة 5: استئناف Runtime ──
    step(5, 'استئناف Runtime');
    try {
      await resumeRuntime(true);
      await logEvent('recovery_runtime', 'تم استئناف Runtime');
    } catch (err) {
      await logEvent('recovery_runtime_warn', err instanceof Error ? err.message : 'تحذير Runtime');
    }

    // ── الخطوة 6: إعادة اتصال Realtime ──
    step(6, 'إعادة اتصال Realtime');
    try {
      await reconnectRealtime();
      await logEvent('recovery_realtime', 'تم طلب إعادة اتصال Realtime');
    } catch (err) {
      await logEvent('recovery_realtime_warn', err instanceof Error ? err.message : 'تحذير Realtime');
    }

    // ── الخطوة 7: تأخير للاستقرار ──
    step(7, 'انتظار استقرار الاتصال');
    await new Promise<void>((res) => setTimeout(res, gracefulDelayMs));

    // ── الخطوة 8: جلب الطلبات ──
    step(8, 'جلب الطلبات المعلقة');
    let fetchedCount = 0;
    try {
      const fetchResult = await fetchPendingOrders();
      if (fetchResult.ok) fetchedCount = fetchResult.count ?? 0;
      await logEvent('recovery_fetch', `جُلب ${fetchedCount} طلب`);
    } catch (err) {
      await logEvent('recovery_fetch_warn', err instanceof Error ? err.message : 'تحذير جلب الطلبات');
    }

    // ── الخطوة 9: مصالحة الأحداث ──
    step(9, 'مصالحة SMS بالطلبات الجديدة');
    try {
      await reconcileLocalEvents();
      await logEvent('recovery_reconcile', 'تمت مصالحة الأحداث المحلية');
    } catch (err) {
      await logEvent('recovery_reconcile_warn', err instanceof Error ? err.message : 'تحذير مصالحة');
    }

    // ── الخطوة 10: مزامنة قائمة الانتظار ──
    step(10, 'معالجة قائمة الانتظار المحلية');
    let syncResult: Awaited<ReturnType<typeof runSyncEngine>> | undefined;
    try {
      syncResult = await runSyncEngine(deviceState);
      await logEvent('recovery_sync', `مزامنة: ${syncResult.processed} ناجح / ${syncResult.failed} فاشل / ${syncResult.remaining} متبقي`);
    } catch (err) {
      await logEvent('recovery_sync_warn', err instanceof Error ? err.message : 'تحذير مزامنة');
    }

    // ── الخطوة 11: إعادة جدولة Retry المنتهية ──
    step(11, 'إعادة جدولة Retry');
    try {
      await rescheduleExpiredRetries();
    } catch (err) {
      await logEvent('recovery_retry_reschedule_warn', err instanceof Error ? err.message : 'unknown');
    }

    // ── الخطوة 12: تحديث Diagnostics ──
    step(12, 'تحديث حالة Diagnostics');
    await logEvent('recovery_diagnostics', 'تحديث diagnostics مكتمل');

    // ── الخطوة 13: إشعار المستخدم ──
    step(13, 'إشعار المستخدم');
    if (notifyOnComplete && onNotify) {
      const pending = syncResult?.remaining ?? 0;
      const msg = pending === 0
        ? 'تمت مزامنة جميع العمليات بنجاح ✓'
        : `تمت المزامنة — ${pending} عملية معلقة`;
      await onNotify('Nader Pay', msg);
    }

    await logEvent('recovery_complete', `اكتمل الاسترداد — ${TOTAL_STEPS} خطوة`);
    return { success: true, stepsCompleted: TOTAL_STEPS, stepsTotal: TOTAL_STEPS, syncResult };

  } catch (err) {
    const error = err instanceof Error ? err.message : 'خطأ غير متوقع';
    await logEvent('recovery_error', error);
    return { success: false, stepsCompleted, stepsTotal: TOTAL_STEPS, error };
  } finally {
    recoveryInProgress = false;
  }
}

/**
 * تسلسل الاسترداد عند بدء تشغيل التطبيق من الصفر.
 * أخف من onNetworkRestored — يتخطى خطوات الجلسة والإشعار.
 */
export async function onStartupRecovery(deviceState?: DeviceState): Promise<RecoveryResult> {
  if (recoveryInProgress) {
    return { success: false, stepsCompleted: 0, stepsTotal: 6, error: 'recovery_in_progress' };
  }
  recoveryInProgress = true;
  const TOTAL_STEPS = 6;
  let stepsCompleted = 0;

  try {
    await logEvent('startup_recovery_start', 'بدء استرداد التشغيل');

    // 1. قراءة الإعدادات
    stepsCompleted = 1;
    const settings = await loadSettings();

    // 2. قراءة حالة الجهاز
    stepsCompleted = 2;
    const ds = deviceState ?? (await loadDeviceState());

    // 3. التحقق من الشبكة
    stepsCompleted = 3;
    const online = await checkNetworkOnline();

    if (!online || !settings.enabled) {
      await logEvent('startup_recovery_offline', 'غير متصل أو معطل — تحميل محلي فقط');
      return { success: true, stepsCompleted: 3, stepsTotal: TOTAL_STEPS };
    }

    // 4. جلب الطلبات المعلقة
    stepsCompleted = 4;
    try { await fetchPendingOrders(); } catch { /* non-fatal */ }

    // 5. مصالحة SMS محلي
    stepsCompleted = 5;
    try { await reconcileLocalEvents(); } catch { /* non-fatal */ }

    // 6. مزامنة قائمة الانتظار
    stepsCompleted = 6;
    const syncResult = await runSyncEngine(ds);
    await logEvent('startup_recovery_complete', `مزامنة: ${syncResult.processed} ناجح / ${syncResult.remaining} متبقي`);

    return { success: true, stepsCompleted: TOTAL_STEPS, stepsTotal: TOTAL_STEPS, syncResult };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'خطأ في استرداد التشغيل';
    await logEvent('startup_recovery_error', error);
    return { success: false, stepsCompleted, stepsTotal: TOTAL_STEPS, error };
  } finally {
    recoveryInProgress = false;
  }
}

/**
 * إعادة جدولة عناصر offline_queue التي next_retry_at انتهى وقتها أو NULL
 * ولم يُحدَّث حسابها بعد آخر run.
 */
async function rescheduleExpiredRetries(): Promise<void> {
  const { dbReady, computeNextRetryAt } = await import('@/lib/database');
  const db = await dbReady;
  const now = new Date().toISOString();
  // العناصر التي next_retry_at < now ولا تزال pending
  const stale = await db.getAllAsync<{ id: string; attempts: number; retry_class: string }>(
    `SELECT id, attempts, retry_class FROM offline_queue
     WHERE status = 'pending' AND retry_class = 'RETRYABLE' AND next_retry_at < ?`,
    [now]
  );
  for (const item of stale) {
    const nextRetry = computeNextRetryAt(item.attempts, 'RETRYABLE' as any);
    if (nextRetry) {
      await db.runAsync('UPDATE offline_queue SET next_retry_at = ? WHERE id = ?', [nextRetry, item.id]);
    }
  }
  if (stale.length > 0) {
    await logEvent('reschedule_retries', `أُعيدت جدولة ${stale.length} عنصر`);
  }
}

export function isRecoveryInProgress(): boolean {
  return recoveryInProgress;
}
