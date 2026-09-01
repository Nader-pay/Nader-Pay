/**
 * supervisorEngine.ts
 * Agent Supervisor + Watchdog — المراقب المركزي لكل Module.
 *
 * المبادئ:
 *   - كل Module له حالة مستقلة: HEALTHY / DEGRADED / UNRESPONSIVE / FAILED / RECOVERING / STOPPED
 *   - فشل module واحد لا يُوقف الـ Agent إلا إذا كان dependency أساسي
 *   - Restart مع exponential backoff + jitter — لا restart loops
 *   - منع duplicate workers/subscriptions
 *   - كل restart يُسجَّل مع root cause
 *   - Health score يُحسَب من حالات الـ modules الفعلية
 */

import { logEvent } from '@/lib/database';
import { markModuleHealthy, markModuleError, markModuleDegraded, type ModuleName } from './diagnosticsEngine';

// ─────────────────────────────────────────────────────────────
// أنواع
// ─────────────────────────────────────────────────────────────

export type ModuleStatus =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNRESPONSIVE'
  | 'FAILED'
  | 'RECOVERING'
  | 'STOPPED';

export type ModuleRecord = {
  name: ModuleName;
  /** هل يمنع توقفه عمل الـ Agent الآمن؟ */
  isCritical: boolean;
  status: ModuleStatus;
  lifecycleState: 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';
  failureCount: number;
  lastFailureAt: string | null;
  lastRecoveryAt: string | null;
  lastSuccessAt: string | null;
  lastHeartbeatAt: string | null;
  lastErrorCode: string | null;
  consecutiveFailures: number;
  recoveryState: 'idle' | 'scheduled' | 'in_progress';
  nextRetryAt: string | null;
  start: (() => Promise<void>) | null;
  stop: (() => Promise<void>) | null;
  healthCheck: (() => Promise<boolean>) | null;
};

export type SupervisorSnapshot = {
  overallStatus: 'HEALTHY' | 'DEGRADED' | 'BLOCKED' | 'ERROR';
  healthScore: number; // 0–100
  modules: Record<ModuleName, {
    status: ModuleStatus;
    isCritical: boolean;
    consecutiveFailures: number;
    lastFailureAt: string | null;
    lastHeartbeatAt: string | null;
    lastErrorCode: string | null;
  }>;
};

// ─────────────────────────────────────────────────────────────
// Backoff
// ─────────────────────────────────────────────────────────────

const MAX_RESTART_ATTEMPTS = 5;
const BASE_RESTART_DELAY_MS = 2_000;

function computeRestartDelay(attempt: number): number {
  const base = Math.min(BASE_RESTART_DELAY_MS * Math.pow(2, attempt), 120_000);
  return base + Math.floor(Math.random() * 1000);
}

// ─────────────────────────────────────────────────────────────
// Supervisor State
// ─────────────────────────────────────────────────────────────

const modules = new Map<ModuleName, ModuleRecord>();
const restartTimers = new Map<ModuleName, ReturnType<typeof setTimeout>>();

function getOrCreateModule(name: ModuleName, isCritical = false): ModuleRecord {
  if (!modules.has(name)) {
    modules.set(name, {
      name,
      isCritical,
      status: 'STOPPED',
      lifecycleState: 'idle',
      failureCount: 0,
      lastFailureAt: null,
      lastRecoveryAt: null,
      lastSuccessAt: null,
      lastHeartbeatAt: null,
      lastErrorCode: null,
      consecutiveFailures: 0,
      recoveryState: 'idle',
      nextRetryAt: null,
      start: null,
      stop: null,
      healthCheck: null,
    });
  }
  return modules.get(name)!;
}

/**
 * تسجيل Module في الـ Supervisor.
 */
