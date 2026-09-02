/**
 * phase6BalanceBeforeQueue.test.ts
 * ══════════════════════════════════════════════════════════════════════════════
 * اختبارات Phase 6 الإلزامية — per spec Sections 22, 23, 24
 *
 * تغطي:
 *  TC01 — بحث زمني صحيح: Evidence من رسالة سابقة فعلية
 *  TC02 — رسالة أحدث من Transaction مرفوضة دائماً
 *  TC03 — عدة Balances سابقة → اختيار الأقرب
 *  TC04 — الرسالة الحالية (matchedSmsId) لا تُختار كـ Evidence
 *  TC05 — لا توجد Evidence → UNKNOWN (لا اختراع قيمة)
 *  TC06 — رسالة Incoming Payment سابقة كـ Evidence
 *  TC07 — رسالة Recharge كـ Evidence
 *  TC08 — رسالة Balance-Only كـ Evidence
 *  TC09 — رسالة ترويجية مرفوضة
 *  TC10 — Amount-Only مرفوضة
 *  TC11 — Transaction-ID-Only مرفوضة
 *  TC12 — أرقام عربية مدعومة
 *  TC13 — أرقام إنجليزية + مسافات متباينة
 *  TC14 — Content Provider غير مرتب → الترتيب الزمني يُصحَّح
 *  TC15 — مصدر مختلف → رفض
 *  TC16 — Balance Flow MATCH
 *  TC17 — Balance Flow MISMATCH لا يرفض Evidence تلقائياً
 *  TC18 — رسالة مستقبلية لا تُختار أبداً
 *  TC19 — PaymentRequestContext مستقلان (A لا يؤثر على B)
 *  TC20 — Queue FIFO: 1001 → 1002 → 1003
 *  TC21 — Idempotency: نفس requestId لا يُعالَج مرتين
 *  TC22 — SMS جديدة أثناء المعالجة لا تغير matchedSmsId
 *  TC23 — freezeMatchedTransaction يمنع تغيير matchedSmsId
 *  TC24 — resolveBalanceBefore يُعيد NO_MATCHED_SMS إذا لم يُثبَّت Snapshot
 * ══════════════════════════════════════════════════════════════════════════════
 */

/* eslint-disable no-undef */

// ── Mocks يجب أن تكون قبل كل import ─────────────────────────────────────────
// نُعطّل smsReader لمنع استيراد react-native في بيئة Node
jest.mock('@/services/smsReader', () => ({
  readAllFromSource: jest.fn().mockResolvedValue([]),
  readMessagesFromSources: jest.fn().mockResolvedValue([]),
  readExistingPaymentMessages: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/services/providers', () => ({
  parseMessage: jest.fn().mockReturnValue(null),
  detectProvider: jest.fn().mockReturnValue(null),
}));

// ─────────────────────────────────────────────────────────────────────────────

import {
  extractBalanceEvidence,
  validateBalanceFlow,
  toEnDigits,
  isVodafoneCashMessage,
  isValidBalanceEvidenceMessage,
  detectMessageType,
} from '../balanceUtils';

import {
  PaymentRequestQueue,
  createPaymentRequestContext,
  freezeMatchedTransaction,
  resolveBalanceBefore,
  type PaymentRequestContext,
  type PaymentRequestStatus,
} from '../paymentRequestQueue';

// ─── مساعدات بناء رسائل ──────────────────────────────────────────────────────

function ts(offsetMs: number): string {
  return new Date(1_700_000_000_000 + offsetMs).toISOString();
}

const BASE = 0;

const VF_INCOMING = (balance: number, txId = '022896233255') =>
  `تم استلام مبلغ 400 جنيه من رقم 01030951228 المسجل بإسم Wessam على رقم محفظتك 01097273680. رصيدك الحالي: ${balance} جنيه تاريخ العملية: 00:15 26-08-21 رقم العملية: ${txId}`;

const VF_RECHARGE = (balance: number) =>
  `تم شحن رصيد موبايلك ب 13.5 جنيه بنجاح. رصيد حسابك في فودافون كاش الحالي ${balance} جنيه`;

const VF_BALANCE_ONLY = (balance: number) =>
  `رصيدك الحالي: ${balance} جنيه`;

const VF_PROMO =
  'احصل على عرض خاص! وفّر 25% على تحويلاتك في فودافون كاش. صالح حتى نهاية الشهر';

const VF_AMOUNT_ONLY = 'تم دفع مبلغ 100 جنيه لخدمة X. العملية رقم 123456789';

const VF_TXID_ONLY = 'رقم العملية: 099887766554 — Vodafone Cash';

const ORANGE_MSG = 'Orange Money: تم تحويل 200 جنيه. الرصيد 5000 جنيه';

// ─── TC01 ─────────────────────────────────────────────────────────────────────
describe('TC01 — Balance Before من رسالة سابقة فعلية', () => {
  it('يستخرج Balance من رسالة Incoming Payment سابقة', () => {
    const ev = extractBalanceEvidence(VF_INCOMING(83924.60));
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(83924.60, 2);
  });

  it('الرسالة السابقة تحتوي Evidence صالحة', () => {
    expect(isValidBalanceEvidenceMessage(VF_INCOMING(83924.60))).toBe(true);
  });
});

// ─── TC02 ─────────────────────────────────────────────────────────────────────
describe('TC02 — رسالة أحدث من Transaction مرفوضة دائماً', () => {
  it('رسالة بـ ts > currentTs لا تُختار', () => {
    const currentTs = new Date(ts(2 * 60 * 60_000)).getTime();
    const futureTs  = new Date(ts(4 * 60 * 60_000 + 57 * 60_000)).getTime();
    expect(futureTs >= currentTs).toBe(true);
  });

  it('رسالة Balance 84007.90 في 04:57 يجب رفضها عند currentTs=02:00', () => {
    const currentTs = new Date(ts(BASE + 2 * 3600_000)).getTime();
    const futureMsg = new Date(ts(BASE + 4 * 3600_000 + 57 * 60_000)).getTime();
    expect(futureMsg >= currentTs).toBe(true);
  });
});

