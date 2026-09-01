/**
 * agentRuntime.ts
 * ================
 * الخدمة المركزية لإدارة حالة الـ Agent Runtime بشكل مستقل.
 *
 * الحالات الموحدة (RuntimeStatus):
 *   DISABLED      — الوكيل معطل من الإعدادات
 *   STARTING      — جاري التهيئة (أول تشغيل / بعد restart)
 *   RUNNING       — يعمل بشكل كامل (backend متصل + realtime/polling نشط)
 *   DEGRADED      — يعمل لكن بقدرة مخفضة (polling بدل realtime / backend path_restricted)
 *   RECONNECTING  — يحاول إعادة الاتصال بعد انقطاع
 *   ERROR         — خطأ يمنع التشغيل الكامل (يظهر للمستخدم مع السبب)
 *   OFFLINE       — لا يوجد اتصال بالإنترنت
 *
 * المبادئ:
 *   - event-driven: الـ ticker لا يعمل بحلقات مستمرة بل بـ setTimeout
 *   - فصل تام: agentRunning لا يعني backendOnline ولا العكس
 *   - verifiedProviderSources=0 ليس فشلاً في الـ runtime
 *   - لا يُعرض 'running' إلا إذا كان هناك دليل فعلي
 */

import { logEvent } from '@/lib/database';
import { recordHeartbeat, recordModuleFailure } from '@/services/supervisorEngine';
import { getNetworkSnapshot } from '@/services/networkIntelligence';

export type RuntimeStatus =
  | 'DISABLED'
  | 'STARTING'
  | 'RUNNING'
  | 'DEGRADED'
  | 'RECONNECTING'
  | 'ERROR'
  | 'OFFLINE';

export type RuntimeSnapshot = {
  status: RuntimeStatus;
  reason: string | null;
  startedAt: string | null;
  lastTickAt: string | null;
  consecutiveErrors: number;
  /** وصف قابل للعرض في UI */
  label: string;
  /** هل الـ agent يُعالج الأوامر الواردة؟ */
  isProcessing: boolean;
};

type TickCallback = () => Promise<{ ok: boolean; error?: string; realtimeStatus?: string }>;
type StatusChangeCallback = (snapshot: RuntimeSnapshot) => void;

// ====== State الداخلي ======
let _status: RuntimeStatus = 'DISABLED';
let _reason: string | null = null;
let _startedAt: string | null = null;
let _lastTickAt: string | null = null;
let _consecutiveErrors = 0;
let _enabled = false;
let _deviceRegistered = false;
let _tickCallback: TickCallback | null = null;
let _statusCallback: StatusChangeCallback | null = null;
let _tickTimer: ReturnType<typeof setTimeout> | null = null;

// معاملات الـ ticker
const TICK_INTERVAL_NORMAL_MS = 30_000;     // 30 ثانية - وضع عادي
const TICK_INTERVAL_DEGRADED_MS = 60_000;   // دقيقة - وضع مخفض
const TICK_INTERVAL_RECONNECT_MS = 15_000;  // 15 ثانية - محاولة إعادة اتصال
const MAX_CONSECUTIVE_ERRORS = 5;

// ====== واجهة القراءة ======

export function getRuntimeSnapshot(): RuntimeSnapshot {
  return {
    status: _status,
    reason: _reason,
    startedAt: _startedAt,
    lastTickAt: _lastTickAt,
    consecutiveErrors: _consecutiveErrors,
    label: runtimeLabel(_status),
    isProcessing: _status === 'RUNNING' || _status === 'DEGRADED',
  };
}

export function getRuntimeStatus(): RuntimeStatus {
  return _status;
}

function runtimeLabel(status: RuntimeStatus): string {
  switch (status) {
    case 'DISABLED': return 'الوكيل معطل';
    case 'STARTING': return 'جاري التشغيل...';
    case 'RUNNING': return 'يعمل';
    case 'DEGRADED': return 'يعمل (وضع مخفض)';
    case 'RECONNECTING': return 'إعادة الاتصال...';
    case 'ERROR': return 'خطأ في التشغيل';
    case 'OFFLINE': return 'لا يوجد اتصال';
  }
}

// ====== تغيير الحالة ======

function setStatus(status: RuntimeStatus, reason: string | null = null) {
  const prev = _status;
  _status = status;
  _reason = reason;
  if (prev !== status) {
    logEvent('runtime_status', `${prev} → ${status}`, { reason }).catch(() => undefined);
    _statusCallback?.(getRuntimeSnapshot());
  }
}

// ====== بدء / إيقاف ======

