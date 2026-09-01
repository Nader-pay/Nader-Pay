/**
 * paymentRequestQueue.ts
 * ════════════════════════════════════════════════════════════════════════════
 * نظام قائمة انتظار (Queue) لطلبات الدفع — Phase 6
 *
 * المشكلة التي يحلها:
 *  - منع تداخل طلبات الفحص (Race Condition)
 *  - تثبيت Matched Transaction Message لكل طلب (Snapshot)
 *  - ضمان معالجة FIFO (Request #1001 → #1002 → #1003)
 *  - منع المعالجة المزدوجة (Idempotency بـ requestId)
 *  - عزل Context كل طلب — لا global latestRequest/latestTransaction
 *
 * قاعدة Balance Before الإلزامية:
 *  Current Payment Request
 *  → Matched Transaction SMS (مُثبَّتة بـ matchedSmsId + matchedSmsReceivedAt)
 *  → Previous SMS/Evidence BEFORE That Transaction
 *  → Balance Before
 *
 * ممنوع:
 *  - latestRequest كـ global context لعدة طلبات
 *  - تغيير matchedSmsId بسبب وصول SMS جديدة أثناء المعالجة
 *  - استخدام آخر رسالة كمرجع تلقائي
 * ════════════════════════════════════════════════════════════════════════════
 */

// ─── حالات معالجة طلب الدفع ──────────────────────────────────────────────────

export type PaymentRequestStatus =
  | 'QUEUED'              // في قائمة الانتظار
  | 'PROCESSING'          // يُعالَج الآن
  | 'MATCHING_SMS'        // يبحث عن SMS المطابقة
  | 'RESOLVING_BALANCE'   // يحسب Balance Before
  | 'VALIDATING'          // يتحقق من النتيجة
  | 'SUCCESS'             // نجح
  | 'FAILED'              // فشل
  | 'RETRY_PENDING'       // ينتظر إعادة المحاولة
  | 'CANCELLED';          // ملغي

// ─── Context طلب الدفع (Snapshot ثابت) ───────────────────────────────────────

export type PaymentRequestContext = {
  /** معرّف فريد للطلب — يُستخدم للـ Idempotency */
  requestId: string;
  /** وسيلة الدفع */
  paymentMethod: string;
  /** المبلغ المتوقع */
  expectedAmount: number;
  /** رقم العملية المتوقع (إن وُجد) */
  expectedTransactionId: string | null;
  /** رقم الهاتف/المرسل المتوقع (إن وُجد) */
  expectedSender: string | null;
  /** وقت إنشاء الطلب */
  createdAt: string;
  /** حالة الطلب الحالية */
  status: PaymentRequestStatus;
  /** عدد محاولات المعالجة */
  processingAttempt: number;

  // ── Matched Transaction Snapshot (مُثبَّت بعد العثور على SMS) ─────────────
  /** ID الرسالة المطابقة من SMS Content Provider */
  matchedSmsId: string | null;
  /** Thread ID (إن وُجد) */
  matchedSmsThreadId: number | null;
  /** المرسل الخام */
  matchedSmsRawSender: string | null;
  /** المرسل بعد التطبيع */
  matchedSmsNormalizedSender: string | null;
  /** وقت استلام الرسالة المطابقة (ISO) — هو المرجع الأساسي لـ Balance Before */
  matchedSmsReceivedAt: string | null;
  /** وقت العملية المستخرج من نص الرسالة (ISO) — للـ Diagnostics فقط */
  matchedTransactionDateTime: string | null;
  /** المبلغ المستخرج من الرسالة */
  matchedAmount: number | null;
  /** رقم العملية المستخرج */
  matchedTransactionId: string | null;
  /** الرصيد بعد العملية المستخرج */
  matchedBalanceAfter: number | null;

  // ── نتيجة معالجة الطلب ────────────────────────────────────────────────────
  /** الرصيد قبل العملية (من Evidence سابقة حقيقية) */
  resolvedBalanceBefore: number | null;
  /** سبب النتيجة */
  resultReason: string | null;
  /** وقت اكتمال المعالجة */
  completedAt: string | null;
};