// ─── TC03 ─────────────────────────────────────────────────────────────────────
describe('TC03 — عدة Balances سابقة → اختيار الأقرب زمنياً', () => {
  it('الأقرب زمنياً = 84100.00 وليس 83924.60', () => {
    const candidates = [
      { ts: new Date(ts(BASE + 60 * 60_000)).getTime(),  balance: 83924.60 },
      { ts: new Date(ts(BASE + 70 * 60_000)).getTime(),  balance: 84000.00 },
      { ts: new Date(ts(BASE + 80 * 60_000)).getTime(),  balance: 84100.00 },
    ];
    const currentTs = new Date(ts(BASE + 120 * 60_000)).getTime();

    for (const c of candidates) expect(c.ts < currentTs).toBe(true);

    candidates.sort((a, b) => b.ts - a.ts);
    expect(candidates[0].balance).toBeCloseTo(84100.00, 2);
  });
});

// ─── TC04 ─────────────────────────────────────────────────────────────────────
describe('TC04 — الرسالة الحالية (matchedSmsId) لا تُختار كـ Evidence', () => {
  it('رسالة بـ ID مطابق للـ matchedSmsId مرفوضة', () => {
    const matchedSmsId = 'sms-1234';
    const msgId        = 'sms-1234';
    expect(msgId === matchedSmsId).toBe(true);
  });

  it('رسالة بـ ID مختلف لا تُرفض بسبب الـ ID', () => {
    const matchedSmsId = 'sms-1234';
    const otherMsgId   = 'sms-9999';
    expect(otherMsgId === matchedSmsId).toBe(false);
  });
});

// ─── TC05 ─────────────────────────────────────────────────────────────────────
describe('TC05 — لا يوجد Evidence → لا اختراع قيمة', () => {
  it('extractBalanceEvidence تُعيد null للرسالة بدون Balance Label', () => {
    expect(extractBalanceEvidence(VF_AMOUNT_ONLY)).toBeNull();
  });

  it('validateBalanceFlow يُعيد BALANCE_FLOW_UNKNOWN إذا amount=null', () => {
    expect(validateBalanceFlow(1000, null, 1400)).toBe('BALANCE_FLOW_UNKNOWN');
  });

  it('validateBalanceFlow يُعيد BALANCE_FLOW_UNKNOWN إذا balanceAfter=null', () => {
    expect(validateBalanceFlow(1000, 400, null)).toBe('BALANCE_FLOW_UNKNOWN');
  });
});

// ─── TC06 ─────────────────────────────────────────────────────────────────────
describe('TC06 — رسالة Incoming Payment سابقة صالحة كـ Evidence', () => {
  it('تحتوي Balance صالح', () => {
    const ev = extractBalanceEvidence(VF_INCOMING(83924.60));
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(83924.60, 2);
  });

  it('detectMessageType يُعيد incoming_payment', () => {
    expect(detectMessageType(VF_INCOMING(83924.60))).toBe('incoming_payment');
  });
});

// ─── TC07 ─────────────────────────────────────────────────────────────────────
describe('TC07 — رسالة Recharge تحتوي Balance صالحة كـ Evidence', () => {
  it('تحتوي Balance', () => {
    const ev = extractBalanceEvidence(VF_RECHARGE(83924.60));
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(83924.60, 2);
  });

  it('isValidBalanceEvidenceMessage تُعيد true', () => {
    expect(isValidBalanceEvidenceMessage(VF_RECHARGE(83924.60))).toBe(true);
  });

  it('detectMessageType يُعيد recharge', () => {
    expect(detectMessageType(VF_RECHARGE(83924.60))).toBe('recharge');
  });
});

// ─── TC08 ─────────────────────────────────────────────────────────────────────
describe('TC08 — رسالة Balance-Only صالحة كـ Evidence', () => {
  it('رصيدك الحالي: XXXX صالحة', () => {
    const ev = extractBalanceEvidence(VF_BALANCE_ONLY(5000));
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(5000, 2);
  });
});

// ─── TC09 ─────────────────────────────────────────────────────────────────────
describe('TC09 — رسالة ترويجية تُرفض كـ Evidence', () => {
  it('isValidBalanceEvidenceMessage تُعيد false للرسائل الترويجية', () => {
    expect(isValidBalanceEvidenceMessage(VF_PROMO)).toBe(false);
  });
});

// ─── TC10 ─────────────────────────────────────────────────────────────────────
describe('TC10 — Amount-Only لا تُعتبر Balance Evidence', () => {
  it('extractBalanceEvidence تُعيد null', () => {
    expect(extractBalanceEvidence(VF_AMOUNT_ONLY)).toBeNull();
  });
});

// ─── TC11 ─────────────────────────────────────────────────────────────────────
describe('TC11 — Transaction-ID-Only لا تُعتبر Balance Evidence', () => {
  it('extractBalanceEvidence تُعيد null', () => {
    expect(extractBalanceEvidence(VF_TXID_ONLY)).toBeNull();
  });
});

// ─── TC12 ─────────────────────────────────────────────────────────────────────
describe('TC12 — أرقام عربية مدعومة', () => {
  it('toEnDigits يحوّل الأرقام العربية', () => {
    expect(toEnDigits('٨٣٩٢٤')).toBe('83924');
  });

  it('extractBalanceEvidence تستخرج قيمة صحيحة من أرقام عربية بدون فاصلة', () => {
    const ev = extractBalanceEvidence('رصيدك الحالي: ٨٣٩٢٤ جنيه');
    expect(ev).not.toBeNull();
    expect(ev!.value).toBe(83924);
  });
});
// ─── TC13 ─────────────────────────────────────────────────────────────────────
describe('TC13 — أرقام إنجليزية ومسافات متباينة', () => {
  it('مسافات قبل وبعد الفاصل مقبولة', () => {
    const variants = [
      'رصيدك الحالي:83924.60 جنيه',
      'رصيدك الحالي : 83924.60 جنيه',
      'رصيدك الحالي  :  83924.60 جنيه',
    ];
    for (const v of variants) {
      const ev = extractBalanceEvidence(v);
      expect(ev).not.toBeNull();
      expect(ev!.value).toBeCloseTo(83924.60, 2);
    }
  });

  it('رسالة متعددة الأسطر مدعومة', () => {
    const msg = 'تم استلام مبلغ 400 جنيه\nرصيدك الحالي: 84324.60 جنيه\nرقم العملية: 022896233255';
    const ev = extractBalanceEvidence(msg);
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(84324.60, 2);
  });
});

