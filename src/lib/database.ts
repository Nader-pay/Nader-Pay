import * as SQLite from 'expo-sqlite';

const IS_WEB = process.env.EXPO_OS === 'web';

async function runSchemaStatements(db: SQLite.SQLiteDatabase, source: string): Promise<void> {
  const statements = source
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    // On web, execAsync for a single DDL statement is more reliable than the
    // multi-statement helper or runAsync for schema setup.
    if (IS_WEB) {
      await db.execAsync(`${statement};`);
    } else {
      await db.runAsync(statement);
    }
  }
}

const DB_NAME = IS_WEB ? ':memory:' : 'naderpay_agent.db';
const DB_OPTIONS = IS_WEB ? { useNewConnection: true } : undefined;

const dbReady = SQLite.openDatabaseAsync(DB_NAME, DB_OPTIONS)
  .catch((err) => {
    // If opening still fails on web (e.g. the runtime does not support the
    // chosen storage), fall back to the built-in in-memory database so the app
    // can still render during preview.
    if (IS_WEB) {
      console.warn('[expo-sqlite] naderpay_agent.db open failed, using :memory: fallback', err);
      return SQLite.openDatabaseAsync(':memory:', { useNewConnection: true });
    }
    throw err;
  })
  .then(async (db) => {
    const schema = `
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

    CREATE TABLE IF NOT EXISTS order_timelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders_cache(status);
    CREATE INDEX IF NOT EXISTS idx_orders_local_status ON orders_cache(local_status);
    CREATE INDEX IF NOT EXISTS idx_offline_queue_status ON offline_queue(status);
    CREATE INDEX IF NOT EXISTS idx_events_created ON agent_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_timelines_order ON order_timelines(order_id, created_at);

    CREATE TABLE IF NOT EXISTS server_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      api_key TEXT,
      token TEXT,
      username TEXT,
      password TEXT,
      custom_headers TEXT,
      api_contract TEXT,
      discovery_url TEXT,
      is_active INTEGER DEFAULT 0,
      is_connected INTEGER DEFAULT 0,
      last_connected_at TEXT,
      last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_server_profiles_active ON server_profiles(is_active);
  `;
    await db.execAsync(schema);

    // Verify core tables were created (Web SQLite sometimes silently skips DDL).
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_settings','orders_cache','server_profiles')"
    );
    const tableNames = new Set(tables.map((t) => t.name));
    if (!tableNames.has('agent_settings') || !tableNames.has('orders_cache') || !tableNames.has('server_profiles')) {
      const missing = ['agent_settings', 'orders_cache', 'server_profiles'].filter((n) => !tableNames.has(n));
      throw new Error(`Schema setup failed: missing tables: ${missing.join(', ')}`);
    }

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
  if (!columnNames.has('provider')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN provider TEXT');
  }
  if (!columnNames.has('reviewed_by')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN reviewed_by TEXT');
  }
  if (!columnNames.has('reviewed_at')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN reviewed_at TEXT');
  }
  if (!columnNames.has('review_reason')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN review_reason TEXT');
  }
  if (!columnNames.has('raw_order')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN raw_order TEXT');
  }
  if (!columnNames.has('order_id')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN order_id TEXT');
  }
  if (!columnNames.has('sender_phone')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN sender_phone TEXT');
  }
  if (!columnNames.has('receiver_phone')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN receiver_phone TEXT');
  }
  if (!columnNames.has('transaction_id')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN transaction_id TEXT');
  }
  if (!columnNames.has('transaction_reference')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN transaction_reference TEXT');
  }
  if (!columnNames.has('message_received_at')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN message_received_at TEXT');
  }
  if (!columnNames.has('service')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN service TEXT');
  }
  if (!columnNames.has('type')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN type TEXT');
  }
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_orders_sync ON orders_cache(sync_status)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_orders_provider ON orders_cache(provider)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders_cache(order_id)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_orders_transaction_id ON orders_cache(transaction_id)');

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

export async function saveServerProfile(profile: {
  id: string;
  name: string;
  baseUrl: string;
  authType: string;
  apiKey?: string | null;
  token?: string | null;
  username?: string | null;
  password?: string | null;
  customHeaders?: string | null;
  apiContract?: unknown | null;
  discoveryUrl?: string | null;
  isActive?: boolean;
  isConnected?: boolean;
  lastConnectedAt?: string | null;
  lastSyncAt?: string | null;
}): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    `INSERT INTO server_profiles (
      id, name, base_url, auth_type, api_key, token, username, password,
      custom_headers, api_contract, discovery_url, is_active, is_connected,
      last_connected_at, last_sync_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      base_url = excluded.base_url,
      auth_type = excluded.auth_type,
      api_key = excluded.api_key,
      token = excluded.token,
      username = excluded.username,
      password = excluded.password,
      custom_headers = excluded.custom_headers,
      api_contract = excluded.api_contract,
      discovery_url = excluded.discovery_url,
      is_active = excluded.is_active,
      is_connected = excluded.is_connected,
      last_connected_at = excluded.last_connected_at,
      last_sync_at = excluded.last_sync_at,
      updated_at = datetime('now')`,
    [
      profile.id,
      profile.name,
      profile.baseUrl,
      profile.authType,
      profile.apiKey ?? null,
      profile.token ?? null,
      profile.username ?? null,
      profile.password ?? null,
      profile.customHeaders ? JSON.stringify(profile.customHeaders) : null,
      profile.apiContract ? JSON.stringify(profile.apiContract) : null,
      profile.discoveryUrl ?? null,
      profile.isActive ? 1 : 0,
      profile.isConnected ? 1 : 0,
      profile.lastConnectedAt ?? null,
      profile.lastSyncAt ?? null,
    ]
  );
}

