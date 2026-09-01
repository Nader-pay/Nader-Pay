/**
 * circuitBreaker.ts
 * Circuit Breaker Pattern — حماية الخدمات الخارجية من الفشل المتسلسل.
 *
 * الحالات:
 *   CLOSED     — يعمل بشكل طبيعي
 *   OPEN       — مفتوح بعد تجاوز حد الأخطاء — لا طلبات جديدة
 *   HALF_OPEN  — فترة اختبار بعد cooldown — طلب واحد يُحدد المصير
 *
 * المبدأ:
 *   - كل خدمة خارجية لها Circuit Breaker مستقل
 *   - في حالة OPEN: العمليات المحلية تستمر، الأحداث تُخزَّن في قائمة الانتظار
 *   - لا restart loop: cooldown تزداد بشكل تراكمي
 */

import { logEvent } from '@/lib/database';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type CircuitConfig = {
  /** عدد الأخطاء المتتالية قبل الفتح */
  failureThreshold: number;
  /** وقت الانتظار بعد الفتح (ms) قبل الانتقال لـ HALF_OPEN */
  cooldownMs: number;
  /** اسم الخدمة للتسجيل */
  serviceName: string;
};

export type CircuitSnapshot = {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  openedAt: string | null;
  nextHalfOpenAt: string | null;
  totalFailures: number;
  totalSuccesses: number;
};

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  cooldownMs: 60_000, // دقيقة واحدة
  serviceName: 'unknown',
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastFailureAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private openedAt: string | null = null;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private config: CircuitConfig;

  constructor(config: Partial<CircuitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** هل يُمكن إرسال طلب الآن؟ */
  canRequest(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'HALF_OPEN') return true; // طلب اختبار واحد
    if (this.state === 'OPEN') {
      // تحقق من انقضاء cooldown
      if (this.openedAt) {
        const elapsed = Date.now() - new Date(this.openedAt).getTime();
        if (elapsed >= this.config.cooldownMs) {
          this.transitionTo('HALF_OPEN');
          return true;
        }
      }
      return false;
    }
    return false;
  }

  /** تسجيل نجاح */
  recordSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccessAt = new Date().toISOString();
    this.consecutiveFailures = 0;
    if (this.state !== 'CLOSED') {
      this.transitionTo('CLOSED');
    }
  }

  /** تسجيل فشل */
  recordFailure(errorCode?: string): void {
    this.totalFailures++;
    this.consecutiveFailures++;
    this.lastFailureAt = new Date().toISOString();

    if (this.state === 'HALF_OPEN') {
      // فشل في HALF_OPEN → عودة للـ OPEN مع cooldown مضاعف
      this.config.cooldownMs = Math.min(this.config.cooldownMs * 2, 300_000);
      this.transitionTo('OPEN');
    } else if (this.state === 'CLOSED' && this.consecutiveFailures >= this.config.failureThreshold) {
      this.transitionTo('OPEN');
    }

    logEvent(
      'circuit_breaker_failure',
      `${this.config.serviceName} failure #${this.consecutiveFailures}`,
      { errorCode, state: this.state }
    ).catch(() => undefined);
  }

  getState(): CircuitState {
    return this.state;
  }

  getSnapshot(): CircuitSnapshot {
    const nextHalfOpenAt = this.openedAt
      ? new Date(new Date(this.openedAt).getTime() + this.config.cooldownMs).toISOString()
      : null;
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      openedAt: this.openedAt,
      nextHalfOpenAt,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  private transitionTo(next: CircuitState): void {
    const prev = this.state;
    this.state = next;
    if (next === 'OPEN') {
      this.openedAt = new Date().toISOString();
    } else if (next === 'CLOSED') {
      this.openedAt = null;
      this.consecutiveFailures = 0;
    }
    logEvent(
      'circuit_breaker_transition',
      `${this.config.serviceName}: ${prev} → ${next}`,
      { consecutiveFailures: this.consecutiveFailures }
    ).catch(() => undefined);
  }
}

// ─────────────────────────────────────────────────────────────
// Singleton instances — واحدة لكل خدمة خارجية
// ─────────────────────────────────────────────────────────────

export const backendCircuit = new CircuitBreaker({
  serviceName: 'backend',
  failureThreshold: 5,
  cooldownMs: 60_000,
});

export const realtimeCircuit = new CircuitBreaker({
  serviceName: 'realtime',
  failureThreshold: 3,
  cooldownMs: 30_000,
});

/**
 * تنفيذ دالة مع Circuit Breaker
 * إذا كان Circuit مفتوحاً → throw بدلاً من إرسال طلب
 */
export async function withCircuitBreaker<T>(
  circuit: CircuitBreaker,
  fn: () => Promise<T>
): Promise<T> {
  if (!circuit.canRequest()) {
    const snap = circuit.getSnapshot();
    throw new Error(
      `CircuitBreaker OPEN — next retry at ${snap.nextHalfOpenAt ?? 'unknown'}`
    );
  }

  try {
    const result = await fn();
    circuit.recordSuccess();
    return result;
  } catch (err) {
    const code = err instanceof Error ? err.message.slice(0, 50) : 'UNKNOWN';
    circuit.recordFailure(code);
    throw err;
  }
}