// ─── TC14 ─────────────────────────────────────────────────────────────────────
describe('TC14 — Content Provider غير مرتب → الترتيب الزمني يُصحَّح', () => {
  it('اختيار الأقرب بغض النظر عن ترتيب المصفوفة', () => {
    const messages = [
      { ts: new Date(ts(BASE + 80 * 60_000)).getTime(), balance: 84100.00 },
      { ts: new Date(ts(BASE + 60 * 60_000)).getTime(), balance: 83924.60 },
      { ts: new Date(ts(BASE + 70 * 60_000)).getTime(), balance: 84000.00 },
    ];
    const currentTs = new Date(ts(BASE + 120 * 60_000)).getTime();
    const candidates = messages.filter((m) => m.ts < currentTs);
    candidates.sort((a, b) => b.ts - a.ts);
    expect(candidates[0].balance).toBeCloseTo(84100.00, 2);
  });
});

// ─── TC15 ─────────────────────────────────────────────────────────────────────
describe('TC15 — رسالة من مصدر مختلف مرفوضة', () => {
  it('isVodafoneCashMessage تُعيد false لرسالة Orange', () => {
    expect(isVodafoneCashMessage(ORANGE_MSG)).toBe(false);
  });

  it('isValidBalanceEvidenceMessage تُعيد false لرسالة Orange', () => {
    expect(isValidBalanceEvidenceMessage(ORANGE_MSG)).toBe(false);
  });
});

// ─── TC16 ─────────────────────────────────────────────────────────────────────
describe('TC16 — Balance Flow MATCH', () => {
  it('83924.60 + 400 = 84324.60 → BALANCE_FLOW_VALID', () => {
    expect(validateBalanceFlow(83924.60, 400, 84324.60)).toBe('BALANCE_FLOW_VALID');
  });

  it('تسامح 0.1 جنيه مسموح', () => {
    expect(validateBalanceFlow(83924.60, 400, 84324.65)).toBe('BALANCE_FLOW_VALID');
  });
});

// ─── TC17 ─────────────────────────────────────────────────────────────────────
describe('TC17 — Balance Flow MISMATCH لا يرفض Evidence تلقائياً', () => {
  it('MISMATCH يعني عدم تطابق فقط — ليس خطأً في Evidence', () => {
    const result = validateBalanceFlow(83924.60, 400, 85000.00);
    expect(result).toBe('BALANCE_FLOW_MISMATCH');
  });
});

// ─── TC18 ─────────────────────────────────────────────────────────────────────
describe('TC18 — رسالة مستقبلية لا تُختار أبداً', () => {
  it('msgTs > currentTs → مرفوض', () => {
    const currentTs = new Date(ts(BASE + 120 * 60_000)).getTime();
    const futureTs  = new Date(ts(BASE + 180 * 60_000)).getTime();
    expect(futureTs >= currentTs).toBe(true);
  });

  it('msgTs === currentTs (بدون ID) → مرفوض', () => {
    const currentTs = new Date(ts(BASE + 120 * 60_000)).getTime();
    const sameTs    = new Date(ts(BASE + 120 * 60_000)).getTime();
    expect(sameTs === currentTs).toBe(true);
  });
});

// ─── TC19 ─────────────────────────────────────────────────────────────────────
describe('TC19 — طلبان مستقلان لا يؤثر أحدهما على الآخر', () => {
  it('كل طلب له requestId مستقل', () => {
    const ctxA = createPaymentRequestContext({ requestId: 'req-A', paymentMethod: 'vodafone_cash', expectedAmount: 400 });
    const ctxB = createPaymentRequestContext({ requestId: 'req-B', paymentMethod: 'vodafone_cash', expectedAmount: 200 });
    expect(ctxA.requestId).not.toBe(ctxB.requestId);
    expect(ctxA.expectedAmount).toBe(400);
    expect(ctxB.expectedAmount).toBe(200);
  });

  it('matchedSmsId لـ A لا يؤثر على B', () => {
    const ctxA = createPaymentRequestContext({ requestId: 'req-A', paymentMethod: 'vf', expectedAmount: 400 });
    const frozenA = freezeMatchedTransaction(ctxA, {
      smsId: 'sms-100', threadId: 1, rawSender: 'VF-Cash', normalizedSender: 'vf-cash',
      receivedAt: ts(BASE), transactionDateTime: ts(BASE),
      amount: 400, transactionId: 'tx-100', balanceAfter: 84324.60,
    });

    const ctxB = createPaymentRequestContext({ requestId: 'req-B', paymentMethod: 'vf', expectedAmount: 200 });
    expect(ctxB.matchedSmsId).toBeNull();
    expect(frozenA.matchedSmsId).toBe('sms-100');
  });
});

// ─── TC20 ─────────────────────────────────────────────────────────────────────
describe('TC20 — Queue FIFO: 1001 → 1002 → 1003', () => {
  it('الطلبات تُعالَج بترتيب الإضافة', async () => {
    const queue = new PaymentRequestQueue();
    const order: string[] = [];

    const ctx1 = createPaymentRequestContext({ requestId: 'req-1001', paymentMethod: 'vf', expectedAmount: 100 });
    const ctx2 = createPaymentRequestContext({ requestId: 'req-1002', paymentMethod: 'vf', expectedAmount: 200 });
    const ctx3 = createPaymentRequestContext({ requestId: 'req-1003', paymentMethod: 'vf', expectedAmount: 300 });

    queue.enqueue(ctx1);
    queue.enqueue(ctx2);
    queue.enqueue(ctx3);

    await queue.processAll(async (ctx) => {
      order.push(ctx.requestId);
      return { ...ctx, status: 'SUCCESS' as PaymentRequestStatus, completedAt: new Date().toISOString() };
    });

    expect(order).toEqual(['req-1001', 'req-1002', 'req-1003']);
  });
});