// ─── إنشاء Context جديد ───────────────────────────────────────────────────────

export function createPaymentRequestContext(params: {
  requestId: string;
  paymentMethod: string;
  expectedAmount: number;
  expectedTransactionId?: string | null;
  expectedSender?: string | null;
}): PaymentRequestContext {
  return {
    requestId: params.requestId,
    paymentMethod: params.paymentMethod,
    expectedAmount: params.expectedAmount,
    expectedTransactionId: params.expectedTransactionId ?? null,
    expectedSender: params.expectedSender ?? null,
    createdAt: new Date().toISOString(),
    status: 'QUEUED',
    processingAttempt: 0,

    matchedSmsId: null,
    matchedSmsThreadId: null,
    matchedSmsRawSender: null,
    matchedSmsNormalizedSender: null,
    matchedSmsReceivedAt: null,
    matchedTransactionDateTime: null,
    matchedAmount: null,
    matchedTransactionId: null,
    matchedBalanceAfter: null,

    resolvedBalanceBefore: null,
    resultReason: null,
    completedAt: null,
  };
}

/**
 * تثبيت Matched Transaction Snapshot على الطلب.
 * بعد هذا الاستدعاء، أي SMS جديدة لا تُغيِّر matchedSmsId.
 *
 * @returns نسخة جديدة من الطلب مع الـ Snapshot مثبَّتاً
 */
export function freezeMatchedTransaction(
  ctx: PaymentRequestContext,
  snapshot: {
    smsId: string;
    threadId: number | null;
    rawSender: string;
    normalizedSender: string;
    receivedAt: string;         // messageReceivedAt — المرجع الأساسي
    transactionDateTime: string; // من نص الرسالة — للـ Diagnostics
    amount: number;
    transactionId: string;
    balanceAfter: number | null;
  }
): PaymentRequestContext {
  // إذا كان matchedSmsId مثبتاً بالفعل، لا تُغيره
  if (ctx.matchedSmsId !== null) {
    if (__DEV__) {
      console.warn(
        `[PaymentQueue] freezeMatchedTransaction: matchedSmsId مثبت بالفعل ${ctx.matchedSmsId} — تجاهل snapshot جديد`
      );
    }
    return ctx;
  }

  return {
    ...ctx,
    status: 'RESOLVING_BALANCE',
    matchedSmsId: snapshot.smsId,
    matchedSmsThreadId: snapshot.threadId,
    matchedSmsRawSender: snapshot.rawSender,
    matchedSmsNormalizedSender: snapshot.normalizedSender,
    matchedSmsReceivedAt: snapshot.receivedAt,
    matchedTransactionDateTime: snapshot.transactionDateTime,
    matchedAmount: snapshot.amount,
    matchedTransactionId: snapshot.transactionId,
    matchedBalanceAfter: snapshot.balanceAfter,
  };
}

// ─── Payment Request Queue ────────────────────────────────────────────────────

const LOG_TAG = '[PaymentQueue]';

function qLog(msg: string, ...args: unknown[]): void {
  if (__DEV__) console.log(`${LOG_TAG} ${msg}`, ...args);
}

function qWarn(msg: string, ...args: unknown[]): void {
  if (__DEV__) console.warn(`${LOG_TAG} ${msg}`, ...args);
}

/**
 * PaymentRequestQueue — معالجة FIFO مع Idempotency.
 *
 * القواعد:
 *  1. كل طلب له requestId فريد — نفس الـ requestId لا يُعالَج مرتين.
 *  2. الطلبات تُعالَج بالترتيب: FIFO (قائمة انتظار حقيقية).
 *  3. لا يُسمح لطلب نشط أن يغيّر Context طلب آخر.
 *  4. وصول SMS جديدة أثناء المعالجة لا يغيّر matchedSmsId الثابت.
 */
export class PaymentRequestQueue {
  /** قائمة الانتظار (FIFO) */
  private queue: PaymentRequestContext[] = [];
  /** الطلب الذي يُعالَج الآن */
  private activeRequest: PaymentRequestContext | null = null;
  /** سجل الطلبات المكتملة للـ Idempotency */
  private completedIds = new Set<string>();
  /** Callbacks للتحديثات */
  private listeners: Array<(ctx: PaymentRequestContext) => void> = [];

