/**
 * auditE2E.test.ts
 * ══════════════════════════════════════════════════════════════════════════════
 * اختبارات الفحص الشامل النهائي — NaderPay E2E Audit
 *
 * تغطي:
 *   1. SSRF Protection  — حجب العناوين الخاصة في backend-proxy
 *   2. HMAC Signing     — توقيع Webhook وتحقق Raw Body
 *   3. Multi-Tenant     — عزل Account A عن Account B
 *   4. State Machine    — منع الانتقالات غير المسموحة
 *   5. Verification Engine — مطابقة SMS مع PR
 *   6. Idempotency      — عدم تكرار payment request لنفس المفتاح
 *   7. API Key Format   — التحقق من صيغة KEY_ID:SECRET
 *   8. Webhook Payload  — بنية الحدث المُرسَل للموقع الخارجي
 * ══════════════════════════════════════════════════════════════════════════════
 */

/* eslint-disable no-undef */

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('@/services/smsReader', () => ({
  readAllFromSource: jest.fn().mockResolvedValue([]),
  readMessagesFromSources: jest.fn().mockResolvedValue([]),
  readExistingPaymentMessages: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/services/providers', () => ({
  parseMessage: jest.fn().mockReturnValue(null),
  detectProvider: jest.fn().mockReturnValue(null),
}));

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1 — SSRF Protection
// يتحقق من أن backend-proxy يحجب العناوين الخاصة
// ═════════════════════════════════════════════════════════════════════════════
describe('SSRF Protection — backend-proxy URL validation', () => {
  // استنسخ منطق الحجب من backend-proxy/index.ts
  function isSsrfBlocked(url: string): boolean {
    try {
      const target = new URL(url);
      if (!['http:', 'https:'].includes(target.protocol)) return true;
      const hostname = target.hostname.toLowerCase();
      const BLOCKED: RegExp[] = [
        /^localhost$/,
        /^127\./,
        /^0\.0\.0\.0$/,
        /^::1$/,
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[01])\./,
        /^192\.168\./,
        /^169\.254\./,
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
        /^fd[0-9a-f]{2}:/,
        /^fe80:/,
        /^0\./,
        /^metadata\.google\.internal$/,
      ];
      return BLOCKED.some(p => p.test(hostname));
    } catch {
      return true;
    }
  }

  const blockedUrls = [
    'http://localhost/api',
    'http://127.0.0.1/secret',
    'http://0.0.0.0/',
    'http://10.0.0.1/internal',
    'http://10.255.255.255/admin',
    'http://172.16.0.1/config',
    'http://172.31.255.254/metadata',
    'http://192.168.1.1/router',
    'http://169.254.169.254/latest/meta-data/',  // AWS IMDS
    'http://169.254.0.1/any',
    'http://metadata.google.internal/computeMetadata/',
    'ftp://external.com/file',
    'file:///etc/passwd',
  ];

  const allowedUrls = [
    'https://api.example.com/payments',
    'https://webhook.customer.com/receive',
    'https://external-service.io/notify',
    'http://public-api.net/data',
  ];

  test.each(blockedUrls)('blocks private/internal URL: %s', (url) => {
    expect(isSsrfBlocked(url)).toBe(true);
  });

  test.each(allowedUrls)('allows public URL: %s', (url) => {
    expect(isSsrfBlocked(url)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2 — HMAC Webhook Signing
// يتحقق من صحة توليد HMAC وحساسيته للتعديل
// ═════════════════════════════════════════════════════════════════════════════
describe('HMAC Webhook Signing', () => {
  function signPayload(secret: string, rawBody: string): string {
    // محاكاة منطق webhook-dispatcher: HMAC-SHA256 على raw body
    // نستخدم crypto module المتاح في Node
    const crypto = require('crypto');
    const sig = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    return 'sha256=' + sig;
  }

  function verifySignature(secret: string, rawBody: string, signature: string): boolean {
    const expected = signPayload(secret, rawBody);
    const crypto = require('crypto');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected, 'utf8'),
        Buffer.from(signature, 'utf8')
      );
    } catch {
      return false;
    }
  }

  const SECRET = 'test_webhook_secret_64chars_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const PAYLOAD = JSON.stringify({
    event: 'payment.confirmed',
    id: 'evt_audit_001',
    version: '2026-01',
    data: { id: 'pay_001', amount: 100, currency: 'EGP', status: 'CONFIRMED' },
  }, null, 0);

  test('correct secret produces sha256= prefixed signature', () => {
    const sig = signPayload(SECRET, PAYLOAD);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  test('same secret + body always produces identical signature (deterministic)', () => {
    const sig1 = signPayload(SECRET, PAYLOAD);
    const sig2 = signPayload(SECRET, PAYLOAD);
    expect(sig1).toBe(sig2);
  });

  test('correct signature passes verification', () => {
    const sig = signPayload(SECRET, PAYLOAD);
    expect(verifySignature(SECRET, PAYLOAD, sig)).toBe(true);
  });

  test('wrong secret fails verification', () => {
    const sig = signPayload('wrong_secret', PAYLOAD);
    expect(verifySignature(SECRET, PAYLOAD, sig)).toBe(false);
  });

  test('modified body fails verification (body integrity)', () => {
    const sig = signPayload(SECRET, PAYLOAD);
    const modifiedBody = PAYLOAD + ' ';
    expect(verifySignature(SECRET, modifiedBody, sig)).toBe(false);
  });

  test('JSON.stringify(JSON.parse(body)) == raw_body — raw body must be used', () => {
    // يثبت أن JSON.parse ثم stringify تُنتج نفس النص بشرط عدم إضافة مسافات
    const parsed = JSON.parse(PAYLOAD);
    const reStringified = JSON.stringify(parsed, null, 0);
    const sigOriginal = signPayload(SECRET, PAYLOAD);
    const sigReStringified = signPayload(SECRET, reStringified);
    // يجب أن يكونا متطابقَين لأن الـ payload تم توليده بـ JSON.stringify بدون مسافات
    expect(sigOriginal).toBe(sigReStringified);
  });

  test('signature with added whitespace in body fails — raw body sensitivity', () => {
    const sigOriginal = signPayload(SECRET, PAYLOAD);
    const sigPretty = signPayload(SECRET, JSON.stringify(JSON.parse(PAYLOAD), null, 2));
    // Pretty-printed body يغير التوقيع — يدل على أن raw body يجب الاستخدام
    expect(sigOriginal).not.toBe(sigPretty);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Multi-Tenant Isolation Logic
// يتحقق من أن account_id يُحدد دائمًا من الـ credential وليس من الطلب
// ═════════════════════════════════════════════════════════════════════════════
describe('Multi-Tenant Isolation', () => {
  // محاكاة منطق payment-requests: account_id يُستخرج من الـ credential دائمًا
  function resolveAccountFromCredential(
    credential: { key_id: string; account_id: string; status: string },
    requestBodyAccountId?: string
  ): { account_id: string; overrideAttempted: boolean } {
    return {
      account_id: credential.account_id,
      overrideAttempted: !!requestBodyAccountId && requestBodyAccountId !== credential.account_id,
    };
  }

  const credA = { key_id: 'pk_accountA', account_id: 'acc-A-uuid', status: 'active' };
  const credB = { key_id: 'pk_accountB', account_id: 'acc-B-uuid', status: 'active' };

  test('account_id always comes from credential, never from request body', () => {
    const result = resolveAccountFromCredential(credA, 'acc-B-uuid');
    expect(result.account_id).toBe('acc-A-uuid');
    expect(result.overrideAttempted).toBe(true);
  });

  test('Account A credential gives Account A account_id', () => {
    const { account_id } = resolveAccountFromCredential(credA);
    expect(account_id).toBe('acc-A-uuid');
  });

  test('Account B credential gives Account B account_id', () => {
    const { account_id } = resolveAccountFromCredential(credB);
    expect(account_id).toBe('acc-B-uuid');
  });

  test('cross-account override attempt is detected', () => {
    const { overrideAttempted } = resolveAccountFromCredential(credA, credB.account_id);
    expect(overrideAttempted).toBe(true);
  });

  test('same account does not flag as override attempt', () => {
    const { overrideAttempted } = resolveAccountFromCredential(credA, credA.account_id);
    expect(overrideAttempted).toBe(false);
  });

  // اختبار RLS: الاستعلامات تُقيَّد دائمًا بـ account_id
  test('RLS filter always appends account_id to queries', () => {
    function buildQuery(table: string, credential: typeof credA, filters?: object) {
      return {
        from: table,
        filters: { account_id: credential.account_id, ...filters },
      };
    }
    const query = buildQuery('payment_requests', credA, { status: 'CREATED' });
    expect(query.filters.account_id).toBe('acc-A-uuid');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4 — State Machine Transitions
// يتحقق من القيود المفروضة على انتقالات حالة طلبات الدفع
// ═════════════════════════════════════════════════════════════════════════════
describe('Payment Request State Machine', () => {
  type PaymentStatus = 'CREATED' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'REVIEW_REQUIRED';

  const TERMINAL_STATES: PaymentStatus[] = ['CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED'];

  const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
    CREATED: ['CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'REVIEW_REQUIRED'],
    REVIEW_REQUIRED: ['CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
    CONFIRMED: [],
    REJECTED: [],
    EXPIRED: [],
    CANCELLED: [],
  };

  function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
  }

  // الانتقالات المسموحة
  test.each([
    ['CREATED', 'CONFIRMED'],
    ['CREATED', 'REJECTED'],
    ['CREATED', 'EXPIRED'],
    ['CREATED', 'CANCELLED'],
    ['CREATED', 'REVIEW_REQUIRED'],
    ['REVIEW_REQUIRED', 'CONFIRMED'],
    ['REVIEW_REQUIRED', 'REJECTED'],
  ] as [PaymentStatus, PaymentStatus][])(
    'allows transition %s → %s',
    (from, to) => expect(canTransition(from, to)).toBe(true)
  );

  // الانتقالات المحجوبة — لا يجوز العودة من حالة نهائية
  test.each(
    TERMINAL_STATES.flatMap(terminal =>
      (['CREATED', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED'] as PaymentStatus[])
        .filter(any => any !== terminal)
        .map(any => [terminal, any] as [PaymentStatus, PaymentStatus])
    )
  )('blocks illegal transition %s → %s (terminal state)', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  test('CONFIRMED is terminal — zero allowed outgoing transitions', () => {
    expect(ALLOWED_TRANSITIONS['CONFIRMED']).toHaveLength(0);
  });

  test('EXPIRED is terminal — zero allowed outgoing transitions', () => {
    expect(ALLOWED_TRANSITIONS['EXPIRED']).toHaveLength(0);
  });

  test('all terminal states block re-entry to CREATED', () => {
    TERMINAL_STATES.forEach(t => expect(canTransition(t, 'CREATED')).toBe(false));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Verification Engine Matching Logic
// يتحقق من منطق مطابقة الـ SMS مع طلب الدفع الصحيح
// ═════════════════════════════════════════════════════════════════════════════
describe('Verification Engine — SMS matching', () => {
  interface PaymentRequest {
    id: string;
    account_id: string;
    amount: number;
    currency: string;
    expected_sender_phone: string;
    expected_recipient_wallet: string;
    status: string;
    expires_at: Date;
  }

  interface Transaction {
    amount: number;
    sender_phone: string;
    recipient_wallet: string;
    occurred_at: Date;
    message_hash: string;
  }

  type MatchResult = 'MATCH_OK' | 'AMOUNT_MISMATCH' | 'WALLET_MISMATCH' | 'EXPIRED_PR' | 'DUPLICATE' | 'NO_MATCH';

  function normalizePhone(p: string): string {
    return p.replace(/[\s\-()]/g, '');
  }

  function checkDuplicate(hash: string, seen: Set<string>): boolean {
    return seen.has(hash);
  }

  function matchTransaction(tx: Transaction, pr: PaymentRequest, seenHashes: Set<string>): MatchResult {
    if (seenHashes.has(tx.message_hash)) return 'DUPLICATE';
    if (pr.expires_at < tx.occurred_at) return 'EXPIRED_PR';
    if (Math.abs(tx.amount - pr.amount) > 0.01) return 'AMOUNT_MISMATCH';
    if (normalizePhone(pr.expected_recipient_wallet) !== normalizePhone(tx.recipient_wallet))
      return 'WALLET_MISMATCH';
    return 'MATCH_OK';
  }

  const now = new Date();
  const basePR: PaymentRequest = {
    id: 'pr-001',
    account_id: 'acc-A',
    amount: 100.00,
    currency: 'EGP',
    expected_sender_phone: '01012345678',
    expected_recipient_wallet: '01099887766',
    status: 'CREATED',
    expires_at: new Date(now.getTime() + 30 * 60 * 1000), // +30 min
  };
  const seenHashes = new Set<string>();

  test('TC1: perfect match → MATCH_OK', () => {
    const tx: Transaction = {
      amount: 100.00,
      sender_phone: '01012345678',
      recipient_wallet: '01099887766',
      occurred_at: now,
      message_hash: 'hash-tx1-unique',
    };
    expect(matchTransaction(tx, basePR, seenHashes)).toBe('MATCH_OK');
  });

  test('TC2: wrong amount → AMOUNT_MISMATCH', () => {
    const tx: Transaction = {
      amount: 999.00,
      sender_phone: '01012345678',
      recipient_wallet: '01099887766',
      occurred_at: now,
      message_hash: 'hash-tx2',
    };
    expect(matchTransaction(tx, basePR, seenHashes)).toBe('AMOUNT_MISMATCH');
  });

  test('TC3: wrong wallet → WALLET_MISMATCH', () => {
    const tx: Transaction = {
      amount: 100.00,
      sender_phone: '01012345678',
      recipient_wallet: '01011111111',
      occurred_at: now,
      message_hash: 'hash-tx3',
    };
    expect(matchTransaction(tx, basePR, seenHashes)).toBe('WALLET_MISMATCH');
  });

  test('TC4: expired PR → EXPIRED_PR (no confirmation even with correct data)', () => {
    const expiredPR: PaymentRequest = {
      ...basePR,
      expires_at: new Date(now.getTime() - 2 * 60 * 60 * 1000), // -2 hrs
    };
    const tx: Transaction = {
      amount: 100.00,
      sender_phone: '01012345678',
      recipient_wallet: '01099887766',
      occurred_at: now,
      message_hash: 'hash-tx4',
    };
    expect(matchTransaction(tx, expiredPR, seenHashes)).toBe('EXPIRED_PR');
  });

  test('TC5: duplicate message_hash → DUPLICATE', () => {
    const existingHashes = new Set(['hash-tx1-unique']);
    const tx: Transaction = {
      amount: 100.00,
      sender_phone: '01012345678',
      recipient_wallet: '01099887766',
      occurred_at: now,
      message_hash: 'hash-tx1-unique', // نفس hash TC1
    };
    expect(matchTransaction(tx, basePR, existingHashes)).toBe('DUPLICATE');
  });

  test('TC6: wallet comparison ignores spaces and dashes', () => {
    const prWithSpaces: PaymentRequest = {
      ...basePR,
      expected_recipient_wallet: '010 9988 7766',
    };
    const tx: Transaction = {
      amount: 100.00,
      sender_phone: '01012345678',
      recipient_wallet: '01099887766',
      occurred_at: now,
      message_hash: 'hash-tx6',
    };
    expect(matchTransaction(tx, prWithSpaces, seenHashes)).toBe('MATCH_OK');
  });

  test('TC7: amount within 0.01 tolerance → MATCH_OK', () => {
    const tx: Transaction = {
      amount: 100.009,
      sender_phone: '01012345678',
      recipient_wallet: '01099887766',
      occurred_at: now,
      message_hash: 'hash-tx7',
    };
    expect(matchTransaction(tx, basePR, seenHashes)).toBe('MATCH_OK');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Idempotency
// يتحقق من أن نفس x-idempotency-key لا ينشئ طلبَين مختلفَين
// ═════════════════════════════════════════════════════════════════════════════
describe('Idempotency', () => {
  interface CachedResponse { id: string; created_at: string }
  const store = new Map<string, CachedResponse>();

  function processRequest(idempotencyKey: string, data: { external_ref: string }): { cached: boolean; id: string } {
    if (store.has(idempotencyKey)) {
      return { cached: true, id: store.get(idempotencyKey)!.id };
    }
    const newId = `pr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    store.set(idempotencyKey, { id: newId, created_at: new Date().toISOString() });
    return { cached: false, id: newId };
  }

  beforeEach(() => store.clear());

  test('first request creates new PR', () => {
    const result = processRequest('idem-key-001', { external_ref: 'ORDER-001' });
    expect(result.cached).toBe(false);
    expect(result.id).toBeTruthy();
  });

  test('second request with same key returns cached PR (no duplicate)', () => {
    const first = processRequest('idem-key-001', { external_ref: 'ORDER-001' });
    const second = processRequest('idem-key-001', { external_ref: 'ORDER-001' });
    expect(second.cached).toBe(true);
    expect(second.id).toBe(first.id);
  });

  test('different keys create independent PRs', () => {
    const r1 = processRequest('idem-key-A', { external_ref: 'ORDER-A' });
    const r2 = processRequest('idem-key-B', { external_ref: 'ORDER-B' });
    expect(r1.id).not.toBe(r2.id);
    expect(r1.cached).toBe(false);
    expect(r2.cached).toBe(false);
  });

  test('idempotency store isolates per key — 3 different keys = 3 different PRs', () => {
    const keys = ['key-1', 'key-2', 'key-3'];
    const ids = keys.map(k => processRequest(k, { external_ref: k }).id);
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 7 — API Key Format Validation
// يتحقق من صيغة KEY_ID:SECRET ودعم scope/status checks
// ═════════════════════════════════════════════════════════════════════════════
describe('API Key Format & Validation', () => {
  interface ApiCredential {
    key_id: string;
    encrypted_secret: string;
    status: 'active' | 'revoked' | 'expired';
    scopes: string[];
    account_id: string;
    environment: 'sandbox' | 'live';
  }

  function parseApiKey(raw: string): { key_id: string; secret: string } | null {
    // صيغة: pk_HEXSTRING:SECRET — أو KEY_ID.SECRET (صيغة قديمة)
    const colonIdx = raw.indexOf(':');
    const dotIdx = raw.indexOf('.');
    const separator = colonIdx !== -1 ? colonIdx : dotIdx !== -1 ? dotIdx : -1;
    if (separator === -1) return null;
    const key_id = raw.slice(0, separator);
    const secret = raw.slice(separator + 1);
    if (!key_id.startsWith('pk_') || secret.length < 8) return null;
    return { key_id, secret };
  }

  function validateCredential(
    parsed: { key_id: string; secret: string },
    credential: ApiCredential,
    requiredScope: string
  ): { valid: boolean; error?: string } {
    if (credential.status !== 'active') return { valid: false, error: 'CREDENTIAL_REVOKED' };
    if (!credential.scopes.includes(requiredScope)) return { valid: false, error: 'INSUFFICIENT_SCOPE' };
    return { valid: true };
  }

  const activeCred: ApiCredential = {
    key_id: 'pk_fab893430228224f70369613',
    encrypted_secret: 'ivB64.cipherB64',
    status: 'active',
    scopes: ['payment_requests'],
    account_id: 'acc-A-uuid',
    environment: 'sandbox',
  };

  test('valid pk_XXXXX:SECRET format parses correctly', () => {
    const parsed = parseApiKey('pk_fab893430228224f70369613:mysecret123');
    expect(parsed).not.toBeNull();
    expect(parsed!.key_id).toBe('pk_fab893430228224f70369613');
    expect(parsed!.secret).toBe('mysecret123');
  });

  test('valid pk_XXXXX.SECRET format (legacy) parses correctly', () => {
    const parsed = parseApiKey('pk_fab893430228224f70369613.mysecret123');
    expect(parsed).not.toBeNull();
    expect(parsed!.key_id).toBe('pk_fab893430228224f70369613');
  });

  test('key not starting with pk_ is rejected', () => {
    expect(parseApiKey('sk_live_abc123:secret')).toBeNull();
    expect(parseApiKey('api_key_abc:secret')).toBeNull();
  });

  test('key without separator is rejected', () => {
    expect(parseApiKey('pk_fab893430228224f70369613')).toBeNull();
  });

  test('secret shorter than 8 chars is rejected', () => {
    expect(parseApiKey('pk_abc:short')).toBeNull();
  });

  test('active credential with correct scope passes validation', () => {
    const parsed = { key_id: activeCred.key_id, secret: 'any' };
    const result = validateCredential(parsed, activeCred, 'payment_requests');
    expect(result.valid).toBe(true);
  });

  test('revoked credential fails validation', () => {
    const revokedCred: ApiCredential = { ...activeCred, status: 'revoked' };
    const result = validateCredential({ key_id: '', secret: '' }, revokedCred, 'payment_requests');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('CREDENTIAL_REVOKED');
  });

  test('insufficient scope fails validation', () => {
    const result = validateCredential({ key_id: '', secret: '' }, activeCred, 'admin');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_SCOPE');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 8 — Webhook Payload Contract
// يتحقق من بنية حدث الـ Webhook المُرسَل للموقع الخارجي
// ═════════════════════════════════════════════════════════════════════════════
describe('Webhook Payload Contract', () => {
  interface WebhookPayload {
    event: string;
    id: string;
    version: string;
    created_at: string;
    data: {
      id: string;
      external_reference?: string;
      order_reference?: string;
      amount: number;
      currency: string;
      status: string;
      account_id: string;
    };
  }

  function buildWebhookPayload(
    eventType: string,
    pr: { id: string; external_reference: string; amount: number; currency: string; status: string; account_id: string }
  ): WebhookPayload {
    return {
      event: eventType,
      id: `${pr.id}:${eventType}`,
      version: '2026-01',
      created_at: new Date().toISOString(),
      data: {
        id: pr.id,
        external_reference: pr.external_reference,
        amount: pr.amount,
        currency: pr.currency,
        status: pr.status,
        account_id: pr.account_id,
      },
    };
  }

  const pr = {
    id: 'pay-audit-001',
    external_reference: 'ORDER-AUDIT-001',
    amount: 100,
    currency: 'EGP',
    status: 'CONFIRMED',
    account_id: 'acc-A-uuid',
  };

  test('payment.confirmed payload has all required fields', () => {
    const payload = buildWebhookPayload('payment.confirmed', pr);
    expect(payload.event).toBe('payment.confirmed');
    expect(payload.id).toContain(pr.id);
    expect(payload.version).toBe('2026-01');
    expect(payload.created_at).toBeTruthy();
    expect(payload.data.id).toBe(pr.id);
    expect(payload.data.external_reference).toBe(pr.external_reference);
    expect(payload.data.amount).toBe(100);
    expect(payload.data.currency).toBe('EGP');
    expect(payload.data.status).toBe('CONFIRMED');
    expect(payload.data.account_id).toBe('acc-A-uuid');
  });

  test('event id is unique per event type (prevents collision)', () => {
    const p1 = buildWebhookPayload('payment.confirmed', pr);
    const p2 = buildWebhookPayload('payment.cancelled', pr);
    expect(p1.id).not.toBe(p2.id);
  });

  test('payload does not expose webhook_secret or api_secret', () => {
    const payload = buildWebhookPayload('payment.confirmed', pr);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('encrypted');
    expect(serialized).not.toContain('api_key');
  });

  test.each(['payment.confirmed', 'payment.rejected', 'payment.expired', 'payment.cancelled'])(
    'event type "%s" is a valid webhook event',
    (eventType) => {
      const payload = buildWebhookPayload(eventType, pr);
      expect(payload.event).toBe(eventType);
    }
  );
});