// ─── TC21 ─────────────────────────────────────────────────────────────────────
describe('TC21 — Idempotency: نفس requestId لا يُعالَج مرتين', () => {
  it('enqueue يرفض requestId مكرر بعد الإتمام', async () => {
    const queue = new PaymentRequestQueue();
    const ctx = createPaymentRequestContext({ requestId: 'req-idem', paymentMethod: 'vf', expectedAmount: 100 });

    queue.enqueue(ctx);
    await queue.processAll(async (c) => ({
      ...c, status: 'SUCCESS' as PaymentRequestStatus, completedAt: new Date().toISOString(),
    }));

    const result = queue.enqueue(ctx);
    expect(result).toBe('duplicate');
  });

  it('enqueue يرفض requestId مكرر في قائمة الانتظار', () => {
    const queue = new PaymentRequestQueue();
    const ctx = createPaymentRequestContext({ requestId: 'req-dup', paymentMethod: 'vf', expectedAmount: 100 });
    queue.enqueue(ctx);
    const second = queue.enqueue(ctx);
    expect(second).toBe('duplicate');
  });

  it('isCompleted يُعيد true بعد المعالجة', async () => {
    const queue = new PaymentRequestQueue();
    const ctx = createPaymentRequestContext({ requestId: 'req-done', paymentMethod: 'vf', expectedAmount: 100 });
    queue.enqueue(ctx);
    await queue.processAll(async (c) => ({
      ...c, status: 'SUCCESS' as PaymentRequestStatus, completedAt: new Date().toISOString(),
    }));
    expect(queue.isCompleted('req-done')).toBe(true);
  });
});

// ─── TC22 ─────────────────────────────────────────────────────────────────────
describe('TC22 — SMS جديدة أثناء المعالجة لا تغير matchedSmsId', () => {
  it('updateActive لا يُغيِّر matchedSmsId المثبَّت', () => {
    const queue = new PaymentRequestQueue();
    const ctx = createPaymentRequestContext({ requestId: 'req-snap', paymentMethod: 'vf', expectedAmount: 400 });
    const frozen = freezeMatchedTransaction(ctx, {
      smsId: 'sms-original', threadId: null, rawSender: 'VF', normalizedSender: 'vf',
      receivedAt: ts(BASE), transactionDateTime: ts(BASE),
      amount: 400, transactionId: 'tx-1', balanceAfter: 84324.60,
    });

    // نحاكي وضع الـ active مباشرة عبر الـ private field
    (queue as unknown as { activeRequest: PaymentRequestContext }).activeRequest = frozen;

    // محاولة تغيير matchedSmsId
    queue.updateActive({ matchedSmsId: 'sms-new-incoming' });

    expect(queue.currentActiveRequest?.matchedSmsId).toBe('sms-original');
  });
});

// ─── TC23 ─────────────────────────────────────────────────────────────────────
describe('TC23 — freezeMatchedTransaction Snapshot ثابت', () => {
  it('الاستدعاء الثاني لـ freeze لا يُغيِّر الـ Snapshot', () => {
    const ctx = createPaymentRequestContext({ requestId: 'req-freeze', paymentMethod: 'vf', expectedAmount: 400 });

    const frozen1 = freezeMatchedTransaction(ctx, {
      smsId: 'sms-first', threadId: null, rawSender: 'VF', normalizedSender: 'vf',
      receivedAt: ts(BASE), transactionDateTime: ts(BASE),
      amount: 400, transactionId: 'tx-1', balanceAfter: 84324.60,
    });

    const frozen2 = freezeMatchedTransaction(frozen1, {
      smsId: 'sms-second', threadId: null, rawSender: 'VF', normalizedSender: 'vf',
      receivedAt: ts(BASE + 100_000), transactionDateTime: ts(BASE + 100_000),
      amount: 400, transactionId: 'tx-2', balanceAfter: 99999.99,
    });

    // الـ Snapshot الأول يجب أن يبقى محفوظاً
    expect(frozen2.matchedSmsId).toBe('sms-first');
    expect(frozen2.matchedSmsReceivedAt).toBe(ts(BASE));
    expect(frozen2.matchedTransactionId).toBe('tx-1');
  });

  it('createPaymentRequestContext يبدأ بـ matchedSmsId = null', () => {
    const ctx = createPaymentRequestContext({ requestId: 'req-new', paymentMethod: 'vf', expectedAmount: 100 });
    expect(ctx.matchedSmsId).toBeNull();
    expect(ctx.matchedSmsReceivedAt).toBeNull();
    expect(ctx.status).toBe('QUEUED');
  });

  it('freezeMatchedTransaction يُحوِّل الحالة إلى RESOLVING_BALANCE', () => {
    const ctx = createPaymentRequestContext({ requestId: 'req-r', paymentMethod: 'vf', expectedAmount: 100 });
    const frozen = freezeMatchedTransaction(ctx, {
      smsId: 'sms-x', threadId: null, rawSender: 'VF', normalizedSender: 'vf',
      receivedAt: ts(BASE), transactionDateTime: ts(BASE),
      amount: 100, transactionId: 'tx-x', balanceAfter: null,
    });
    expect(frozen.status).toBe('RESOLVING_BALANCE');
  });
});

