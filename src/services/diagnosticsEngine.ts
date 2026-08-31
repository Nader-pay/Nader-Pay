/**
 * diagnosticsEngine.ts
 * محرك التشخيص — يُتابع صحة كل Module بشكل مستقل ويمنع تكرار الأخطاء المتشابهة.
 *
 * المميزات:
 * - rate-limiting: نفس الخطأ لا يُسجَّل أكثر من مرة كل 30 ثانية
 * - occurrenceCount / firstSeen / lastSeen لكل حدث
 * - HealthMonitor: حالة مستقلة لكل module
 * - تصنيف الأخطاء: TRANSIENT / CONFIGURATION / PERMISSION / DATABASE / NETWORK / UNKNOWN
 */

import { recordDedupEvent, logEvent } from '@/lib/database';

// ────────────────────────────────────────────────
// أنواع الأخطاء
// ────────────────────────────────────────────────

export type ErrorSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
export type ErrorCategory =
  | 'NETWORK'
  | 'PERMISSION'
  | 'DATABASE'
  | 'CONFIGURATION'
  | 'TRANSIENT'
  | 'AUTHENTICATION'
  | 'UNKNOWN';

export function classifyError(message: string): ErrorCategory {
  const m = message.toLowerCase();
  if (m.includes('network') || m.includes('offline') || m.includes('timeout') || m.includes('fetch')) return 'NETWORK';
  if (m.includes('permission') || m.includes('denied') || m.includes('sms') || m.includes('notification')) return 'PERMISSION';
  if (m.includes('database') || m.includes('sqlite') || m.includes('migration') || m.includes('db')) return 'DATABASE';
  if (m.includes('config') || m.includes('profile') || m.includes('url') || m.includes('invalid')) return 'CONFIGURATION';
  if (m.includes('401') || m.includes('403') || m.includes('unauthorized') || m.includes('forbidden')) return 'AUTHENTICATION';
  if (m.includes('temporary') || m.includes('retry') || m.includes('5xx') || m.includes('500')) return 'TRANSIENT';
  return 'UNKNOWN';
}

// ────────────────────────────────────────────────
// Module Health
// ────────────────────────────────────────────────

export type ModuleName =
  | 'database'
  | 'network'
  | 'realtime'
  | 'runtime'
  | 'sms'
  | 'background'
  | 'sync'
  | 'matching'
  | 'device'
  | 'notifications'
  | 'trusted_sources';

export type ModuleHealth = {
  status: 'HEALTHY' | 'DEGRADED' | 'ERROR' | 'UNKNOWN';
  lastCheckedAt: string | null;
  lastError: string | null;
  errorCategory: ErrorCategory | null;
  consecutiveErrors: number;
  totalEvents: number;
};

type HealthMap = Record<ModuleName, ModuleHealth>;

const DEFAULT_HEALTH: ModuleHealth = {
  status: 'UNKNOWN',
  lastCheckedAt: null,
  lastError: null,
  errorCategory: null,
  consecutiveErrors: 0,
  totalEvents: 0,
};

const healthMap: HealthMap = {
  database: { ...DEFAULT_HEALTH },
  network: { ...DEFAULT_HEALTH },
  realtime: { ...DEFAULT_HEALTH },
  runtime: { ...DEFAULT_HEALTH },
  sms: { ...DEFAULT_HEALTH },
  background: { ...DEFAULT_HEALTH },
  sync: { ...DEFAULT_HEALTH },
  matching: { ...DEFAULT_HEALTH },
  device: { ...DEFAULT_HEALTH },
  notifications: { ...DEFAULT_HEALTH },
  trusted_sources: { ...DEFAULT_HEALTH },
};

// ────────────────────────────────────────────────
// Rate-limit في الذاكرة (قبل الوصول لـ DB)
// ────────────────────────────────────────────────

const inMemoryDedup = new Map<string, number>(); // dedupKey → lastSeenTimestamp
const RATE_LIMIT_MS = 30_000; // 30 ثانية

function isRateLimited(dedupKey: string): boolean {
  const last = inMemoryDedup.get(dedupKey);
  if (last !== undefined && Date.now() - last < RATE_LIMIT_MS) return true;
  inMemoryDedup.set(dedupKey, Date.now());
  return false;
}

// ────────────────────────────────────────────────
// logDiagnosticEvent
// ────────────────────────────────────────────────