export async function getServerProfiles(): Promise<{
  id: string;
  name: string;
  base_url: string;
  auth_type: string;
  api_key: string | null;
  token: string | null;
  username: string | null;
  password: string | null;
  custom_headers: string | null;
  api_contract: string | null;
  discovery_url: string | null;
  is_active: number;
  is_connected: number;
  last_connected_at: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}[]> {
  const db = await dbReady;
  return db.getAllAsync(
    'SELECT * FROM server_profiles ORDER BY is_active DESC, updated_at DESC'
  ) as any;
}

export async function getServerProfileById(
  id: string
): Promise<{
  id: string;
  name: string;
  base_url: string;
  auth_type: string;
  api_key: string | null;
  token: string | null;
  username: string | null;
  password: string | null;
  custom_headers: string | null;
  api_contract: string | null;
  discovery_url: string | null;
  is_active: number;
  is_connected: number;
  last_connected_at: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
} | null> {
  const db = await dbReady;
  const row = await db.getFirstAsync<{
    id: string;
    name: string;
    base_url: string;
    auth_type: string;
    api_key: string | null;
    token: string | null;
    username: string | null;
    password: string | null;
    custom_headers: string | null;
    api_contract: string | null;
    discovery_url: string | null;
    is_active: number;
    is_connected: number;
    last_connected_at: string | null;
    last_sync_at: string | null;
    created_at: string;
    updated_at: string;
  }>('SELECT * FROM server_profiles WHERE id = ?', [id]);
  return row ?? null;
}

export async function getActiveServerProfile(): Promise<{
  id: string;
  name: string;
  base_url: string;
  auth_type: string;
  api_key: string | null;
  token: string | null;
  username: string | null;
  password: string | null;
  custom_headers: string | null;
  api_contract: string | null;
  discovery_url: string | null;
  is_active: number;
  is_connected: number;
  last_connected_at: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
} | null> {
  const db = await dbReady;
  const row = await db.getFirstAsync<{
    id: string;
    name: string;
    base_url: string;
    auth_type: string;
    api_key: string | null;
    token: string | null;
    username: string | null;
    password: string | null;
    custom_headers: string | null;
    api_contract: string | null;
    discovery_url: string | null;
    is_active: number;
    is_connected: number;
    last_connected_at: string | null;
    last_sync_at: string | null;
    created_at: string;
    updated_at: string;
  }>('SELECT * FROM server_profiles WHERE is_active = 1 LIMIT 1');
  return row ?? null;
}