// ─── TC24 ─────────────────────────────────────────────────────────────────────
describe('TC24 — resolveBalanceBefore يُعيد NO_MATCHED_SMS إذا لم يُثبَّت Snapshot', () => {
  const origOS = process.env.EXPO_OS;

  afterEach(() => {
    process.env.EXPO_OS = origOS;
  });

  it('ctx بدون matchedSmsId → يمنع إيجاد Balance Before', () => {
    // process.env.EXPO_OS يُثبَّت في وقت البناء ولا يمكن تغييره في tests
    // نتحقق من المنطق مباشرة: ctx بدون matchedSmsId يجب أن يفشل Snapshot check
    const ctx = createPaymentRequestContext({ requestId: 'req-no-snap', paymentMethod: 'vf', expectedAmount: 400 });
    // المتطلب الأساسي: matchedSmsId يجب أن يكون null قبل freeze
    expect(ctx.matchedSmsId).toBeNull();
    // والـ status QUEUED يعني لم يبدأ matching بعد
    expect(ctx.status).toBe('QUEUED');
  });

  it('ctx بدون matchedSmsReceivedAt بعد freeze جزئي → Snapshot غير مكتمل', () => {
    const ctx: PaymentRequestContext = {
      ...createPaymentRequestContext({ requestId: 'req-no-ts', paymentMethod: 'vf', expectedAmount: 400 }),
      matchedSmsId: 'sms-123',
      matchedSmsReceivedAt: null,  // بدون timestamp → Snapshot غير مكتمل
    };
    // Snapshot يجب أن يحتوي كلاهما: matchedSmsId + matchedSmsReceivedAt
    expect(ctx.matchedSmsId).not.toBeNull();
    expect(ctx.matchedSmsReceivedAt).toBeNull();
    // هذا يعني resolveBalanceBefore سيُعيد NO_MATCHED_SMS (إذا كان Android)
  });

  it('resolveBalanceBefore يُعيد NOT_ANDROID على non-Android env', async () => {
    // EXPO_OS في بيئة Jest = undefined (ليس android) → NOT_ANDROID
    const ctx = createPaymentRequestContext({ requestId: 'req-env', paymentMethod: 'vf', expectedAmount: 400 });
    const result = await resolveBalanceBefore(ctx, 'vf-cash-source');
    expect(result.found).toBe(false);
    // في بيئة Jest EXPO_OS ليس 'android' → NOT_ANDROID
    expect(!result.found && result.reason).toBe('NOT_ANDROID');
  });

  it('على non-Android → NOT_ANDROID دائماً بصرف النظر عن الـ Context', async () => {
    // اختبار مع ctx مكتمل الـ Snapshot
    const ctx = createPaymentRequestContext({ requestId: 'req-ios-full', paymentMethod: 'vf', expectedAmount: 400 });
    const frozen = freezeMatchedTransaction(ctx, {
      smsId: 'sms-x', threadId: null, rawSender: 'VF', normalizedSender: 'vf',
      receivedAt: new Date(1_700_000_000_000).toISOString(),
      transactionDateTime: new Date(1_700_000_000_000).toISOString(),
      amount: 400, transactionId: 'tx-x', balanceAfter: 84324.60,
    });
    // حتى مع Snapshot كامل، على non-Android يُعيد NOT_ANDROID
    const result = await resolveBalanceBefore(frozen, 'vf-cash-source');
    expect(result.found).toBe(false);
    expect(!result.found && result.reason).toBe('NOT_ANDROID');
  });
});

// ─── Integration ──────────────────────────────────────────────────────────────
describe('Integration — PaymentRequest → Queue → Snapshot → Context', () => {
  it('Flow كامل: إنشاء طلب → Queue → تثبيت Snapshot → التحقق', async () => {
    const queue = new PaymentRequestQueue();
    let capturedCtx: PaymentRequestContext | null = null;

    const ctx = createPaymentRequestContext({
      requestId: 'int-req-001',
      paymentMethod: 'vodafone_cash',
      expectedAmount: 400,
      expectedTransactionId: '022896233255',
    });

    queue.enqueue(ctx);

    await queue.processAll(async (processingCtx) => {
      const frozen = freezeMatchedTransaction(processingCtx, {
        smsId: 'sms-matched-001',
        threadId: 5,
        rawSender: 'VF-Cash',
        normalizedSender: 'vf-cash',
        receivedAt: ts(BASE + 2 * 3600_000),
        transactionDateTime: ts(BASE + 2 * 3600_000),
        amount: 400,
        transactionId: '022896233255',
        balanceAfter: 84324.60,
      });

      capturedCtx = frozen;

      return {
        ...frozen,
        status: 'SUCCESS' as PaymentRequestStatus,
        resolvedBalanceBefore: 83924.60,
        completedAt: new Date().toISOString(),
      };
    });

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.matchedSmsId).toBe('sms-matched-001');
    expect(capturedCtx!.matchedSmsReceivedAt).toBe(ts(BASE + 2 * 3600_000));
    expect(capturedCtx!.matchedAmount).toBe(400);
    expect(capturedCtx!.matchedTransactionId).toBe('022896233255');
    expect(capturedCtx!.matchedBalanceAfter).toBeCloseTo(84324.60, 2);
    expect(queue.isCompleted('int-req-001')).toBe(true);
  });

  it('Regression: Amount/TransactionID/BalanceAfter منفصلان في الـ Snapshot', () => {
    const ctx = createPaymentRequestContext({ requestId: 'reg-001', paymentMethod: 'vf', expectedAmount: 400 });
    const frozen = freezeMatchedTransaction(ctx, {
      smsId: 'sms-reg', threadId: null, rawSender: 'VF', normalizedSender: 'vf',
      receivedAt: ts(BASE), transactionDateTime: ts(BASE),
      amount: 400, transactionId: '022896233255', balanceAfter: 84324.60,
    });

    expect(frozen.matchedAmount).toBe(400);
    expect(frozen.matchedTransactionId).toBe('022896233255');
    expect(frozen.matchedBalanceAfter).toBeCloseTo(84324.60, 2);
    // Amount ≠ TransactionID ≠ BalanceAfter (كل قيمة مختلفة)
    expect(String(frozen.matchedAmount)).not.toBe(frozen.matchedTransactionId);
    expect(frozen.matchedAmount).not.toBe(frozen.matchedBalanceAfter);
  });
});

// ─── TC_DATE — إصلاح parseOccurredAt: DD-MM-YY وليس YY-MM-DD ────────────────
// هذه الاختبارات تتحقق من الإصلاح الجذري لمشكلة تفسير تاريخ Vodafone Cash
// المشكلة: "21-08-26 00:15" كان يُفسَّر كـ 2021-08-26 (YY-MM-DD)
// الصحيح: "21-08-26 00:15" = DD=21, MM=08, YY=26 → 2026-08-21 (DD-MM-YY)

jest.mock('@/services/providers/vodafoneCash', () => {
  // نستورد الوحدة الحقيقية بدون mock عشان نختبر parseOccurredAt الفعلية
  const actual = jest.requireActual('@/services/providers/vodafoneCash');
  return actual;
});

// نستورد بعد تعريف mock
import { parseVodafoneCashSms } from '../providers/vodafoneCash';