  // ── إضافة طلب ─────────────────────────────────────────────────────────────

  /**
   * أضف طلباً للقائمة.
   *
   * @returns 'enqueued' | 'duplicate' | 'already_active'
   */
  enqueue(ctx: PaymentRequestContext): 'enqueued' | 'duplicate' | 'already_active' {
    // فحص Idempotency
    if (this.completedIds.has(ctx.requestId)) {
      qWarn('طلب مكرر (completed): %s', ctx.requestId);
      return 'duplicate';
    }
    if (this.activeRequest?.requestId === ctx.requestId) {
      qWarn('طلب مكرر (active): %s', ctx.requestId);
      return 'already_active';
    }
    if (this.queue.some((r) => r.requestId === ctx.requestId)) {
      qWarn('طلب مكرر (queued): %s', ctx.requestId);
      return 'duplicate';
    }

    qLog('enqueue requestId=%s amount=%s', ctx.requestId, ctx.expectedAmount);
    this.queue.push({ ...ctx, status: 'QUEUED' });
    this._notify({ ...ctx, status: 'QUEUED' });
    return 'enqueued';
  }

  // ── تشغيل المعالج ──────────────────────────────────────────────────────────

  /**
   * شغّل معالج Payment Requests بترتيب FIFO.
   * يعالج كل طلب على حدة — لا تزامن بين الطلبات.
   *
   * @param processor - دالة المعالجة (تُعيد Context محدَّثاً)
   */
  async processAll(
    processor: (ctx: PaymentRequestContext) => Promise<PaymentRequestContext>
  ): Promise<void> {
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;

      // تأكيد Idempotency ثانية قبل المعالجة
      if (this.completedIds.has(next.requestId)) {
        qWarn('تجاهل طلب مكرر عند المعالجة: %s', next.requestId);
        continue;
      }

      qLog('بدء معالجة requestId=%s (محاولة %d)', next.requestId, next.processingAttempt + 1);

      this.activeRequest = {
        ...next,
        status: 'PROCESSING',
        processingAttempt: next.processingAttempt + 1,
      };
      this._notify(this.activeRequest);

      try {
        const completed = await processor(this.activeRequest);
        this.activeRequest = null;

        // تسجيل الإتمام
        if (completed.status === 'SUCCESS' || completed.status === 'FAILED' || completed.status === 'CANCELLED') {
          this.completedIds.add(completed.requestId);
        }

        qLog('اكتمل requestId=%s status=%s', completed.requestId, completed.status);
        this._notify(completed);
      } catch (err) {
        qWarn('خطأ في معالجة requestId=%s: %s', next.requestId, String(err));
        const failed: PaymentRequestContext = {
          ...this.activeRequest!,
          status: 'FAILED',
          resultReason: err instanceof Error ? err.message : 'خطأ غير متوقع',
          completedAt: new Date().toISOString(),
        };
        this.activeRequest = null;
        this.completedIds.add(failed.requestId);
        this._notify(failed);
      }
    }
  }

  // ── تحديث Context ─────────────────────────────────────────────────────────

  /**
   * حدّث حالة الطلب النشط.
   * مهم: لا يُغيَّر matchedSmsId إذا كان مثبتاً بالفعل.
   */
  updateActive(update: Partial<PaymentRequestContext>): void {
    if (!this.activeRequest) return;

    // حماية matchedSmsId من التغيير
    const protectedUpdate = { ...update };
    if (this.activeRequest.matchedSmsId !== null && update.matchedSmsId !== undefined) {
      qWarn('محاولة تغيير matchedSmsId المثبت — تجاهل');
      delete protectedUpdate.matchedSmsId;
    }

    this.activeRequest = { ...this.activeRequest, ...protectedUpdate };
    this._notify(this.activeRequest);
  }

  // ── إلغاء طلب ────────────────────────────────────────────────────────────

  cancel(requestId: string): boolean {
    const idx = this.queue.findIndex((r) => r.requestId === requestId);
    if (idx !== -1) {
      const cancelled = { ...this.queue[idx], status: 'CANCELLED' as PaymentRequestStatus };
      this.queue.splice(idx, 1);
      this.completedIds.add(requestId);
      this._notify(cancelled);
      qLog('تم إلغاء requestId=%s', requestId);
      return true;
    }
    return false;
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get queueLength(): number { return this.queue.length; }
  get isProcessing(): boolean { return this.activeRequest !== null; }
  get currentActiveRequest(): PaymentRequestContext | null { return this.activeRequest; }

  /** هل الطلب تم معالجته بالفعل (Idempotency check) */
  isCompleted(requestId: string): boolean {
    return this.completedIds.has(requestId);
  }

  // ── Listeners ────────────────────────────────────────────────────────────

  subscribe(fn: (ctx: PaymentRequestContext) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private _notify(ctx: PaymentRequestContext): void {
    for (const fn of this.listeners) {
      try { fn(ctx); } catch { /* لا نريد أن يكسر خطأ في Listener المعالجةَ */ }
    }
  }
}

// ─── Singleton Queue للتطبيق ──────────────────────────────────────────────────

/** Queue عام للتطبيق — لا تنشئ instance آخر */
export const paymentQueue = new PaymentRequestQueue();

// ─── Balance Resolver مرتبط بـ Matched Transaction ───────────────────────────

import { findBalanceEvidence, type BalanceEvidence } from './balanceBeforeEnricher';

export type BalanceResolveResult =
  | { found: true;  evidence: BalanceEvidence; balanceBefore: number }
  | { found: false; reason: 'NO_MATCHED_SMS' | 'NO_PREVIOUS_BALANCE_EVIDENCE' | 'SMS_PERMISSION_DENIED' | 'NOT_ANDROID' };

/**
 * يحسب Balance Before بناءً على matchedSmsReceivedAt من الـ Context.
 *
 * القاعدة الإلزامية:
 *  - يبدأ البحث من matchedSmsReceivedAt (وليس "الآن" أو آخر SMS)
 *  - يبحث للخلف فقط (ts < matchedSmsReceivedAt)
 *  - يستخدم matchedSmsId لمنع اختيار الرسالة الحالية
 *  - لا يغيّر matchedSmsId أثناء البحث
 *
 * @param ctx     - Context الطلب (يجب أن يحتوي matchedSmsId + matchedSmsReceivedAt)
 * @param sourceId - معرّف Trusted SMS Source
 */
export async function resolveBalanceBefore(
  ctx: PaymentRequestContext,
  sourceId: string | null
): Promise<BalanceResolveResult> {
  if (process.env.EXPO_OS !== 'android') {
    return { found: false, reason: 'NOT_ANDROID' };
  }

  // التحقق من وجود Matched Transaction Snapshot
  if (!ctx.matchedSmsId || !ctx.matchedSmsReceivedAt) {
    if (__DEV__) {
      console.warn(
        `[BalanceResolver] requestId=${ctx.requestId}: لا يوجد matchedSmsId أو matchedSmsReceivedAt — لا يمكن حساب Balance Before`
      );
    }
    return { found: false, reason: 'NO_MATCHED_SMS' };
  }

  if (__DEV__) {
    console.log(
      `[BalanceResolver] requestId=${ctx.requestId} matchedSmsId=${ctx.matchedSmsId} ` +
      `receivedAt=${ctx.matchedSmsReceivedAt} amount=${ctx.matchedAmount}`
    );
  }

  // البحث عن Balance Evidence بناءً على matchedSmsReceivedAt
  const evidence = await findBalanceEvidence(
    sourceId,
    ctx.matchedSmsId,            // منع اختيار الرسالة الحالية
    ctx.matchedSmsReceivedAt,    // المرجع الزمني الثابت (من Snapshot)
    ctx.matchedBalanceAfter,
    ctx.matchedAmount,
    500,
    ctx.matchedTransactionDateTime ?? undefined
  );

  if (!evidence) {
    return { found: false, reason: 'NO_PREVIOUS_BALANCE_EVIDENCE' };
  }

  return { found: true, evidence, balanceBefore: evidence.balanceBefore };
}
