// فهرس رسائل SMS المحلي — يخزّن رسائل Vodafone Cash في SQLite
// لاستخدامها في عملية توثيق المصادر

import * as SQLite from 'expo-sqlite';

const dbReady = SQLite.openDatabaseAsync('naderpay_agent.db');

// إنشاء الجداول عند أول استيراد للموديل
async function ensureTables(): Promise<SQLite.SQLiteDatabase> {
  const db = await dbReady;
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS local_sms_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE,
      originating_address TEXT NOT NULL,
      body TEXT NOT NULL,
      date TEXT NOT NULL,
      provider_guess TEXT,
      parsed_transaction TEXT,
      hash TEXT,
      indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS provider_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'phone',
      display_name TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      last_verification_at TEXT,
      last_verification_result TEXT,
      verification_attempts INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(provider_id, source_id)
    );

    CREATE TABLE IF NOT EXISTS source_verification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_source_id INTEGER,
      provider_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      action TEXT NOT NULL,
      result TEXT,
      reason TEXT,
      message_count_tested INTEGER,
      message_count_passed INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sms_index_address ON local_sms_index(originating_address);
    CREATE INDEX IF NOT EXISTS idx_sms_index_date ON local_sms_index(date DESC);
    CREATE INDEX IF NOT EXISTS idx_provider_sources_provider ON provider_sources(provider_id);
    CREATE INDEX IF NOT EXISTS idx_source_logs_provider ON source_verification_logs(provider_id, source_id);
  `);

  // Migration: تأكد من وجود provider_sources حتى في قواعد البيانات القديمة
  try {
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('local_sms_index','provider_sources','source_verification_logs')"
    );
    const names = new Set(tables.map((t) => t.name));
    if (!names.has('local_sms_index') || !names.has('provider_sources') || !names.has('source_verification_logs')) {
      // إعادة تشغيل CREATE TABLE IF NOT EXISTS آمنة
    }
  } catch {
    // تجاهل أخطاء الفحص
  }

  return db;
}

const dbInit = ensureTables();

// ---- فهرس SMS ----

export async function indexSmsMessage(msg: {
  messageId: string;
  originatingAddress: string;
  body: string;
  date: string;
  providerGuess?: string | null;
  parsedTransaction?: Record<string, unknown> | null;
  hash?: string | null;
}): Promise<void> {
  const db = await dbInit;
  await db.runAsync(
    `INSERT INTO local_sms_index
      (message_id, originating_address, body, date, provider_guess, parsed_transaction, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET
       provider_guess = excluded.provider_guess,
       parsed_transaction = excluded.parsed_transaction,
       hash = excluded.hash,
       indexed_at = datetime('now')`,
    [
      msg.messageId,
      msg.originatingAddress,
      msg.body,
      msg.date,
      msg.providerGuess ?? null,
      msg.parsedTransaction ? JSON.stringify(msg.parsedTransaction) : null,
      msg.hash ?? null,
    ]
  );
}

export async function getMessagesByAddress(address: string, limit = 50): Promise<{
  id: number;
  message_id: string;
  originating_address: string;
  body: string;
  date: string;
  provider_guess: string | null;
  parsed_transaction: string | null;
}[]> {
  const db = await dbInit;
  return db.getAllAsync(
    'SELECT * FROM local_sms_index WHERE originating_address = ? ORDER BY date DESC LIMIT ?',
    [address, limit]
  ) as any;
}

export async function getSmsIndexStats(): Promise<{ address: string; count: number; last_date: string }[]> {
  const db = await dbInit;
  return db.getAllAsync(
    'SELECT originating_address as address, COUNT(*) as count, MAX(date) as last_date FROM local_sms_index GROUP BY originating_address ORDER BY count DESC'
  ) as any;
}

// ---- مصادر الموردين ----

export async function upsertProviderSource(source: {
  providerId: string;
  sourceId: string;
  sourceType?: string;
  displayName?: string | null;
  verified?: boolean;
  enabled?: boolean;
  lastMessageAt?: string | null;
  notes?: string | null;
}): Promise<number> {
  const db = await dbInit;
  await db.runAsync(
    `INSERT INTO provider_sources
      (provider_id, source_id, source_type, display_name, verified, enabled, last_message_at, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(provider_id, source_id) DO UPDATE SET
       source_type = excluded.source_type,
       display_name = COALESCE(excluded.display_name, display_name),
       last_message_at = COALESCE(excluded.last_message_at, last_message_at),
       notes = COALESCE(excluded.notes, notes),
       updated_at = datetime('now')`,
    [
      source.providerId,
      source.sourceId,
      source.sourceType ?? 'phone',
      source.displayName ?? null,
      source.verified ? 1 : 0,
      source.enabled ? 1 : 0,
      source.lastMessageAt ?? null,
      source.notes ?? null,
    ]
  );
  const row = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM provider_sources WHERE provider_id = ? AND source_id = ?',
    [source.providerId, source.sourceId]
  );
  return row?.id ?? 0;
}

export async function setProviderSourceVerified(
  providerId: string,
  sourceId: string,
  verified: boolean,
  result: string,
  enabled?: boolean
): Promise<void> {
  const db = await dbInit;
  const enabledVal = enabled !== undefined ? (enabled ? 1 : 0) : (verified ? 1 : 0);
  await db.runAsync(
    `UPDATE provider_sources
     SET verified = ?, enabled = ?,
         last_verification_at = datetime('now'),
         last_verification_result = ?,
         verification_attempts = verification_attempts + 1,
         updated_at = datetime('now')
     WHERE provider_id = ? AND source_id = ?`,
    [verified ? 1 : 0, enabledVal, result, providerId, sourceId]
  );
}

export async function getProviderSources(providerId: string): Promise<{
  id: number;
  provider_id: string;
  source_id: string;
  source_type: string;
  display_name: string | null;
  verified: number;
  enabled: number;
  last_message_at: string | null;
  last_verification_at: string | null;
  last_verification_result: string | null;
  verification_attempts: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}[]> {
  const db = await dbInit;
  return db.getAllAsync(
    'SELECT * FROM provider_sources WHERE provider_id = ? ORDER BY updated_at DESC',
    [providerId]
  ) as any;
}

export async function isSourceVerified(providerId: string, sourceId: string): Promise<boolean> {
  const db = await dbInit;
  const row = await db.getFirstAsync<{ verified: number; enabled: number }>(
    'SELECT verified, enabled FROM provider_sources WHERE provider_id = ? AND source_id = ?',
    [providerId, sourceId]
  );
  return !!row && row.verified === 1 && row.enabled === 1;
}

export async function logSourceVerification(entry: {
  providerSourceId?: number | null;
  providerId: string;
  sourceId: string;
  action: string;
  result?: string | null;
  reason?: string | null;
  messageCountTested?: number | null;
  messageCountPassed?: number | null;
}): Promise<void> {
  const db = await dbInit;
  await db.runAsync(
    `INSERT INTO source_verification_logs
      (provider_source_id, provider_id, source_id, action, result, reason, message_count_tested, message_count_passed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.providerSourceId ?? null,
      entry.providerId,
      entry.sourceId,
      entry.action,
      entry.result ?? null,
      entry.reason ?? null,
      entry.messageCountTested ?? null,
      entry.messageCountPassed ?? null,
    ]
  );
}

export async function getSourceVerificationLogs(providerId: string, sourceId: string, limit = 30): Promise<{
  id: number;
  provider_source_id: number | null;
  provider_id: string;
  source_id: string;
  action: string;
  result: string | null;
  reason: string | null;
  message_count_tested: number | null;
  message_count_passed: number | null;
  created_at: string;
}[]> {
  const db = await dbInit;
  return db.getAllAsync(
    'SELECT * FROM source_verification_logs WHERE provider_id = ? AND source_id = ? ORDER BY created_at DESC LIMIT ?',
    [providerId, sourceId, limit]
  ) as any;
}

export async function deleteProviderSource(providerId: string, sourceId: string): Promise<void> {
  const db = await dbInit;
  await db.runAsync(
    'DELETE FROM provider_sources WHERE provider_id = ? AND source_id = ?',
    [providerId, sourceId]
  );
}