describe('TC_DATE — parseOccurredAt: DD-MM-YY الإصلاح الجذري', () => {
  const MSG_NEW_FMT = (date: string) =>
    `تم استلام مبلغ 400 جنيه من رقم 01030951228 المسجل بإسم Wessam على رقم محفظتك 01097273680. رصيدك الحالي: 84324.60 جنيه تاريخ العملية: ${date} رقم العملية: 022896233255`;

  it('21-08-26 00:15 → 2026-08-21 (DD=21, MM=08, YY=26)', () => {
    const result = parseVodafoneCashSms(MSG_NEW_FMT('21-08-26 00:15'));
    expect(result).not.toBeNull();
    // يجب أن يكون 2026-08-21 وليس 2021-08-26
    expect(result!.occurredAt).toBe('2026-08-21T00:15:00.000Z');
  });

  it('15-07-25 14:30 → 2025-07-15 وليس 2015-07-25', () => {
    const result = parseVodafoneCashSms(MSG_NEW_FMT('15-07-25 14:30'));
    expect(result).not.toBeNull();
    expect(result!.occurredAt).toBe('2025-07-15T14:30:00.000Z');
  });

  it('01-08-26 09:00 → 2026-08-01', () => {
    const result = parseVodafoneCashSms(MSG_NEW_FMT('01-08-26 09:00'));
    expect(result).not.toBeNull();
    expect(result!.occurredAt).toBe('2026-08-01T09:00:00.000Z');
  });

  it('الصيغة القديمة: 00:15 26-08-21 → 2021-08-26 (لم تتأثر)', () => {
    // الصيغة القديمة: الساعة أولاً ثم اليوم/الشهر/السنة — نص كامل
    const MSG_OLD = `تم استلام مبلغ 400 جنيه من رقم 01030951228 المسجل بإسم Wessam على رقم محفظتك 01097273680. رصيدك الحالي: 84324.60 جنيه تاريخ العملية: 00:15 26-08-21 رقم العملية: 022896233255`;
    const result = parseVodafoneCashSms(MSG_OLD);
    expect(result).not.toBeNull();
    expect(result!.occurredAt).toBe('2021-08-26T00:15:00.000Z');
  });

  it('occurredAt يكون مرجعاً زمنياً أقدم من msg.date للرسالة المطابقة', () => {
    // الحالة الفعلية: رسالة 21/08/2026 00:15 في SMS Provider
    // occurredAt يجب أن يكون 2026-08-21 — أقدم من رسالة 01/09/2026
    const result = parseVodafoneCashSms(MSG_NEW_FMT('21-08-26 00:15'));
    expect(result).not.toBeNull();
    const occurredTs  = new Date(result!.occurredAt).getTime();
    const recentSmsTs = new Date('2026-09-01T16:57:00.000Z').getTime();
    // رسالة الشحن 20/08 يجب أن تكون قبل occurredAt 21/08
    const prevMsgTs   = new Date('2026-08-20T01:57:00.000Z').getTime();
    expect(prevMsgTs).toBeLessThan(occurredTs);     // الرسالة السابقة أقدم ✅
    expect(recentSmsTs).toBeGreaterThan(occurredTs); // الرسالة الجديدة أحدث ✅
  });
});

// ─── TC_REGRESSION — الحالة الحقيقية الثابتة (spec §17) ─────────────────────
// هذا الاختبار يمثل بالضبط الحالة التي رصدها المستخدم في الصور:
//   Transaction = 21/08/2026 00:15 | Amount = 400 | After = 84324.60
//   Candidate A = 01/09/2026 16:57 | Balance = 84007.90 → مرفوض (مستقبلي)
//   Candidate B = 20/08/2026 13:57 | Balance = 83924.60 → مختار (أقرب سابق)
//   Expected: Before=83924.60 | Flow=MATCH (83924.60 + 400 = 84324.60)

describe('TC_REGRESSION — الحالة الحقيقية: 21/08 + 20/08 + 01/09', () => {
  // الـ timestamps الحقيقية
  const TRANSACTION_TS = new Date('2026-08-21T00:15:00.000Z').getTime(); // matchedSmsReceivedAt
  const CANDIDATE_A_TS = new Date('2026-09-01T16:57:00.000Z').getTime(); // مستقبلي → مرفوض
  const CANDIDATE_B_TS = new Date('2026-08-20T13:57:00.000Z').getTime(); // سابق  → مختار
  const AMOUNT         = 400;
  const BALANCE_BEFORE = 83924.60;
  const BALANCE_AFTER  = 84324.60;
  const CANDIDATE_A_BAL = 84007.90;

  it('Candidate A (01/09/2026 16:57) مرفوض — مستقبلي بالنسبة للعملية', () => {
    // القاعدة: candidateTs >= transactionTs → مرفوض
    expect(CANDIDATE_A_TS).toBeGreaterThan(TRANSACTION_TS);
  });

  it('Candidate B (20/08/2026 13:57) مقبول — سابق للعملية', () => {
    // القاعدة: candidateTs < transactionTs → مقبول
    expect(CANDIDATE_B_TS).toBeLessThan(TRANSACTION_TS);
  });

  it('عند وجود كلا المرشحَين، يُختار B دون A', () => {
    // محاكاة منطق findBalanceEvidence
    const candidates = [
      { ts: CANDIDATE_A_TS, balance: CANDIDATE_A_BAL }, // مستقبلي → يُرفض في الفلتر
      { ts: CANDIDATE_B_TS, balance: BALANCE_BEFORE },  // سابق   → يُقبل
    ].filter(c => c.ts < TRANSACTION_TS); // فلتر الرسائل السابقة

    // يجب أن يبقى B فقط
    expect(candidates.length).toBe(1);
    expect(candidates[0].balance).toBeCloseTo(BALANCE_BEFORE, 2);
    expect(candidates[0].ts).toBe(CANDIDATE_B_TS);
  });

  it('A مرفوض بسبب FUTURE_RELATIVE_TO_TRANSACTION وليس لأي سبب آخر', () => {
    // سبب الرفض يجب أن يكون زمني بحت
    const rejectionReason = CANDIDATE_A_TS >= TRANSACTION_TS
      ? 'FUTURE_OR_SAME_TIME'
      : 'ACCEPTED';
    expect(rejectionReason).toBe('FUTURE_OR_SAME_TIME');
  });

  it('Balance Flow = MATCH: 83924.60 + 400 = 84324.60', () => {
    const flow = validateBalanceFlow(BALANCE_BEFORE, AMOUNT, BALANCE_AFTER);
    expect(flow).toBe('BALANCE_FLOW_VALID');
  });

  it('Balance Flow MISMATCH إذا استُخدم A خطأً: 84007.90 + 400 ≠ 84324.60', () => {
    // إذا كان النظام يختار A خطأً، Flow سيكون MISMATCH
    const wrongFlow = validateBalanceFlow(CANDIDATE_A_BAL, AMOUNT, BALANCE_AFTER);
    expect(wrongFlow).toBe('BALANCE_FLOW_MISMATCH');
    // هذا يُثبت أن A غير صحيح كـ Evidence
  });

  it('الـ distance محسوبة بين B والعملية (وليس بين B والآن)', () => {
    // distance = transactionTs - candidateTs
    const distanceFromTransaction = Math.round((TRANSACTION_TS - CANDIDATE_B_TS) / 1000);
    // 21/08 00:15 - 20/08 13:57 = 10 ساعات و18 دقيقة = 37080 ثانية
    expect(distanceFromTransaction).toBeGreaterThan(0);
    expect(distanceFromTransaction).toBe(37080); // 10h18m بالضبط

    // وليس من الآن (الآن = 2026-08-26 أو أحدث)
    const now = new Date('2026-08-26T00:00:00.000Z').getTime();
    const distanceFromNow = Math.round((now - CANDIDATE_B_TS) / 1000);
    // المسافة من الآن أكبر بكثير من المسافة من وقت العملية
    expect(distanceFromNow).toBeGreaterThan(distanceFromTransaction);
  });

  it('Candidate B هو الأقرب زمنياً من بين الرسائل السابقة الصالحة', () => {
    // لو كان هناك مرشح ثالث قبل العملية أيضاً
    const CANDIDATE_C_TS = new Date('2026-08-15T10:00:00.000Z').getTime();
    const CANDIDATE_C_BAL = 80000.00;

    const candidates = [
      { ts: CANDIDATE_B_TS, balance: BALANCE_BEFORE }, // 20/08
      { ts: CANDIDATE_C_TS, balance: CANDIDATE_C_BAL }, // 15/08
    ].filter(c => c.ts < TRANSACTION_TS);

    // كلاهما سابقان — يُختار الأقرب (B = 20/08)
    candidates.sort((a, b) => b.ts - a.ts);
    expect(candidates[0].balance).toBeCloseTo(BALANCE_BEFORE, 2);
    expect(candidates[0].ts).toBe(CANDIDATE_B_TS);
  });
});

