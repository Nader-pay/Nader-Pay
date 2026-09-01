import * as SQLite from 'expo-sqlite';

const IS_WEB = process.env.EXPO_OS === 'web';

const DB_NAME = IS_WEB ? ':memory:' : 'naderpay_agent.db';
const DB_OPTIONS = IS_WEB ? undefined : undefined;

async function runSchemaStatements(db: SQLite.SQLiteDatabase, source: string): Promise<void> {
  const statements = source
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    try {
      await db.runAsync(`${statement};`);
    } catch (err) {
      // INDEX statements على أعمدة غير موجودة (جداول قديمة) لا يجب أن تُوقف التشغيل.
      // الـ migrations أدناه تُضيف الأعمدة المفقودة ثم تُنشئ الـ indexes.
      const isIndexStmt = /^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(statement);
      if (isIndexStmt) {
        console.warn('[database] index creation skipped (column may not exist yet):', statement.slice(0, 80));
        continue;
      }
      console.error('[database] schema statement failed:', statement.slice(0, 120), err);
      throw err;
    }
  }
}

export const dbReady = SQLite.openDatabaseAsync(DB_NAME, DB_OPTIONS)
  .catch((err) => {
    // If opening still fails on web (e.g. the runtime does not support the
    // chosen storage), fall back to the built-in in-memory database so the app
    // can still render during preview.
    if (IS_WEB) {
      console.warn('[expo-sqlite] naderpay_agent.db open failed, using :memory: fallback', err);
      return SQLite.openDatabaseAsync(':memory:');
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
      cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS processed_transactions (
      transaction_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      order_id TEXT,
      status TEXT NOT NULL,
      processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS offline_queue (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      idempotency_key TEXT,
      retry_class TEXT DEFAULT 'RETRYABLE',
      error_code TEXT,
      next_retry_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS verification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      transaction_id TEXT,
      action TEXT NOT NULL,
      result TEXT,
      reason TEXT,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_timelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_server_profiles_active ON server_profiles(is_active);

    CREATE TABLE IF NOT EXISTS provider_sources (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'sms',
      source_metadata TEXT,
      parser_version TEXT,
      receiving_account TEXT,
      approved_sender_identifiers TEXT,
      message_patterns TEXT,
      verified INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unverified',
      last_message_at TEXT,
      last_message_summary TEXT,
      last_verification_at TEXT,
      last_verification_result TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_provider_sources_provider ON provider_sources(provider_id);
    CREATE INDEX IF NOT EXISTS idx_provider_sources_verified ON provider_sources(verified);

    CREATE TABLE IF NOT EXISTS in_app_notifications (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      payload TEXT,
      read INTEGER DEFAULT 0,
      related_order_id TEXT,
      related_provider_id TEXT,
      deep_link TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_read ON in_app_notifications(read);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON in_app_notifications(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_event ON in_app_notifications(event_id);

    CREATE TABLE IF NOT EXISTS local_sms_index (
      id TEXT PRIMARY KEY,
      message_hash TEXT NOT NULL UNIQUE,
      body TEXT NOT NULL,
      originating_address TEXT NOT NULL,
      received_at TEXT NOT NULL,
      provider TEXT,
      transaction_id TEXT,
      amount REAL,
      sender_phone TEXT,
      sender_name TEXT,
      recipient_wallet TEXT,
      recipient_account TEXT,
      parsed_payload TEXT,
      matched_order_id TEXT,
      match_status TEXT DEFAULT 'unmatched',
      stored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS event_deduplication (
      dedup_key TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      occurrence_count INTEGER DEFAULT 1,
      resolved INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_dedup_event_type ON event_deduplication(event_type);
    CREATE INDEX IF NOT EXISTS idx_dedup_resolved ON event_deduplication(resolved);

    CREATE INDEX IF NOT EXISTS idx_sms_provider ON local_sms_index(provider);
    CREATE INDEX IF NOT EXISTS idx_sms_transaction ON local_sms_index(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_sms_amount ON local_sms_index(amount);
    CREATE INDEX IF NOT EXISTS idx_sms_sender ON local_sms_index(sender_phone);
    CREATE INDEX IF NOT EXISTS idx_sms_received ON local_sms_index(received_at)
  `;
  // ملاحظة: idx_sms_match_status مُزال من الـ schema الأصلي عمداً.
  // على الأجهزة القديمة التي تحتوي local_sms_index بدون عمود match_status،
  // CREATE INDEX على عمود غير موجود يُرمى exception ويُوقف dbReady كله قبل الـ migrations.
  // الـ index يُضاف في قسم migrations أدناه بعد ALTER TABLE.
    await runSchemaStatements(db, schema);

    // Verify core tables were created (Web SQLite sometimes silently skips DDL).
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_settings','orders_cache','server_profiles','local_sms_index')"
    );
    const tableNames = new Set(tables.map((t) => t.name));
    if (!tableNames.has('agent_settings') || !tableNames.has('orders_cache') || !tableNames.has('server_profiles') || !tableNames.has('local_sms_index')) {
      const missing = ['agent_settings', 'orders_cache', 'server_profiles', 'local_sms_index'].filter((n) => !tableNames.has(n));
      throw new Error(`Schema setup failed: missing tables: ${missing.join(', ')}`);
    }

  // Migration: add updated_at column to orders_cache if missing on devices with old schema
  const orderCacheColumns = await db.getAllAsync<{ name: string; notnull: number; dflt_value: string | null }>(
    "PRAGMA table_info('orders_cache')"
  );
  const orderCacheColMap = new Map(orderCacheColumns.map((c) => [c.name, c]));
  if (!orderCacheColMap.has('updated_at')) {
    // جدول قديم جداً بدون updated_at — نضيفه مع قيمة افتراضية
    await db.execAsync("ALTER TABLE orders_cache ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  }
  // orders_cache: باقي columns (المُضافة في نسخ لاحقة)
  const columnNames = new Set(orderCacheColMap.keys());
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
  if (tableNames.has('orders_cache')) {
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_orders_sync ON orders_cache(sync_status)');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_orders_provider ON orders_cache(provider)');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders_cache(order_id)');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_orders_transaction_id ON orders_cache(transaction_id)');
  }

  // Migration: add columns to local_sms_index (added in later schema versions)
  const smsColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('local_sms_index')");
  const smsColNames = new Set(smsColumns.map((c) => c.name));
  if (!smsColNames.has('provider')) {
    await db.execAsync('ALTER TABLE local_sms_index ADD COLUMN provider TEXT');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_sms_provider ON local_sms_index(provider)');
  }
  if (!smsColNames.has('transaction_id')) {
    await db.execAsync('ALTER TABLE local_sms_index ADD COLUMN transaction_id TEXT');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_sms_transaction ON local_sms_index(transaction_id)');
  }
  if (!smsColNames.has('amount')) {
    await db.execAsync('ALTER TABLE local_sms_index ADD COLUMN amount REAL');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_sms_amount ON local_sms_index(amount)');
  }
  if (!smsColNames.has('sender_phone')) {
    await db.execAsync('ALTER TABLE local_sms_index ADD COLUMN sender_phone TEXT');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_sms_sender ON local_sms_index(sender_phone)');
  }
  if (!smsColNames.has('sender_name')) {
    await db.execAsync('ALTER TABLE local_sms_index ADD COLUMN sender_name TEXT');
  }
  if (!smsColNames.has('recipient_wallet')) {
    await db.execAsync('ALTER TABLE local_sms_index ADD COLUMN recipient_wallet TEXT');
  }
  if (!smsColNames.has('recipient_account')) {
    await db.execAsync('ALTER TABLE local_sms_index ADD COLUMN recipient_account TEXT');
  }
  if (!smsColNames.has('parsed_payload')) {
    await db.execAsync('ALTER TABLE local_sms_index ADD COLUMN parsed_payload TEXT');
  }
  if (!smsColNames.has('matched_order_id')) {
    await db.execAsync('ALTER TABLE local_sms_index ADD COLUMN matched_order_id TEXT');
  }
  if (!smsColNames.has('match_status')) {
    await db.execAsync("ALTER TABLE local_sms_index ADD COLUMN match_status TEXT DEFAULT 'unmatched'");
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_sms_match_status ON local_sms_index(match_status)");
  }

  // Migration: add retry/idempotency columns to offline_queue
  const oqColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('offline_queue')");
  const oqColNames = new Set(oqColumns.map((c) => c.name));
  if (!oqColNames.has('idempotency_key')) {
    await db.execAsync('ALTER TABLE offline_queue ADD COLUMN idempotency_key TEXT');
  }
  if (!oqColNames.has('retry_class')) {
    await db.execAsync("ALTER TABLE offline_queue ADD COLUMN retry_class TEXT DEFAULT 'RETRYABLE'");
  }
  if (!oqColNames.has('error_code')) {
    await db.execAsync('ALTER TABLE offline_queue ADD COLUMN error_code TEXT');
  }
  if (!oqColNames.has('next_retry_at')) {
    await db.execAsync('ALTER TABLE offline_queue ADD COLUMN next_retry_at TEXT');
  }
  await db.execAsync("CREATE INDEX IF NOT EXISTS idx_offline_queue_next_retry ON offline_queue(next_retry_at)");
  await db.execAsync("CREATE INDEX IF NOT EXISTS idx_offline_queue_retry_class ON offline_queue(retry_class)");

  // Migration: add timestamp integrity columns to orders_cache
  const ocCols2 = await db.getAllAsync<{ name: string }>("PRAGMA table_info('orders_cache')");
  const ocColNames2 = new Set(ocCols2.map((c) => c.name));
  const tsColumns = [
    'sms_received_at',
    'notification_received_at',
    'first_seen_local_at',
    'processed_at',
    'verified_at',
    'sync_started_at',
    'synced_at',
  ];
  for (const col of tsColumns) {
    if (!ocColNames2.has(col)) {
      await db.execAsync(`ALTER TABLE orders_cache ADD COLUMN ${col} TEXT`);
    }
  }

  // Migration: create event_deduplication table if not present (schema above already creates it;
  // this guard is for devices with older schema where CREATE IF NOT EXISTS may have been skipped)
  const hasDedup = tableNames.has('event_deduplication') ||
    (await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='event_deduplication'")).length > 0;
  if (!hasDedup) {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS event_deduplication (
      dedup_key TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      occurrence_count INTEGER DEFAULT 1,
      resolved INTEGER DEFAULT 0
    )`);
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_dedup_event_type ON event_deduplication(event_type)");
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_dedup_resolved ON event_deduplication(resolved)");
  }

  // Migration: add missing columns to provider_sources
  const psColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('provider_sources')");
  const psColNames = new Set(psColumns.map((c) => c.name));
  if (!psColNames.has('last_message_at')) {
    await db.execAsync('ALTER TABLE provider_sources ADD COLUMN last_message_at TEXT');
  }
  if (!psColNames.has('last_message_summary')) {
    await db.execAsync('ALTER TABLE provider_sources ADD COLUMN last_message_summary TEXT');
  }
  if (!psColNames.has('last_verification_at')) {
    await db.execAsync('ALTER TABLE provider_sources ADD COLUMN last_verification_at TEXT');
  }
  if (!psColNames.has('last_verification_result')) {
    await db.execAsync('ALTER TABLE provider_sources ADD COLUMN last_verification_result TEXT');
  }

  // ── Phase 3 Migrations ──────────────────────────────────────────────────

  // dead_letter_queue: أحداث فشلت بعد استنفاد المحاولات
  const hasDeadLetter = (await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='dead_letter_queue'"
  )).length > 0;
  if (!hasDeadLetter) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS dead_letter_queue (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        order_id TEXT,
        module TEXT NOT NULL,
        action TEXT NOT NULL,
        error_code TEXT,
        safe_error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        first_attempt_at TEXT,
        last_attempt_at TEXT,
        last_action TEXT,
        next_action TEXT,
        payload TEXT,
        resolved INTEGER DEFAULT 0,
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_dlq_order ON dead_letter_queue(order_id)");
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_dlq_module ON dead_letter_queue(module)");
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_dlq_resolved ON dead_letter_queue(resolved)");
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_dlq_created ON dead_letter_queue(created_at DESC)");
  }

  // sync_cursor: persistent checkpoint لاستئناف المزامنة بعد crash/restart
  const hasSyncCursor = (await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sync_cursor'"
  )).length > 0;
  if (!hasSyncCursor) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS sync_cursor (
        cursor_key TEXT PRIMARY KEY,
        last_event_id TEXT,
        last_synced_at TEXT,
        last_server_sequence TEXT,
        checkpoint_status TEXT NOT NULL DEFAULT 'valid',
        metadata TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  // supervisor_module_state: حالة كل module للـ persistence بين restarts
  const hasSupervisorState = (await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='supervisor_module_state'"
  )).length > 0;
  if (!hasSupervisorState) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS supervisor_module_state (
        module_name TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'STOPPED',
        failure_count INTEGER DEFAULT 0,
        consecutive_failures INTEGER DEFAULT 0,
        last_failure_at TEXT,
        last_recovery_at TEXT,
        last_success_at TEXT,
        last_error_code TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  // offline_queue: إضافة dead_letter_at لتمييز العناصر المنقولة للـ dead letter
  const oqCols3 = await db.getAllAsync<{ name: string }>("PRAGMA table_info('offline_queue')");
  const oqColNames3 = new Set(oqCols3.map((c) => c.name));
  if (!oqColNames3.has('dead_letter_at')) {
    await db.execAsync('ALTER TABLE offline_queue ADD COLUMN dead_letter_at TEXT');
  }
  if (!oqColNames3.has('safe_error_message')) {
    await db.execAsync('ALTER TABLE offline_queue ADD COLUMN safe_error_message TEXT');
  }

  // orders_cache: إضافة transaction_stage للـ state machine الكامل
  const ocCols3 = await db.getAllAsync<{ name: string }>("PRAGMA table_info('orders_cache')");
  const ocColNames3 = new Set(ocCols3.map((c) => c.name));
  if (!ocColNames3.has('transaction_stage')) {
    await db.execAsync("ALTER TABLE orders_cache ADD COLUMN transaction_stage TEXT DEFAULT 'RECEIVED'");
    await db.execAsync("CREATE INDEX IF NOT EXISTS idx_orders_tx_stage ON orders_cache(transaction_stage)");
  }
  if (!ocColNames3.has('in_flight_at')) {
    await db.execAsync('ALTER TABLE orders_cache ADD COLUMN in_flight_at TEXT');
  }

  // Seed & Update: التأكد من وجود الخادم الافتراضي ببيانات الاتصال الصحيحة دائماً
  // ─── FIX RC#1: Server Configuration Self-Healing ───────────────────────────
  // سبب الـ Regression: الـ UPDATE السابق كان يُطابق كل خادم يحتوي 'backend-proxy'
  // في base_url مما يُغيّر بيانات الخوادم الحقيقية التي أضافها المستخدم.
  // الإصلاح: نُحدّث فقط الخادم المعروف بـ id محدد أو URL القديم (ccimllgqdxuvymdeikmn).
  // لا نلمس الخوادم الأخرى التي أضافها المستخدم.
  const defaultId = 'default-nader-pay-server';
  const appSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://hbldhnpduoczneoyfzyz.supabase.co';
  const appAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhibGRobnBkdW9jem5lb3lmenl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MzM2NzksImV4cCI6MjEwMzMwOTY3OX0.uT0Oy_AYcMIQe1VNrWLTnPCSiE141MntZbp3IgFLpxE';
  const defaultUrl = `${appSupabaseUrl}/functions/v1/backend-proxy`;
  const defaultToken = appAnonKey;
  const now = new Date().toISOString();

  // 1. تحديث الخادم القديم المعروف بـ URL القديم (ccimllgqdxuvymdeikmn) فقط
  //    SAFE: لا يُطابق إلا الخادم الذي نعرفه بالاسم — لا يلمس الخوادم الأخرى
  await db.runAsync(
    `UPDATE server_profiles
     SET token = ?, auth_type = 'bearer', base_url = ?, updated_at = ?
     WHERE base_url LIKE '%ccimllgqdxuvymdeikmn%' OR id = ?`,
    [defaultToken, defaultUrl, now, defaultId]
  );

  // 2. إذا لم يكن هناك أي خادم، نُدرج الخادم الافتراضي ونُنشّطه
  const existingProfiles = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM server_profiles LIMIT 1"
  );
  if (existingProfiles.length === 0) {
    await db.runAsync(
      `INSERT OR REPLACE INTO server_profiles
        (id, name, base_url, auth_type, token, discovery_url, is_active, is_connected, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      [defaultId, 'Nader Pay', defaultUrl, 'bearer', defaultToken, null, now, now]
    );
    await db.runAsync(
      `INSERT INTO agent_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ['active_server_profile_id', defaultId]
    );
  }

  // 3. FIX RC#1 self-healing: إذا لا يوجد خادم نشط (is_active=1) رغم وجود خوادم،
  //    نُنشّط أوّل خادم متاح ونُحدّث active_server_profile_id في agent_settings.
  //    هذا يُستعيد الخادم المحفوظ بعد أي regression يُصفّر is_active.
  const activeProfile = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM server_profiles WHERE is_active = 1 LIMIT 1"
  );
  if (activeProfile.length === 0) {
    const firstProfile = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM server_profiles ORDER BY updated_at DESC LIMIT 1"
    );
    if (firstProfile.length > 0) {
      const restoredId = firstProfile[0].id;
      await db.runAsync('UPDATE server_profiles SET is_active = 1 WHERE id = ?', [restoredId]);
      await db.runAsync(
        `INSERT INTO agent_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ['active_server_profile_id', restoredId]
      );
      console.info('[database] ♻️ تم استعادة الخادم المحفوظ تلقائياً:', restoredId);
    }
  }

  // 4. إذا كان active_server_profile_id فارغاً أو غير موجود لكن is_active=1 موجود،
  //    نُحدّث agent_settings لمطابقة الواقع الفعلي.
  const activeSettingRow = await db.getAllAsync<{ value: string }>(
    "SELECT value FROM agent_settings WHERE key = 'active_server_profile_id' LIMIT 1"
  );
  const activeSetting = activeSettingRow[0]?.value ?? '';
  if (!activeSetting) {
    const activeRow = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM server_profiles WHERE is_active = 1 LIMIT 1"
    );
    if (activeRow.length > 0) {
      await db.runAsync(
        `INSERT INTO agent_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ['active_server_profile_id', activeRow[0].id]
      );
    }
  }

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
          o.updated_at ?? new Date().toISOString(),
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
  // دائماً نُحدّث updated_at عند أي تعديل محلي
  fields.push("updated_at = datetime('now')");
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

// ====== Retry Classification ======

export type RetryClass =
  | 'RETRYABLE'
  | 'NON_RETRYABLE'
  | 'AUTH_REQUIRED'
  | 'DUPLICATE'
  | 'REVIEW_REQUIRED'
  | 'PERMANENT_FAILURE';

export function classifyHttpError(status: number, errorBody?: string): RetryClass {
  if (status === 401) return 'AUTH_REQUIRED';
  if (status === 403) return 'AUTH_REQUIRED';
  if (status === 409) return 'DUPLICATE';
  if (status === 400) return 'NON_RETRYABLE';
  if (status === 422) return 'NON_RETRYABLE';
  if (status === 404) return 'NON_RETRYABLE';
  if (status === 410) return 'PERMANENT_FAILURE';
  if (status >= 500 && status < 600) return 'RETRYABLE';
  if (status === 408) return 'RETRYABLE';
  if (status === 429) return 'RETRYABLE';
  if (!status && errorBody?.includes('timeout')) return 'RETRYABLE';
  if (!status && errorBody?.includes('network')) return 'RETRYABLE';
  return 'RETRYABLE';
}

export function computeNextRetryAt(attempts: number, retryClass: RetryClass): string | null {
  if (retryClass === 'NON_RETRYABLE' || retryClass === 'AUTH_REQUIRED' ||
      retryClass === 'PERMANENT_FAILURE' || retryClass === 'DUPLICATE') {
    return null; // لا إعادة محاولة
  }
  // exponential backoff: 2s, 4s, 8s, 16s, 32s, 64s — max 5 دقائق
  const baseMs = 2000;
  const delayMs = Math.min(baseMs * Math.pow(2, attempts), 300_000);
  const jitterMs = Math.floor(Math.random() * 1000);
  return new Date(Date.now() + delayMs + jitterMs).toISOString();
}

export async function enqueueOffline(
  orderId: string,
  action: 'confirm' | 'reject',
  payload: Record<string, unknown>,
  opts?: { idempotencyKey?: string; retryClass?: RetryClass }
): Promise<void> {
  const db = await dbReady;
  // idempotency: نستخدم مفتاحاً ثابتاً حتى لا يُسبب retry إنشاء عملية منطقية جديدة
  const idempotencyKey = opts?.idempotencyKey ?? `${orderId}:${action}`;
  // مشروط: إذا كان هناك عنصر pending بنفس idempotency_key لا نُدرج جديداً
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM offline_queue WHERE idempotency_key = ? AND status IN ('pending','syncing')",
    [idempotencyKey]
  );
  if (existing) return; // عنصر بنفس المفتاح موجود بالفعل
  const id = `${orderId}-${action}-${Date.now()}`;
  const retryClass = opts?.retryClass ?? 'RETRYABLE';
  await db.runAsync(
    `INSERT INTO offline_queue (id, order_id, action, payload, idempotency_key, retry_class)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, orderId, action, JSON.stringify(payload), idempotencyKey, retryClass]
  );
}

export async function getPendingOfflineQueue(): Promise<{
  id: string;
  order_id: string;
  action: string;
  payload: string;
  attempts: number;
  status: string;
  idempotency_key: string | null;
  retry_class: string | null;
  error_code: string | null;
  next_retry_at: string | null;
  created_at: string;
}[]> {
  const db = await dbReady;
  const now = new Date().toISOString();
  // فقط العناصر RETRYABLE التي حان وقت إعادة محاولتها
  return db.getAllAsync(
    `SELECT * FROM offline_queue
     WHERE status = 'pending'
       AND retry_class NOT IN ('NON_RETRYABLE','AUTH_REQUIRED','PERMANENT_FAILURE','DUPLICATE')
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY created_at ASC`,
    [now]
  ) as any;
}

export async function getAllPendingOfflineQueue(): Promise<{
  id: string;
  order_id: string;
  action: string;
  payload: string;
  attempts: number;
  status: string;
  idempotency_key: string | null;
  retry_class: string | null;
  error_code: string | null;
  next_retry_at: string | null;
  created_at: string;
}[]> {
  const db = await dbReady;
  return db.getAllAsync(
    "SELECT * FROM offline_queue WHERE status IN ('pending','syncing') ORDER BY created_at ASC"
  ) as any;
}

export async function getOfflineQueueCount(): Promise<number> {
  const db = await dbReady;
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM offline_queue WHERE status IN ('pending','syncing')"
  );
  return row?.count ?? 0;
}

export async function updateOfflineQueueStatus(
  id: string,
  status: 'pending' | 'syncing' | 'failed',
  attempts: number,
  opts?: { errorCode?: string; retryClass?: RetryClass }
): Promise<void> {
  const db = await dbReady;
  const retryClass = opts?.retryClass ?? 'RETRYABLE';
  const nextRetry = status === 'pending' ? computeNextRetryAt(attempts, retryClass) : null;
  await db.runAsync(
    'UPDATE offline_queue SET status = ?, attempts = ?, error_code = ?, retry_class = ?, next_retry_at = ? WHERE id = ?',
    [status, attempts, opts?.errorCode ?? null, retryClass, nextRetry, id]
  );
}

export async function deleteOfflineQueueItem(id: string): Promise<void> {
  const db = await dbReady;
  await db.runAsync('DELETE FROM offline_queue WHERE id = ?', [id]);
}

// ====== Event Deduplication ======

export async function recordDedupEvent(
  dedupKey: string,
  eventType: string
): Promise<{ isNew: boolean; occurrenceCount: number }> {
  const db = await dbReady;
  const existing = await db.getFirstAsync<{ occurrence_count: number }>(
    'SELECT occurrence_count FROM event_deduplication WHERE dedup_key = ?',
    [dedupKey]
  );
  if (existing) {
    const count = existing.occurrence_count + 1;
    await db.runAsync(
      "UPDATE event_deduplication SET last_seen_at = datetime('now'), occurrence_count = ? WHERE dedup_key = ?",
      [count, dedupKey]
    );
    return { isNew: false, occurrenceCount: count };
  }
  await db.runAsync(
    'INSERT INTO event_deduplication (dedup_key, event_type) VALUES (?, ?)',
    [dedupKey, eventType]
  );
  return { isNew: true, occurrenceCount: 1 };
}

export async function isDedupEventSeen(dedupKey: string): Promise<boolean> {
  const db = await dbReady;
  const row = await db.getFirstAsync<{ dedup_key: string }>(
    'SELECT dedup_key FROM event_deduplication WHERE dedup_key = ?',
    [dedupKey]
  );
  return row !== null && row !== undefined;
}

export async function resolveDedupEvent(dedupKey: string): Promise<void> {
  const db = await dbReady;
  await db.runAsync('UPDATE event_deduplication SET resolved = 1 WHERE dedup_key = ?', [dedupKey]);
}

// ====== Timestamp integrity helpers for orders ======

export async function setOrderTimestamp(
  orderId: string,
  field: 'sms_received_at' | 'notification_received_at' | 'first_seen_local_at' |
         'processed_at' | 'verified_at' | 'sync_started_at' | 'synced_at',
  value: string
): Promise<void> {
  const db = await dbReady;
  // لا نُحدّث إذا كانت القيمة موجودة بالفعل (نحافظ على أول قيمة)
  if (field === 'sms_received_at' || field === 'notification_received_at' || field === 'first_seen_local_at') {
    await db.runAsync(
      `UPDATE orders_cache SET ${field} = ? WHERE id = ? AND ${field} IS NULL`,
      [value, orderId]
    );
  } else {
    await db.runAsync(`UPDATE orders_cache SET ${field} = ? WHERE id = ?`, [value, orderId]);
  }
}

export async function markSmsSentToOrder(
  smsId: string,
  orderId: string
): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    "UPDATE local_sms_index SET matched_order_id = ?, match_status = 'matched' WHERE id = ?",
    [orderId, smsId]
  );
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


export async function saveProviderSource(source: {
  id: string;
  providerId: string;
  providerName: string;
  sourceId: string;
  sourceType?: string;
  sourceMetadata?: Record<string, unknown> | null;
  parserVersion?: string;
  receivingAccount?: string | null;
  approvedSenderIdentifiers?: string[];
  messagePatterns?: string[];
  verified?: boolean;
  enabled?: boolean;
  status?: string;
  lastMessageAt?: string | null;
  lastMessageSummary?: string | null;
  lastVerificationAt?: string | null;
  lastVerificationResult?: string | null;
}): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    `INSERT INTO provider_sources (
      id, provider_id, provider_name, source_id, source_type, source_metadata, parser_version,
      receiving_account, approved_sender_identifiers, message_patterns, verified, enabled, status,
      last_message_at, last_message_summary, last_verification_at, last_verification_result,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      provider_id = excluded.provider_id,
      provider_name = excluded.provider_name,
      source_id = excluded.source_id,
      source_type = excluded.source_type,
      source_metadata = excluded.source_metadata,
      parser_version = excluded.parser_version,
      receiving_account = excluded.receiving_account,
      approved_sender_identifiers = excluded.approved_sender_identifiers,
      message_patterns = excluded.message_patterns,
      verified = excluded.verified,
      enabled = excluded.enabled,
      status = excluded.status,
      last_message_at = excluded.last_message_at,
      last_message_summary = excluded.last_message_summary,
      last_verification_at = excluded.last_verification_at,
      last_verification_result = excluded.last_verification_result,
      updated_at = excluded.updated_at`,
    [
      source.id,
      source.providerId,
      source.providerName,
      source.sourceId,
      source.sourceType ?? 'sms',
      source.sourceMetadata ? JSON.stringify(source.sourceMetadata) : null,
      source.parserVersion ?? null,
      source.receivingAccount ?? null,
      source.approvedSenderIdentifiers ? JSON.stringify(source.approvedSenderIdentifiers) : null,
      source.messagePatterns ? JSON.stringify(source.messagePatterns) : null,
      source.verified ? 1 : 0,
      source.enabled ?? true ? 1 : 0,
      source.status ?? 'unverified',
      source.lastMessageAt ?? null,
      source.lastMessageSummary ?? null,
      source.lastVerificationAt ?? null,
      source.lastVerificationResult ?? null,
    ]
  );
}

export async function getProviderSources(providerId?: string): Promise<{
  id: string;
  provider_id: string;
  provider_name: string;
  source_id: string;
  source_type: string;
  source_metadata: string | null;
  parser_version: string | null;
  receiving_account: string | null;
  approved_sender_identifiers: string | null;
  message_patterns: string | null;
  verified: number;
  enabled: number;
  status: string;
  last_message_at: string | null;
  last_message_summary: string | null;
  last_verification_at: string | null;
  last_verification_result: string | null;
  created_at: string;
  updated_at: string;
}[]> {
  const db = await dbReady;
  if (providerId) {
    return db.getAllAsync('SELECT * FROM provider_sources WHERE provider_id = ? ORDER BY updated_at DESC', [providerId]) as any;
  }
  return db.getAllAsync('SELECT * FROM provider_sources ORDER BY updated_at DESC') as any;
}

export async function getVerifiedProviderSources(): Promise<{
  id: string;
  provider_id: string;
  provider_name: string;
  source_id: string;
  source_type: string;
  source_metadata: string | null;
  parser_version: string | null;
  receiving_account: string | null;
  approved_sender_identifiers: string | null;
  message_patterns: string | null;
  verified: number;
  enabled: number;
  status: string;
  last_message_at: string | null;
  last_message_summary: string | null;
  last_verification_at: string | null;
  last_verification_result: string | null;
  created_at: string;
  updated_at: string;
}[]> {
  const db = await dbReady;
  return db.getAllAsync(
    "SELECT * FROM provider_sources WHERE verified = 1 AND enabled = 1 AND status = 'verified' ORDER BY provider_id"
  ) as any;
}

export async function revokeProviderSource(id: string): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    "UPDATE provider_sources SET verified = 0, enabled = 0, status = 'unverified', source_id = NULL, updated_at = datetime('now') WHERE id = ?",
    [id]
  );
}

export async function addInAppNotification(notification: {
  id: string;
  eventId: string;
  type: string;
  title: string;
  body: string;
  payload?: Record<string, unknown> | null;
  relatedOrderId?: string | null;
  relatedProviderId?: string | null;
  deepLink?: string | null;
}): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    `INSERT INTO in_app_notifications (
      id, event_id, type, title, body, payload, related_order_id, related_provider_id, deep_link
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      updated_at = datetime('now')`,
    [
      notification.id,
      notification.eventId,
      notification.type,
      notification.title,
      notification.body,
      notification.payload ? JSON.stringify(notification.payload) : null,
      notification.relatedOrderId ?? null,
      notification.relatedProviderId ?? null,
      notification.deepLink ?? null,
    ]
  );
}

export async function getInAppNotifications(limit = 100): Promise<{
  id: string;
  event_id: string;
  type: string;
  title: string;
  body: string;
  payload: string | null;
  read: number;
  related_order_id: string | null;
  related_provider_id: string | null;
  deep_link: string | null;
  created_at: string;
}[]> {
  const db = await dbReady;
  return db.getAllAsync(
    'SELECT * FROM in_app_notifications ORDER BY created_at DESC LIMIT ?',
    [limit]
  ) as any;
}

export async function getUnreadNotificationCount(): Promise<number> {
  const db = await dbReady;
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM in_app_notifications WHERE read = 0'
  );
  return row?.count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
  const db = await dbReady;
  await db.runAsync("UPDATE in_app_notifications SET read = 1 WHERE id = ?", [id]);
}

export async function markAllNotificationsRead(): Promise<void> {
  const db = await dbReady;
  await db.runAsync("UPDATE in_app_notifications SET read = 1");
}

// ====== Dead Letter Queue ======

export async function addToDeadLetter(item: {
  id: string;
  eventId?: string;
  orderId?: string;
  module: string;
  action: string;
  errorCode?: string;
  safeErrorMessage?: string;
  retryCount?: number;
  firstAttemptAt?: string;
  lastAttemptAt?: string;
  lastAction?: string;
  nextAction?: string;
  payload?: unknown;
}): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    `INSERT OR REPLACE INTO dead_letter_queue
      (id, event_id, order_id, module, action, error_code, safe_error_message,
       retry_count, first_attempt_at, last_attempt_at, last_action, next_action, payload, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      item.id,
      item.eventId ?? null,
      item.orderId ?? null,
      item.module,
      item.action,
      item.errorCode ?? null,
      item.safeErrorMessage ?? null,
      item.retryCount ?? 0,
      item.firstAttemptAt ?? new Date().toISOString(),
      item.lastAttemptAt ?? new Date().toISOString(),
      item.lastAction ?? null,
      item.nextAction ?? 'REVIEW_REQUIRED',
      item.payload ? JSON.stringify(item.payload) : null,
    ]
  );
}

export async function getDeadLetterItems(limit = 50): Promise<{
  id: string;
  event_id: string | null;
  order_id: string | null;
  module: string;
  action: string;
  error_code: string | null;
  safe_error_message: string | null;
  retry_count: number;
  first_attempt_at: string;
  last_attempt_at: string;
  resolved: number;
  created_at: string;
}[]> {
  const db = await dbReady;
  return db.getAllAsync(
    'SELECT * FROM dead_letter_queue WHERE resolved = 0 ORDER BY created_at DESC LIMIT ?',
    [limit]
  ) as any;
}

export async function getDeadLetterCount(): Promise<number> {
  const db = await dbReady;
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM dead_letter_queue WHERE resolved = 0'
  );
  return row?.count ?? 0;
}

export async function resolveDeadLetterItem(id: string): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    "UPDATE dead_letter_queue SET resolved = 1, resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [id]
  );
}

// ====== Sync Cursor ======

export async function setSyncCursor(
  cursorKey: string,
  data: {
    lastEventId?: string;
    lastSyncedAt?: string;
    lastServerSequence?: string;
    checkpointStatus?: 'valid' | 'stale' | 'recovering';
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    `INSERT INTO sync_cursor (cursor_key, last_event_id, last_synced_at, last_server_sequence, checkpoint_status, metadata, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(cursor_key) DO UPDATE SET
       last_event_id = excluded.last_event_id,
       last_synced_at = excluded.last_synced_at,
       last_server_sequence = excluded.last_server_sequence,
       checkpoint_status = excluded.checkpoint_status,
       metadata = excluded.metadata,
       updated_at = datetime('now')`,
    [
      cursorKey,
      data.lastEventId ?? null,
      data.lastSyncedAt ?? new Date().toISOString(),
      data.lastServerSequence ?? null,
      data.checkpointStatus ?? 'valid',
      data.metadata ? JSON.stringify(data.metadata) : null,
    ]
  );
}

export async function getSyncCursor(cursorKey: string): Promise<{
  cursor_key: string;
  last_event_id: string | null;
  last_synced_at: string | null;
  last_server_sequence: string | null;
  checkpoint_status: string;
  metadata: string | null;
  updated_at: string;
} | null> {
  const db = await dbReady;
  return db.getFirstAsync(
    'SELECT * FROM sync_cursor WHERE cursor_key = ?',
    [cursorKey]
  ) as any;
}

export async function markSyncCursorStale(cursorKey: string): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    "UPDATE sync_cursor SET checkpoint_status = 'stale', updated_at = datetime('now') WHERE cursor_key = ?",
    [cursorKey]
  );
}

// ====== In-Flight Recovery ======

export async function getInFlightOrders(): Promise<{
  id: string;
  local_status: string;
  transaction_stage: string | null;
  in_flight_at: string | null;
  created_at: string;
}[]> {
  const db = await dbReady;
  return db.getAllAsync(
    `SELECT id, local_status, transaction_stage, in_flight_at, created_at
     FROM orders_cache
     WHERE transaction_stage IN ('MATCHING','VERIFYING','RETRYING')
        OR local_status IN ('syncing','scanning')
     ORDER BY created_at ASC`
  ) as any;
}

export async function markOrderInFlight(orderId: string): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    "UPDATE orders_cache SET in_flight_at = datetime('now') WHERE id = ?",
    [orderId]
  );
}

export async function clearOrderInFlight(orderId: string): Promise<void> {
  const db = await dbReady;
  await db.runAsync(
    "UPDATE orders_cache SET in_flight_at = NULL WHERE id = ?",
    [orderId]
  );
}

// ====== Audit Trail ======

export type AuditAction =
  | 'order_received' | 'order_matched' | 'order_confirmed' | 'order_rejected'
  | 'sms_received' | 'sms_matched' | 'sms_indexed'
  | 'sync_success' | 'sync_failed' | 'sync_skipped'
  | 'dead_letter_added' | 'recovery_started' | 'recovery_complete'
  | 'circuit_open' | 'circuit_closed' | 'device_registered' | 'device_revoked'
  | 'auth_refreshed' | 'auth_failed';

export async function recordAuditEvent(
  action: AuditAction,
  orderId: string | null,
  details: Record<string, unknown> = {}
): Promise<void> {
  await logEvent(`audit:${action}`, orderId ?? 'system', {
    audit: true,
    orderId,
    timestamp: new Date().toISOString(),
    ...details,
  });
}
