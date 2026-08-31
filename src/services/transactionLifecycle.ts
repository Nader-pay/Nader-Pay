/**
 * transactionLifecycle.ts
 * Transaction State Machine — دورة حياة واضحة لكل طلب/معاملة.
 *
 * الحالات الطبيعية:
 *   RECEIVED → QUEUED → WAITING_FOR_EVENT → EVENT_DETECTED
 *   → MATCHING → MATCHED → VERIFYING → CONFIRMED → SYNCED
 *
 * الحالات الاستثنائية:
 *   REVIEW | DUPLICATE | EXPIRED | FAILED | RETRYING | DEAD_LETTER
 *
 * القواعد:
 *   - كل انتقال يُسجَّل في order_timelines
 *   - لا انتقال RECEIVED → CONFIRMED مباشرة
 *   - Idempotent: الانتقال لنفس الحالة يُعيد الحالة بلا تغيير
 *   - State غير معروفة → REVIEW تلقائياً
 */

import {
  updateOrderLocal,
  addTimelineStage,
  setOrderTimestamp,
  logEvent,
  type RetryClass,
} from '@/lib/database';

// ─────────────────────────────────────────────────────────────
// أنواع الحالات
// ─────────────────────────────────────────────────────────────

export type TransactionStage =
  | 'RECEIVED'
  | 'QUEUED'
  | 'WAITING_FOR_EVENT'
  | 'EVENT_DETECTED'
  | 'MATCHING'
  | 'MATCHED'
  | 'VERIFYING'
  | 'CONFIRMED'
  | 'SYNCED'
  // استثنائية
  | 'REVIEW'
  | 'DUPLICATE'
  | 'EXPIRED'
  | 'FAILED'
  | 'RETRYING'
  | 'DEAD_LETTER';

export type TransactionTransitionResult =
  | { ok: true; stage: TransactionStage }
  | { ok: false; reason: string; stage: TransactionStage };

// الانتقالات المسموح بها
const VALID_TRANSITIONS: Record<TransactionStage, TransactionStage[]> = {
  RECEIVED: ['QUEUED', 'DUPLICATE', 'REVIEW'],
  QUEUED: ['WAITING_FOR_EVENT', 'REVIEW', 'FAILED'],
  WAITING_FOR_EVENT: ['EVENT_DETECTED', 'EXPIRED', 'REVIEW'],
  EVENT_DETECTED: ['MATCHING', 'REVIEW', 'DUPLICATE'],
  MATCHING: ['MATCHED', 'REVIEW', 'FAILED'],
  MATCHED: ['VERIFYING', 'REVIEW'],
  VERIFYING: ['CONFIRMED', 'REVIEW', 'FAILED'],
  CONFIRMED: ['SYNCED', 'RETRYING', 'REVIEW'],
  SYNCED: ['REVIEW'], // نهائية — فقط للمراجعة اليدوية
  REVIEW: ['RECEIVED', 'RETRYING', 'DEAD_LETTER'],
  DUPLICATE: [], // نهائية
  EXPIRED: ['REVIEW'], // نراجع يدوياً
  FAILED: ['RETRYING', 'DEAD_LETTER', 'REVIEW'],
  RETRYING: ['CONFIRMED', 'FAILED', 'DEAD_LETTER'],
  DEAD_LETTER: ['REVIEW'], // نهائية — مراجعة يدوية فقط
};

// الحالات النهائية التي لا تحتاج انتقال إضافي في الغالب
export const TERMINAL_STAGES: TransactionStage[] = ['SYNCED', 'DUPLICATE', 'DEAD_LETTER'];

// خريطة الحالة الداخلية → local_status في DB
const STAGE_TO_LOCAL_STATUS: Partial<Record<TransactionStage, string>> = {
  RECEIVED: 'new',
  QUEUED: 'new',
  WAITING_FOR_EVENT: 'scanning',
  EVENT_DETECTED: 'scanning',
  MATCHING: 'scanning',
  MATCHED: 'matched',
  VERIFYING: 'matched',
  CONFIRMED: 'confirmed_local',
  SYNCED: 'confirmed',
  REVIEW: 'review_required',
  DUPLICATE: 'duplicate',
  EXPIRED: 'expired',
  FAILED: 'error',
  RETRYING: 'sync_pending',
  DEAD_LETTER: 'error',
};