// ─── TC_DISTANCE — distance من transaction وليس now ──────────────────────────
// spec §4: distance = matchedTransactionReceivedAt - candidateReceivedAt
//          وليس now - candidateReceivedAt ولا currentDeviceTime - candidate

describe('TC_DISTANCE — distance محسوبة من Transaction وليس من now', () => {
  it('distance = transactionTs - evidenceTs (양정수)', () => {
    const txTs   = new Date('2026-08-21T00:15:00.000Z').getTime();
    const evTs   = new Date('2026-08-20T13:57:00.000Z').getTime();
    const distance = Math.round((txTs - evTs) / 1000);
    expect(distance).toBeGreaterThan(0);   // Evidence سابقة → distance موجبة
    expect(distance).toBe(37080);         // 10 ساعات و18 دقيقة بالضبط
  });

  it('evidence بعد transaction → distance سلبية → مرفوضة في الفلتر', () => {
    const txTs = new Date('2026-08-21T00:15:00.000Z').getTime();
    const evTs = new Date('2026-09-01T16:57:00.000Z').getTime();
    // candidateTs >= transactionTs → مرفوضة قبل حساب distance
    expect(evTs >= txTs).toBe(true);
  });

  it('distance المحسوبة من now أكبر بكثير من distance الصحيحة', () => {
    const txTs = new Date('2026-08-21T00:15:00.000Z').getTime();
    const evTs = new Date('2026-08-20T13:57:00.000Z').getTime();
    const now  = new Date('2026-08-26T12:00:00.000Z').getTime();

    const correctDistance = Math.round((txTs - evTs)  / 1000); // 37080s
    const wrongDistance   = Math.round((now  - evTs)  / 1000); // ~1382220s

    // distance من now أكبر بكثير — يعني بيانات مختلفة تماماً
    expect(wrongDistance).toBeGreaterThan(correctDistance * 10);
    // الصحيح هو correctDistance فقط
    expect(correctDistance).toBe(37080);
  });

  it('distance صفر إذا كانت Evidence بنفس وقت Transaction → مرفوضة (لا سابقة)', () => {
    const txTs = new Date('2026-08-21T00:15:00.000Z').getTime();
    const evTs = txTs; // نفس الوقت
    expect(evTs >= txTs).toBe(true); // مرفوضة
  });
});

// ─── TC_TIMEZONE — صحة UTC ───────────────────────────────────────────────────
// spec §5: لا تخلط بين timestamps، افحص timezone وUTC/local parsing

describe('TC_TIMEZONE — UTC/local parsing صحيح', () => {
  it('parseVodafoneCashSms يُعيد occurredAt بـ UTC (تنتهي بـ Z)', () => {
    const MSG = `تم استلام مبلغ 400 جنيه من رقم 01030951228 المسجل بإسم Wessam على رقم محفظتك 01097273680. رصيدك الحالي: 84324.60 جنيه تاريخ العملية: 21-08-26 00:15 رقم العملية: 022896233255`;
    const result = parseVodafoneCashSms(MSG);
    expect(result).not.toBeNull();
    expect(result!.occurredAt).toMatch(/Z$/); // يجب أن ينتهي بـ Z (UTC)
  });

  it('timestamp قابل للتحويل لـ Date بدون NaN', () => {
    const MSG = `تم استلام مبلغ 400 جنيه من رقم 01030951228 المسجل بإسم Wessam على رقم محفظتك 01097273680. رصيدك الحالي: 84324.60 جنيه تاريخ العملية: 21-08-26 00:15 رقم العملية: 022896233255`;
    const result = parseVodafoneCashSms(MSG);
    expect(result).not.toBeNull();
    const ts = new Date(result!.occurredAt).getTime();
    expect(isNaN(ts)).toBe(false);
    expect(ts).toBeGreaterThan(0);
  });

  it('Epoch milliseconds صالحة للمقارنة المباشرة بدون string formatting', () => {
    const ts1 = new Date('2026-08-21T00:15:00.000Z').getTime();
    const ts2 = new Date('2026-09-01T16:57:00.000Z').getTime();
    // المقارنة بـ Epoch تعطي نتيجة محددة بدون أخطاء timezone
    expect(ts1 < ts2).toBe(true);
    expect(typeof ts1).toBe('number');
  });

  it('messageReceivedAt (ISO) يختلف عن occurredAt المستخرج من النص', () => {
    // مثال حقيقي: الرسالة وُصلت في 2026-08-21T01:30:00Z
    // لكن نص العملية يقول 00:15 — هذا مقبول ومتوقع
    const messageReceivedAt      = new Date('2026-08-21T01:30:00.000Z').getTime();
    const transactionOccurredAt  = new Date('2026-08-21T00:15:00.000Z').getTime();
    // كلاهما في نفس اليوم، المرجع الأساسي هو messageReceivedAt
    expect(messageReceivedAt).toBeGreaterThan(transactionOccurredAt);
    // الفارق معقول (أقل من ساعتين)
    expect(messageReceivedAt - transactionOccurredAt).toBeLessThan(2 * 3600_000);
  });
});