export function registerModule(
  name: ModuleName,
  opts: {
    isCritical?: boolean;
    start?: () => Promise<void>;
    stop?: () => Promise<void>;
    healthCheck?: () => Promise<boolean>;
  } = {}
): void {
  const mod = getOrCreateModule(name, opts.isCritical ?? false);
  if (opts.start) mod.start = opts.start;
  if (opts.stop) mod.stop = opts.stop;
  if (opts.healthCheck) mod.healthCheck = opts.healthCheck;
}

/**
 * تسجيل heartbeat لـ module — يُحدَّث عند كل نشاط ناجح.
 */
export function recordHeartbeat(name: ModuleName): void {
  const mod = getOrCreateModule(name);
  mod.lastHeartbeatAt = new Date().toISOString();
  mod.lastSuccessAt = mod.lastHeartbeatAt;
  mod.consecutiveFailures = 0;
  if (mod.status !== 'HEALTHY') {
    mod.status = 'HEALTHY';
    markModuleHealthy(name);
  }
}

/**
 * تسجيل فشل لـ module.
 */
export async function recordModuleFailure(
  name: ModuleName,
  errorCode: string,
  opts: { shouldRestart?: boolean } = {}
): Promise<void> {
  const mod = getOrCreateModule(name);
  mod.failureCount++;
  mod.consecutiveFailures++;
  mod.lastFailureAt = new Date().toISOString();
  mod.lastErrorCode = errorCode;

  await logEvent('supervisor_module_failure', `${name}: ${errorCode}`, {
    consecutiveFailures: mod.consecutiveFailures,
    failureCount: mod.failureCount,
  });
  markModuleError(name, errorCode);

  if (mod.consecutiveFailures >= MAX_RESTART_ATTEMPTS) {
    mod.status = 'FAILED';
    await logEvent('supervisor_module_failed', `${name} exceeded max failures — FAILED`, { errorCode });
    return;
  }

  if (mod.consecutiveFailures >= 2) {
    mod.status = 'UNRESPONSIVE';
  } else {
    mod.status = 'DEGRADED';
    markModuleDegraded(name, errorCode);
  }

  if (opts.shouldRestart && mod.start && mod.recoveryState === 'idle') {
    scheduleRestart(name);
  }
}

/**
 * جدولة إعادة تشغيل module مع backoff.
 */
function scheduleRestart(name: ModuleName): void {
  const mod = modules.get(name);
  if (!mod || mod.recoveryState !== 'idle') return;

  // منع duplicate restart timers
  if (restartTimers.has(name)) {
    clearTimeout(restartTimers.get(name)!);
    restartTimers.delete(name);
  }

  const delay = computeRestartDelay(mod.consecutiveFailures);
  const nextRetry = new Date(Date.now() + delay).toISOString();
  mod.recoveryState = 'scheduled';
  mod.nextRetryAt = nextRetry;
  mod.status = 'RECOVERING';

  logEvent('supervisor_restart_scheduled', `${name} restart in ${delay}ms`, {
    consecutiveFailures: mod.consecutiveFailures,
  }).catch(() => undefined);

  const timer = setTimeout(async () => {
    restartTimers.delete(name);
    await attemptRestart(name);
  }, delay);

  restartTimers.set(name, timer);
}