export type DiagnosticEventOpts = {
  severity?: ErrorSeverity;
  category?: ErrorCategory;
  module?: ModuleName;
  /** مفتاح dedup — إذا لم يُمرَّر يُحسب من eventType + message */
  dedupKey?: string;
  /** payload إضافي يُسجَّل في agent_events */
  payload?: Record<string, unknown>;
};

export async function logDiagnosticEvent(
  eventType: string,
  message: string,
  opts: DiagnosticEventOpts = {}
): Promise<{ isNew: boolean; occurrenceCount: number }> {
  const { severity = 'INFO', module, payload = {} } = opts;
  const category = opts.category ?? classifyError(message);
  const dedupKey = opts.dedupKey ?? `${eventType}:${message.slice(0, 100)}`;

  // rate-limit في الذاكرة أولاً
  if (isRateLimited(dedupKey)) {
    return { isNew: false, occurrenceCount: -1 }; // تم تجاهله — معدل مرتفع
  }

  // تسجيل deduplication في DB
  const dedup = await recordDedupEvent(dedupKey, eventType);

  // تسجيل في agent_events فقط إذا كان حدثاً جديداً أو كل 5 تكرارات
  if (dedup.isNew || dedup.occurrenceCount % 5 === 0) {
    await logEvent(eventType, message, {
      severity,
      category,
      module: module ?? 'unknown',
      occurrenceCount: dedup.occurrenceCount,
      dedupKey,
      ...payload,
    });
  }

  // تحديث حالة الـ module
  if (module) {
    updateModuleHealth(module, message, severity, category);
  }

  return { isNew: dedup.isNew, occurrenceCount: dedup.occurrenceCount };
}

// ────────────────────────────────────────────────
// HealthMonitor API
// ────────────────────────────────────────────────

export function markModuleHealthy(module: ModuleName): void {
  const now = new Date().toISOString();
  healthMap[module] = {
    ...healthMap[module],
    status: 'HEALTHY',
    lastCheckedAt: now,
    lastError: null,
    errorCategory: null,
    consecutiveErrors: 0,
    totalEvents: healthMap[module].totalEvents + 1,
  };
}

export function markModuleDegraded(module: ModuleName, reason: string): void {
  const now = new Date().toISOString();
  healthMap[module] = {
    ...healthMap[module],
    status: 'DEGRADED',
    lastCheckedAt: now,
    lastError: reason,
    errorCategory: classifyError(reason),
    consecutiveErrors: healthMap[module].consecutiveErrors + 1,
    totalEvents: healthMap[module].totalEvents + 1,
  };
}

export function markModuleError(module: ModuleName, error: string, category?: ErrorCategory): void {
  const now = new Date().toISOString();
  healthMap[module] = {
    ...healthMap[module],
    status: 'ERROR',
    lastCheckedAt: now,
    lastError: error,
    errorCategory: category ?? classifyError(error),
    consecutiveErrors: healthMap[module].consecutiveErrors + 1,
    totalEvents: healthMap[module].totalEvents + 1,
  };
}

function updateModuleHealth(
  module: ModuleName,
  message: string,
  severity: ErrorSeverity,
  category: ErrorCategory
): void {
  const now = new Date().toISOString();
  const prev = healthMap[module];
  if (severity === 'INFO') {
    healthMap[module] = { ...prev, status: 'HEALTHY', lastCheckedAt: now, consecutiveErrors: 0, totalEvents: prev.totalEvents + 1 };
  } else if (severity === 'WARNING') {
    healthMap[module] = { ...prev, status: 'DEGRADED', lastCheckedAt: now, lastError: message, errorCategory: category, consecutiveErrors: prev.consecutiveErrors + 1, totalEvents: prev.totalEvents + 1 };
  } else {
    healthMap[module] = { ...prev, status: 'ERROR', lastCheckedAt: now, lastError: message, errorCategory: category, consecutiveErrors: prev.consecutiveErrors + 1, totalEvents: prev.totalEvents + 1 };
  }
}

export function getModuleHealth(module: ModuleName): ModuleHealth {
  return { ...healthMap[module] };
}

export function getAllModuleHealth(): HealthMap {
  return Object.fromEntries(
    Object.entries(healthMap).map(([k, v]) => [k, { ...v }])
  ) as HealthMap;
}