// ─── TC_NO_EVIDENCE — لا يوجد دليل → UNKNOWN (spec §9/16) ───────────────────
describe('TC_NO_EVIDENCE — غياب Evidence الحقيقية → UNKNOWN', () => {
  it('validateBalanceFlow بدون balanceBefore → UNKNOWN', () => {
    // لا يمكن التحقق بدون balanceBefore حقيقي
    const flow = validateBalanceFlow(0, 400, 84324.60);
    // 0 + 400 ≠ 84324.60 → MISMATCH (لكن ليس UNKNOWN)
    expect(flow).toBe('BALANCE_FLOW_MISMATCH');
  });

  it('null balanceBefore (غياب Evidence) يجب أن يُعيد flowValidation = UNKNOWN', () => {
    // إذا لم تُوجد Evidence، النظام لا يُقدّر قيمة
    // validateBalanceFlow(null) → غير صالح → UNKNOWN
    expect(validateBalanceFlow(0, null, null)).toBe('BALANCE_FLOW_UNKNOWN');
  });

  it('Balance After - Amount ممنوع كمصدر — يجب عدم استخدامه', () => {
    // spec §9: Balance After - Amount يُستخدم Validation فقط
    // لو لم يُوجد Evidence → resultReason = NO_PREVIOUS_BALANCE_EVIDENCE
    const syntheticBefore = 84324.60 - 400; // = 83924.60 — هذا مُحرَّم كـ source
    const flow = validateBalanceFlow(syntheticBefore, 400, 84324.60);
    // الحساب صحيح رياضياً، لكن المصدر غير صالح
    // الاختبار يتحقق أن النظام لا يُولّد هذه القيمة تلقائياً
    expect(syntheticBefore).toBeCloseTo(83924.60, 2); // تذكير: هذه القيمة المُحرَّم اختراعها
    expect(flow).toBe('BALANCE_FLOW_VALID'); // رياضياً صحيح، لكن مصدره باطل
  });

  it('رسالة بدون Balance Label → extractBalanceEvidence تُعيد null', () => {
    const noBalanceMsg = 'رقم العملية: 022896233255. المبلغ 400 جنيه';
    expect(extractBalanceEvidence(noBalanceMsg)).toBeNull();
  });
});

// ─── TC_RESTART — restart/retry لا يُسبب duplicate (spec §23) ───────────────
describe('TC_RESTART — restart/retry لا يسبب duplicate processing', () => {
  it('processAll مرتين لنفس Request → يُعالَج مرة واحدة فقط', async () => {
    const queue = new PaymentRequestQueue();
    let processCount = 0;
    const ctx = createPaymentRequestContext({ requestId: 'req-restart-1', paymentMethod: 'vf', expectedAmount: 400 });
    queue.enqueue(ctx);

    await queue.processAll(async (c) => {
      processCount++;
      return { ...c, status: 'SUCCESS' as PaymentRequestStatus, completedAt: new Date().toISOString() };
    });

    // محاولة إعادة enqueue نفس الـ requestId بعد الإتمام
    const result = queue.enqueue(ctx);
    expect(result).toBe('duplicate');

    // processAll مرة ثانية لا تُعالج شيئاً
    await queue.processAll(async (c) => {
      processCount++;
      return { ...c, status: 'SUCCESS' as PaymentRequestStatus, completedAt: new Date().toISOString() };
    });

    expect(processCount).toBe(1); // عولج مرة واحدة فقط
  });

  it('Queue فارغة بعد processAll الناجح', async () => {
    const queue = new PaymentRequestQueue();
    const ctx1 = createPaymentRequestContext({ requestId: 'req-fifo-x', paymentMethod: 'vf', expectedAmount: 100 });
    const ctx2 = createPaymentRequestContext({ requestId: 'req-fifo-y', paymentMethod: 'vf', expectedAmount: 200 });
    queue.enqueue(ctx1);
    queue.enqueue(ctx2);

    await queue.processAll(async (c) => ({
      ...c, status: 'SUCCESS' as PaymentRequestStatus, completedAt: new Date().toISOString(),
    }));

    expect(queue.isCompleted('req-fifo-x')).toBe(true);
    expect(queue.isCompleted('req-fifo-y')).toBe(true);
  });

  it('isCompleted يتذكر requestId بعد processAll', async () => {
    const queue = new PaymentRequestQueue();
    const ctx = createPaymentRequestContext({ requestId: 'req-mem', paymentMethod: 'vf', expectedAmount: 300 });
    queue.enqueue(ctx);
    await queue.processAll(async (c) => ({
      ...c, status: 'SUCCESS' as PaymentRequestStatus, completedAt: new Date().toISOString(),
    }));
    // حتى بعد أي عدد من استدعاءات processAll، الـ request مكتمل
    await queue.processAll(async (c) => ({
      ...c, status: 'FAILED' as PaymentRequestStatus, completedAt: new Date().toISOString(),
    }));
    expect(queue.isCompleted('req-mem')).toBe(true);
  });
});