async function attemptRestart(name: ModuleName): Promise<void> {
  const mod = modules.get(name);
  if (!mod || !mod.start) return;

  mod.recoveryState = 'in_progress';
  mod.lifecycleState = 'starting';

  try {
    // أوقف أولاً بأمان
    if (mod.stop) {
      try { await mod.stop(); } catch { /* تجاهل أخطاء الإيقاف */ }
    }

    await mod.start();

    mod.lifecycleState = 'running';
    mod.status = 'HEALTHY';
    mod.consecutiveFailures = 0;
    mod.lastRecoveryAt = new Date().toISOString();
    mod.recoveryState = 'idle';
    mod.nextRetryAt = null;
    markModuleHealthy(name);

    await logEvent('supervisor_restart_success', `${name} restarted successfully`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    mod.lifecycleState = 'stopped';
    mod.recoveryState = 'idle';
    await recordModuleFailure(name, msg, { shouldRestart: true });
  }
}

/**
 * إيقاف module بأمان.
 */
export async function stopModule(name: ModuleName): Promise<void> {
  const mod = modules.get(name);
  if (!mod) return;

  // إلغاء أي restart مجدول
  if (restartTimers.has(name)) {
    clearTimeout(restartTimers.get(name)!);
    restartTimers.delete(name);
  }

  mod.lifecycleState = 'stopping';
  mod.recoveryState = 'idle';

  if (mod.stop) {
    try { await mod.stop(); } catch { /* تجاهل */ }
  }

  mod.lifecycleState = 'stopped';
  mod.status = 'STOPPED';
}

/**
 * تشغيل health check لـ module وتحديث حالته.
 */
export async function checkModuleHealth(name: ModuleName): Promise<boolean> {
  const mod = modules.get(name);
  if (!mod || !mod.healthCheck) return true; // بدون healthCheck → نفترض سليم

  try {
    const healthy = await mod.healthCheck();
    if (healthy) {
      recordHeartbeat(name);
      return true;
    } else {
      await recordModuleFailure(name, 'health_check_failed');
      return false;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'health_check_exception';
    await recordModuleFailure(name, msg);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Overall Health Score
// ─────────────────────────────────────────────────────────────

/**
 * يُحسَب Health Score الحقيقي من حالات الـ modules:
 * - كل module HEALTHY = نقاط كاملة
 * - DEGRADED = نصف النقاط
 * - FAILED/UNRESPONSIVE = صفر
 * - Critical modules لها وزن مضاعف
 */
export function computeHealthScore(): number {
  if (modules.size === 0) return 0;

  let totalWeight = 0;
  let earnedWeight = 0;

  for (const mod of modules.values()) {
    const weight = mod.isCritical ? 2 : 1;
    totalWeight += weight;

    if (mod.status === 'HEALTHY') earnedWeight += weight;
    else if (mod.status === 'DEGRADED') earnedWeight += weight * 0.5;
    else if (mod.status === 'RECOVERING') earnedWeight += weight * 0.25;
    // FAILED / UNRESPONSIVE / STOPPED = 0
  }

  return totalWeight === 0 ? 0 : Math.round((earnedWeight / totalWeight) * 100);
}

/**
 * يُحدد الحالة الإجمالية للـ Agent بناءً على الـ modules.
 */
export function computeOverallStatus(): SupervisorSnapshot['overallStatus'] {
  const score = computeHealthScore();
  const hasCriticalFailure = [...modules.values()].some(
    (m) => m.isCritical && (m.status === 'FAILED' || m.status === 'UNRESPONSIVE')
  );

  if (hasCriticalFailure) return 'ERROR';
  if (score >= 80) return 'HEALTHY';
  if (score >= 40) return 'DEGRADED';
  return 'BLOCKED';
}

export function getSupervisorSnapshot(): SupervisorSnapshot {
  const moduleStates = {} as SupervisorSnapshot['modules'];
  for (const [name, mod] of modules.entries()) {
    moduleStates[name] = {
      status: mod.status,
      isCritical: mod.isCritical,
      consecutiveFailures: mod.consecutiveFailures,
      lastFailureAt: mod.lastFailureAt,
      lastHeartbeatAt: mod.lastHeartbeatAt,
      lastErrorCode: mod.lastErrorCode,
    };
  }

  return {
    overallStatus: computeOverallStatus(),
    healthScore: computeHealthScore(),
    modules: moduleStates,
  };
}

/**
 * تشغيل دورة health check لجميع الـ modules المسجلة.
 */
export async function runHealthCycle(): Promise<void> {
  const checks = [...modules.keys()].map((name) => checkModuleHealth(name));
  await Promise.allSettled(checks);
}
