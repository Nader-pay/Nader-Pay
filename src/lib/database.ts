import * as SQLite from 'expo-sqlite';

const dbReady = SQLite.openDatabaseAsync('naderpay_agent.db').then(async (db) => {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS agent_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders_cache (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      external_reference TEXT NOT NULL,
      order_reference TEXT,
      payment_type TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      expected_sender_phone TEXT,
      expected_sender_name TEXT,
      expected_recipient_wallet TEXT,
      status TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      local_status TEXT DEFAULT 'new',
      match_score REAL,
      evidence_id TEXT,
      sync_status TEXT DEFAULT 'synced',
      raw_sms TEXT,
      matched_transaction TEXT,
      verification_payload TEXT,
      cached_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS processed_transactions (
      transaction_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      order_id TEXT,
      status TEXT NOT NULL,
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS offline_queue (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS verification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      transaction_id TEXT,
      action TEXT NOT NULL,
      result TEXT,
      reason TEXT,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders_cache(status);
    CREATE INDEX IF NOT EXISTS idx_orders_local_status ON orders_cache(local_status);
    CREATE INDEX IF NOT EXISTS idx_offline_queue_status ON offline_queue(status);
    CREATE INDEX IF NOT EXISTS idx_events_created ON agent_events(created_at DESC);
  `);

  // Migration: add columns introduced after the original table was created
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('orders_cache')");
  const columnNames = new Set(columns.map((c) => c.name));
  if (!columnNames.has('sync_status')) {
    await db.execAsync("ALTER TABLE orders_cache ADD COLUMN sync_status TEXT DEFAULT 'synced'");
  }
  if (!columnNames.has('raw_sms')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN raw_sms TEXT');
  }
  if (!columnNames.has('matched_transaction')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN matched_transaction TEXT');
  }
  if (!columnNames.has('verification_payload')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN verification_payload TEXT');
  }
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_orders_sync ON orders_cache(sync_status)');

  return db;
});

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    'INSERT INTO agent_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await dbReady;
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM agent_settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

export async function clearSettings(): Promise<void> {
  const db = await dbReady;
  await db.runAsync('DELETE FROM agent_settings');
}

export async function cacheOrders(orders: {
  id: string;
  account_id: string;
  external_reference: string;
  order_reference: string | null;
  payment_type: string | null;
  amount: number;
  currency: string;
  expected_sender_phone: string | null;
  expected_sender_name: string | null;
  expected_recipient_wallet: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  local_status?: string | null;
  match_score?: number | null;
  evidence_id?: string | null;
}[]): Promise<void> {
  const db = await dbReady;
  await db.withTransactionAsync(async () => {
    for (const o of orders) {
      await db.runAsync(
        `INSERT INTO orders_cache (
          id, account_id, external_reference, order_reference, payment_type,
          amount, currency, expected_sender_phone, expected_sender_name,
          expected_recipient_wallet, status, expires_at, created_at, updated_at,
          local_status, match_score, evidence_id, cached_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          local_status = excluded.local_status,
          match_score = excluded.match_score,
          evidence_id = excluded.evidence_id,
          updated_at = excluded.updated_at,
          cached_at = datetime('now')`,
        [
          o.id,
          o.account_id,
          o.external_reference,
          o.order_reference ?? null,
          o.payment_type ?? null,
          o.amount,
          o.currency,
          o.expected_sender_phone ?? null,
          o.expected_sender_name ?? null,
          o.expected_recipient_wallet ?? null,
          o.status,
          o.expires_at ?? null,
          o.created_at,
          o.updated_at,
          o.local_status ?? null,
          o.match_score ?? null,
          o.evidence_id ?? null,
        ]
      );
    }
  });
}

export async function getCachedOrders(): Promise<{
  id: string;
  account_id: string;
  external_reference: string;
  order_reference: string | null;
  payment_type: string | null;
  amount: number;
  currency: string;
  expected_sender_phone: string | null;
  expected_sender_name: string | null;
  expected_recipient_wallet: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  local_status: string | null;
  match_score: number | null;
  evidence_id: string | null;
}[]> {
  const db = await dbReady;
  return db.getAllAsync(
    'SELECT * FROM orders_cache ORDER BY created_at DESC'
  ) as any;
}

export async function upsertProcessedTransaction(
  transactionId: string,
  provider: string,
  orderId: string | null,
  status: string
): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    `INSERT INTO processed_transactions (transaction_id, provider, order_id, status)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(transaction_id) DO UPDATE SET
       order_id = excluded.order_id,
       status = excluded.status,
       processed_at = datetime('now')`,
    [transactionId, provider, orderId ?? null, status]
  );
}

export async function isTransactionProcessed(transactionId: string): Promise<boolean> {
  const db = await dbReady;
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM processed_transactions WHERE transaction_id = ?',
    [transactionId]
  );
  return (row?.count ?? 0) > 0;
}

export async function logEvent(type: string, message: string, payload?: unknown): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    'INSERT INTO agent_events (type, message, payload) VALUES (?, ?, ?)',
    [type, message, payload ? JSON.stringify(payload) : null]
  );
}

export async function getRecentEvents(limit = 100): Promise<{
  id: number;
  type: string;
  message: string;
  payload: string | null;
  created_at: string;
}[]> {
  const db = await dbReady;
  return db.getAllAsync(
    'SELECT * FROM agent_events ORDER BY created_at DESC LIMIT ?',
    [limit]
  ) as any;
}
export async function updateOrderLocal(
  orderId: string,
  updates: {
    localStatus?: string;
    matchScore?: number | null;
    evidenceId?: string | null;
    syncStatus?: string;
    rawSms?: string | null;
    matchedTransaction?: string | null;
    verificationPayload?: string | null;
  }
): Promise<void> {
  const db = await dbReady;
  const fields: string[] = [];
  const values: SQLite.SQLiteBindValue[] = [];
  if (updates.localStatus !== undefined) { fields.push('local_status = ?'); values.push(updates.localStatus); }
  if (updates.matchScore !== undefined) { fields.push('match_score = ?'); values.push(updates.matchScore); }
  if (updates.evidenceId !== undefined) { fields.push('evidence_id = ?'); values.push(updates.evidenceId); }
  if (updates.syncStatus !== undefined) { fields.push('sync_status = ?'); values.push(updates.syncStatus); }
  if (updates.rawSms !== undefined) { fields.push('raw_sms = ?'); values.push(updates.rawSms); }
  if (updates.matchedTransaction !== undefined) { fields.push('matched_transaction = ?'); values.push(updates.matchedTransaction); }
  if (updates.verificationPayload !== undefined) { fields.push('verification_payload = ?'); values.push(updates.verificationPayload); }
  if (fields.length === 0) return;
  values.push(orderId);
  await db.runAsync(`UPDATE orders_cache SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function getOrderById(orderId: string): Promise<{
  id: string;
  account_id: string;
  external_reference: string;
  order_reference: string | null;
  payment_type: string | null;
  amount: number;
  currency: string;
  expected_sender_phone: string | null;
  expected_sender_name: string | null;
  expected_recipient_wallet: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  local_status: string | null;
  match_score: number | null;
  evidence_id: string | null;
  sync_status: string | null;
  raw_sms: string | null;
  matched_transaction: string | null;
  verification_payload: string | null;
} | null> {
  const db = await dbReady;
  return (await db.getFirstAsync('SELECT * FROM orders_cache WHERE id = ?', [orderId])) as any;
}

export async function enqueueOffline(
  orderId: string,
  action: 'confirm' | 'reject',
  payload: Record<string, unknown>
): Promise<void> {
  const db = await dbReady;
  const id = `${orderId}-${action}-${Date.now()}`;
  await db.runAsync(
    'INSERT INTO offline_queue (id, order_id, action, payload) VALUES (?, ?, ?, ?)',
    [id, orderId, action, JSON.stringify(payload)]
  );
}

export async function getPendingOfflineQueue(): Promise<{
  id: string;
  order_id: string;
  action: string;
  payload: string;
  attempts: number;
  status: string;
  created_at: string;
}[]> {
  const db = await dbReady;
  return db.getAllAsync(
    "SELECT * FROM offline_queue WHERE status = 'pending' ORDER BY created_at ASC"
  ) as any;
}

export async function getOfflineQueueCount(): Promise<number> {
  const db = await dbReady;
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM offline_queue WHERE status = 'pending'"
  );
  return row?.count ?? 0;
}

export async function updateOfflineQueueStatus(
  id: string,
  status: 'pending' | 'syncing' | 'failed',
  attempts: number
): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    'UPDATE offline_queue SET status = ?, attempts = ? WHERE id = ?',
    [status, attempts, id]
  );
}

export async function deleteOfflineQueueItem(id: string): Promise<void> {
  const db = await dbReady;
  await db.runAsync('DELETE FROM offline_queue WHERE id = ?', [id]);
}

export async function logVerification(
  orderId: string,
  action: string,
  result: string | null,
  reason: string | null,
  payload?: Record<string, unknown>,
  transactionId?: string | null
): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    'INSERT INTO verification_logs (order_id, transaction_id, action, result, reason, payload) VALUES (?, ?, ?, ?, ?, ?)',
    [orderId, transactionId ?? null, action, result, reason, payload ? JSON.stringify(payload) : null]
  );
}

export async function getVerificationLogs(orderId: string): Promise<{
  id: number;
  order_id: string;
  transaction_id: string | null;
  action: string;
  result: string | null;
  reason: string | null;
  payload: string | null;
  created_at: string;
}[]> {
  const db = await dbReady;
  return db.getAllAsync(
    'SELECT * FROM verification_logs WHERE order_id = ? ORDER BY created_at ASC',
    [orderId]
  ) as any;
}