// ─────────────────────────────────────────────────────────────
// Transition Function
// ─────────────────────────────────────────────────────────────

/**
 * تنفيذ انتقال آمن لحالة طلب.
 * Idempotent: إذا كانت الحالة الحالية = الحالة المطلوبة → نعيد ok:true بلا كتابة.
 */
export async function transitionOrder(
  orderId: string,
  fromStage: TransactionStage,
  toStage: TransactionStage,
  opts: {
    reason?: string;
    retryClass?: RetryClass;
    force?: boolean; // تجاوز validation — للـ crash recovery فقط
  } = {}
): Promise<TransactionTransitionResult> {
  // Idempotent
  if (fromStage === toStage) {
    return { ok: true, stage: toStage };
  }

  // Validate transition
  if (!opts.force) {
    const allowed = VALID_TRANSITIONS[fromStage] ?? [];
    if (!allowed.includes(toStage)) {
      await logEvent(
        'tx_invalid_transition',
        `${orderId}: ${fromStage} → ${toStage} غير مسموح`,
        { reason: opts.reason }
      );
      return {
        ok: false,
        reason: `Transition ${fromStage} → ${toStage} not allowed`,
        stage: fromStage,
      };
    }
  }

  // حفظ الانتقال
  const localStatus = STAGE_TO_LOCAL_STATUS[toStage] ?? 'error';
  const now = new Date().toISOString();

  await updateOrderLocal(orderId, {
    localStatus,
  });

  // addTimelineStage يقبل: 'completed' | 'current' | 'pending' | 'error'
  const timelineStatus: 'completed' | 'current' | 'pending' | 'error' =
    toStage === 'FAILED' || toStage === 'DEAD_LETTER' ? 'error'
    : toStage === 'CONFIRMED' || toStage === 'SYNCED' ? 'completed'
    : isTerminalStage(toStage) ? 'completed'
    : 'current';

  await addTimelineStage(orderId, toStage, timelineStatus, opts.reason);

  // timestamp integrity
  if (toStage === 'CONFIRMED') {
    await setOrderTimestamp(orderId, 'verified_at', now);
  } else if (toStage === 'SYNCED') {
    await setOrderTimestamp(orderId, 'synced_at', now);
  } else if (toStage === 'EVENT_DETECTED') {
    await setOrderTimestamp(orderId, 'sms_received_at', now);
  } else if (toStage === 'MATCHED') {
    await setOrderTimestamp(orderId, 'processed_at', now);
  }

  await logEvent(
    'tx_transition',
    `${orderId}: ${fromStage} → ${toStage}`,
    { reason: opts.reason, localStatus }
  );

  return { ok: true, stage: toStage };
}

// ─────────────────────────────────────────────────────────────
// Dead Letter Routing
// ─────────────────────────────────────────────────────────────

/**
 * نقل طلب إلى Dead Letter بعد استنفاد المحاولات.
 * يحفظ السبب ويمنع أي معالجة إضافية.
 */
export async function moveToDeadLetter(
  orderId: string,
  currentStage: TransactionStage,
  reason: string,
  module: string
): Promise<void> {
  await transitionOrder(orderId, currentStage, 'DEAD_LETTER', {
    reason: `[${module}] ${reason}`,
    force: true,
  });
  await logEvent('tx_dead_letter', `${orderId} → DEAD_LETTER`, { reason, module });
}

/**
 * نقل طلب لـ REVIEW عند التعارض أو الحالة غير المعروفة.
 */
export async function moveToReview(
  orderId: string,
  currentStage: TransactionStage,
  reason: string,
  module: string
): Promise<void> {
  await transitionOrder(orderId, currentStage, 'REVIEW', {
    reason: `[${module}] ${reason}`,
    force: true,
  });
}

// ─────────────────────────────────────────────────────────────
// Crash Recovery Helper
// ─────────────────────────────────────────────────────────────

/**
 * عند Startup: أي طلب في حالة غير آمنة → REVIEW_REQUIRED
 * الحالات غير الآمنة: MATCHING, VERIFYING, RETRYING
 */
export const IN_FLIGHT_STAGES: TransactionStage[] = ['MATCHING', 'VERIFYING', 'RETRYING'];

export function isTerminalStage(stage: TransactionStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

export function isInFlightStage(stage: TransactionStage): boolean {
  return IN_FLIGHT_STAGES.includes(stage);
}