export async function setActiveServerProfile(id: string): Promise<void> {
  const db = await dbReady;
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE server_profiles SET is_active = 0');
    await db.runAsync('UPDATE server_profiles SET is_active = 1 WHERE id = ?', [id]);
  });
}

export async function deleteServerProfile(id: string): Promise<void> {
  const db = await dbReady;
  await db.runAsync('DELETE FROM server_profiles WHERE id = ?', [id]);
}

export async function updateServerProfileConnectionState(
  id: string,
  updates: {
    isConnected?: boolean;
    lastConnectedAt?: string;
    lastSyncAt?: string;
  }
): Promise<void> {
  const db = await dbReady;
  const fields: string[] = [];
  const values: SQLite.SQLiteBindValue[] = [];
  if (updates.isConnected !== undefined) {
    fields.push('is_connected = ?');
    values.push(updates.isConnected ? 1 : 0);
  }
  if (updates.lastConnectedAt !== undefined) {
    fields.push('last_connected_at = ?');
    values.push(updates.lastConnectedAt);
  }
  if (updates.lastSyncAt !== undefined) {
    fields.push('last_sync_at = ?');
    values.push(updates.lastSyncAt);
  }
  if (fields.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE server_profiles SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function cacheOrders(orders: {
  id: string;
  order_id?: string | null;
  account_id: string;
  external_reference: string;
  order_reference: string | null;
  payment_type: string | null;
  provider?: string | null;
  amount: number;
  currency: string;
  expected_sender_phone: string | null;
  expected_sender_name: string | null;
  expected_recipient_wallet: string | null;
  sender_phone?: string | null;
  receiver_phone?: string | null;
  sender_name?: string | null;
  transaction_id?: string | null;
  transaction_reference?: string | null;
  message_received_at?: string | null;
  service?: string | null;
  type?: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  local_status?: string | null;
  match_score?: number | null;
  evidence_id?: string | null;
  sync_status?: string | null;
  raw_sms?: string | null;
  raw_order?: string | null;
  matched_transaction?: string | null;
  verification_payload?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_reason?: string | null;
}[]): Promise<void> {
  const db = await dbReady;
  await db.withTransactionAsync(async () => {
    for (const o of orders) {
      await db.runAsync(
        `INSERT INTO orders_cache (
          id, order_id, account_id, external_reference, order_reference, payment_type, provider,
          amount, currency, expected_sender_phone, expected_sender_name,
          expected_recipient_wallet, sender_phone, receiver_phone, sender_name,
          transaction_id, transaction_reference, message_received_at, service, type,
          status, expires_at, created_at, updated_at,
          local_status, match_score, evidence_id, sync_status, raw_sms, raw_order,
          matched_transaction, verification_payload, reviewed_by, reviewed_at, review_reason, cached_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          order_id = excluded.order_id,
          status = excluded.status,
          local_status = excluded.local_status,
          match_score = excluded.match_score,
          evidence_id = excluded.evidence_id,
          sync_status = excluded.sync_status,
          raw_sms = excluded.raw_sms,
          raw_order = excluded.raw_order,
          matched_transaction = excluded.matched_transaction,
          verification_payload = excluded.verification_payload,
          reviewed_by = excluded.reviewed_by,
          reviewed_at = excluded.reviewed_at,
          review_reason = excluded.review_reason,
          updated_at = excluded.updated_at,
          cached_at = datetime('now')`,
        [
          o.id,
          o.order_id ?? null,
          o.account_id,
          o.external_reference,
          o.order_reference ?? null,
          o.payment_type ?? null,
          o.provider ?? null,
          o.amount,
          o.currency,
          o.expected_sender_phone ?? null,
          o.expected_sender_name ?? null,
          o.expected_recipient_wallet ?? null,
          o.sender_phone ?? null,
          o.receiver_phone ?? null,
          o.sender_name ?? null,
          o.transaction_id ?? null,
          o.transaction_reference ?? null,
          o.message_received_at ?? null,
          o.service ?? null,
          o.type ?? null,
          o.status,
          o.expires_at ?? null,
          o.created_at,
          o.updated_at,
          o.local_status ?? null,
          o.match_score ?? null,
          o.evidence_id ?? null,
          o.sync_status ?? null,
          o.raw_sms ?? null,
          o.raw_order ?? null,
          o.matched_transaction ?? null,
          o.verification_payload ?? null,
          o.reviewed_by ?? null,
          o.reviewed_at ?? null,
          o.review_reason ?? null,
        ]
      );
    }
  });
}

export async function getCachedOrders(): Promise<{
  id: string;
  order_id: string | null;
  account_id: string;
  external_reference: string;
  order_reference: string | null;
  payment_type: string | null;
  provider: string | null;
  amount: number;
  currency: string;
  expected_sender_phone: string | null;
  expected_sender_name: string | null;
  expected_recipient_wallet: string | null;
  sender_phone: string | null;
  receiver_phone: string | null;
  sender_name: string | null;
  transaction_id: string | null;
  transaction_reference: string | null;
  message_received_at: string | null;
  service: string | null;
  type: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  local_status: string | null;
  match_score: number | null;
  evidence_id: string | null;
  sync_status: string | null;
  raw_sms: string | null;
  raw_order: string | null;
  matched_transaction: string | null;
  verification_payload: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
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
    rawOrder?: string | null;
    senderPhone?: string | null;
    receiverPhone?: string | null;
    transactionId?: string | null;
    transactionReference?: string | null;
    messageReceivedAt?: string | null;
    matchedTransaction?: string | null;
    verificationPayload?: string | null;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewReason?: string | null;
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
  if (updates.rawOrder !== undefined) { fields.push('raw_order = ?'); values.push(updates.rawOrder); }
  if (updates.senderPhone !== undefined) { fields.push('sender_phone = ?'); values.push(updates.senderPhone); }
  if (updates.receiverPhone !== undefined) { fields.push('receiver_phone = ?'); values.push(updates.receiverPhone); }
  if (updates.transactionId !== undefined) { fields.push('transaction_id = ?'); values.push(updates.transactionId); }
  if (updates.transactionReference !== undefined) { fields.push('transaction_reference = ?'); values.push(updates.transactionReference); }
  if (updates.messageReceivedAt !== undefined) { fields.push('message_received_at = ?'); values.push(updates.messageReceivedAt); }
  if (updates.matchedTransaction !== undefined) { fields.push('matched_transaction = ?'); values.push(updates.matchedTransaction); }
  if (updates.verificationPayload !== undefined) { fields.push('verification_payload = ?'); values.push(updates.verificationPayload); }
  if (updates.reviewedBy !== undefined) { fields.push('reviewed_by = ?'); values.push(updates.reviewedBy); }
  if (updates.reviewedAt !== undefined) { fields.push('reviewed_at = ?'); values.push(updates.reviewedAt); }
  if (updates.reviewReason !== undefined) { fields.push('review_reason = ?'); values.push(updates.reviewReason); }
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
  provider: string | null;
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
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
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

export async function addTimelineStage(
  orderId: string,
  stage: string,
  status: 'completed' | 'current' | 'pending' | 'error',
  reason?: string | null
): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    'INSERT INTO order_timelines (order_id, stage, status, reason) VALUES (?, ?, ?, ?)',
    [orderId, stage, status, reason ?? null]
  );
}

export async function getOrderTimeline(orderId: string): Promise<{
  id: number;
  order_id: string;
  stage: string;
  status: string;
  reason: string | null;
  created_at: string;
}[]> {
  const db = await dbReady;
  return db.getAllAsync(
    'SELECT * FROM order_timelines WHERE order_id = ? ORDER BY created_at ASC',
    [orderId]
  ) as any;
}

export async function getLastIndexedOrderAt(): Promise<string | null> {
  const db = await dbReady;
  const row = await db.getFirstAsync<{ cached_at: string }>(
    'SELECT cached_at FROM orders_cache ORDER BY cached_at DESC LIMIT 1'
  );
  return row?.cached_at ?? null;
}