export function getOverallSystemHealth(): 'HEALTHY' | 'DEGRADED' | 'ERROR' {
  const statuses = Object.values(healthMap).map((h) => h.status);
  if (statuses.some((s) => s === 'ERROR')) return 'ERROR';
  if (statuses.some((s) => s === 'DEGRADED')) return 'DEGRADED';
  return 'HEALTHY';
}

// ────────────────────────────────────────────────
// Database/Sync/Background حالات حقيقية
// ────────────────────────────────────────────────

export type DatabaseStatus = 'READY' | 'MIGRATION_REQUIRED' | 'ERROR';
export type SyncStatus = 'SYNCED' | 'PENDING' | 'SYNCING' | 'FAILED';
export type BackgroundStatus = 'RUNNING' | 'RESTRICTED' | 'STOPPED';

let _dbStatus: DatabaseStatus = 'READY';
let _syncStatus: SyncStatus = 'SYNCED';
let _backgroundStatus: BackgroundStatus = 'STOPPED';

export function setDatabaseStatus(s: DatabaseStatus): void { _dbStatus = s; }
export function setSyncStatus(s: SyncStatus): void { _syncStatus = s; }
export function setBackgroundStatus(s: BackgroundStatus): void { _backgroundStatus = s; }

export function getDatabaseStatus(): DatabaseStatus { return _dbStatus; }
export function getSyncStatus(): SyncStatus { return _syncStatus; }
export function getBackgroundStatus(): BackgroundStatus { return _backgroundStatus; }

/** تُحسب حالة Database من pendingSyncCount + queue بشكل حقيقي */
export function computeSyncStatus(pending: number, syncing: boolean, lastFailed: boolean): SyncStatus {
  if (syncing) return 'SYNCING';
  if (pending > 0 && lastFailed) return 'FAILED';
  if (pending > 0) return 'PENDING';
  return 'SYNCED';
}

/** تنظيف dedup في الذاكرة من الإدخالات القديمة (>5 دقائق) */
export function pruneInMemoryDedup(): void {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [key, ts] of inMemoryDedup.entries()) {
    if (ts < cutoff) inMemoryDedup.delete(key);
  }
}

// ────────────────────────────────────────────────
// Health Score حقيقي (يُكمّل supervisorEngine)
// ────────────────────────────────────────────────

/**
 * يُحسَب Health Score من healthMap الداخلي.
 * HEALTHY=100, DEGRADED=50, ERROR/UNKNOWN=0
 * Critical modules (database, network, runtime) بوزن مضاعف.
 */
const CRITICAL_MODULES: ModuleName[] = ['database', 'network', 'runtime'];

export function computeHealthScoreFromMap(): number {
  const entries = Object.entries(healthMap) as [ModuleName, ModuleHealth][];
  if (entries.length === 0) return 0;

  let totalWeight = 0;
  let earnedWeight = 0;

  for (const [name, health] of entries) {
    const weight = CRITICAL_MODULES.includes(name) ? 2 : 1;
    totalWeight += weight;
    if (health.status === 'HEALTHY') earnedWeight += weight;
    else if (health.status === 'DEGRADED') earnedWeight += weight * 0.5;
    // ERROR / UNKNOWN = 0
  }

  return totalWeight === 0 ? 0 : Math.round((earnedWeight / totalWeight) * 100);
}

/**
 * نص قابل للعرض في UI يصف الحالة الكاملة للنظام.
 */
export function getSystemHealthLabel(): string {
  const score = computeHealthScoreFromMap();
  if (score >= 85) return `سليم (${score}%)`;
  if (score >= 60) return `مخفّض (${score}%)`;
  if (score >= 30) return `ضعيف (${score}%)`;
  return `حرج (${score}%)`;
}

// ────────────────────────────────────────────────
// Structured Audit Trail (ring buffer in memory + DB)
// ────────────────────────────────────────────────

export type AuditEntry = {
  ts: string;
  action: string;
  orderId: string | null;
  module: ModuleName | null;
  result: 'ok' | 'fail' | 'warn';
  detail: string;
};

const _auditBuffer: AuditEntry[] = [];
const MAX_AUDIT_BUFFER = 200;

export function recordAuditEntry(entry: AuditEntry): void {
  _auditBuffer.unshift(entry);
  if (_auditBuffer.length > MAX_AUDIT_BUFFER) _auditBuffer.length = MAX_AUDIT_BUFFER;
}

export function getAuditTrail(limit = 50): AuditEntry[] {
  return _auditBuffer.slice(0, limit);
}