export async function startRuntime(opts: {
  enabled: boolean;
  deviceRegistered: boolean;
  online: boolean;
  tick: TickCallback;
  onStatusChange?: StatusChangeCallback;
}): Promise<void> {
  _enabled = opts.enabled;
  _deviceRegistered = opts.deviceRegistered;
  _tickCallback = opts.tick;
  _statusCallback = opts.onStatusChange ?? null;

  // إيقاف أي ticker سابق
  stopTicker();

  if (!opts.enabled) {
    setStatus('DISABLED', 'الوكيل معطل من الإعدادات');
    return;
  }

  if (!opts.deviceRegistered) {
    setStatus('ERROR', 'الجهاز غير مسجل — يرجى تسجيل الجهاز أولاً');
    return;
  }

  if (!opts.online) {
    setStatus('OFFLINE', 'لا يوجد اتصال بالإنترنت');
    // نبدأ ticker بمعدل بطيء للانتظار حتى يعود الإنترنت
    scheduleTick(TICK_INTERVAL_RECONNECT_MS);
    return;
  }

  _startedAt = new Date().toISOString();
  _consecutiveErrors = 0;
  setStatus('STARTING', 'جاري التهيئة الأولية');

  await doTick();
}

export function stopRuntime(): void {
  stopTicker();
  _enabled = false;
  setStatus('DISABLED', 'تم إيقاف الوكيل');
  _startedAt = null;
  _tickCallback = null;
}

/** استئناف الـ runtime بعد رجوع التطبيق للواجهة أو reconnect */
export async function resumeRuntime(online: boolean): Promise<void> {
  if (!_enabled || !_tickCallback) return;

  if (!online) {
    setStatus('OFFLINE', 'لا يوجد اتصال بالإنترنت');
    return;
  }

  // إذا كنا في حالة OFFLINE أو ERROR → نحاول مجدداً
  if (_status === 'OFFLINE' || _status === 'ERROR' || _status === 'RECONNECTING') {
    _consecutiveErrors = 0;
    setStatus('RECONNECTING', 'إعادة الاتصال بعد انقطاع');
    stopTicker();
    await doTick();
  }
}

/** إخبار الـ runtime بتغيير حالة الشبكة */
export async function notifyNetworkChange(online: boolean): Promise<void> {
  if (!_enabled) return;

  if (!online && _status !== 'OFFLINE') {
    stopTicker();
    setStatus('OFFLINE', 'انقطع الاتصال بالإنترنت');
    // ticker بطيء لرصد العودة
    scheduleTick(TICK_INTERVAL_RECONNECT_MS);
    return;
  }

  if (online && (_status === 'OFFLINE' || _status === 'ERROR')) {
    await resumeRuntime(true);
  }
}

// ====== الـ Ticker الداخلي ======

function stopTicker() {
  if (_tickTimer) {
    clearTimeout(_tickTimer);
    _tickTimer = null;
  }
}

function scheduleTick(delayMs: number) {
  stopTicker();
  _tickTimer = setTimeout(async () => {
    _tickTimer = null;
    await doTick();
  }, delayMs);
}

async function doTick() {
  if (!_enabled || !_tickCallback) return;

  try {
    _lastTickAt = new Date().toISOString();
    const result = await _tickCallback();

    if (result.ok) {
      _consecutiveErrors = 0;
      // Phase 3: سجّل heartbeat في Supervisor
      recordHeartbeat('runtime');
      // تحديد الحالة بناءً على نوع اتصال realtime
      const rt = result.realtimeStatus ?? 'unknown';
      if (rt === 'connected') {
        setStatus('RUNNING', null);
      } else {
        // polling أو disconnected = degraded لكن يعمل
        setStatus('DEGRADED', rt === 'polling' ? 'Polling كـ fallback (لا Realtime)' : 'Realtime غير متصل');
      }
      scheduleTick(rt === 'connected' ? TICK_INTERVAL_NORMAL_MS : TICK_INTERVAL_DEGRADED_MS);
    } else {
      _consecutiveErrors += 1;
      // Phase 3: سجّل الفشل في Supervisor
      recordModuleFailure('runtime', result.error || 'tick_failed', { shouldRestart: _consecutiveErrors >= MAX_CONSECUTIVE_ERRORS });
      if (_consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        setStatus('ERROR', result.error || 'تجاوز الحد الأقصى للأخطاء المتتالية');
        // لا نُعيد الـ ticker تلقائياً — نترك resumeRuntime لإعادة التشغيل
      } else {
        setStatus('RECONNECTING', result.error || 'محاولة إعادة الاتصال');
        scheduleTick(TICK_INTERVAL_RECONNECT_MS);
      }
    }
  } catch (err) {
    _consecutiveErrors += 1;
    const msg = err instanceof Error ? err.message : 'خطأ غير متوقع في الـ tick';
    await logEvent('runtime_tick_error', msg).catch(() => undefined);
    // Phase 3: سجّل الفشل في Supervisor
    recordModuleFailure('runtime', msg, { shouldRestart: _consecutiveErrors >= MAX_CONSECUTIVE_ERRORS });

    if (_consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      setStatus('ERROR', msg);
    } else {
      setStatus('RECONNECTING', msg);
      scheduleTick(TICK_INTERVAL_RECONNECT_MS);
    }
  }
}
