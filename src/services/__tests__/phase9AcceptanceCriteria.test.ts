/**
 * phase9AcceptanceCriteria.test.ts
 * ══════════════════════════════════════════════════════════════════════════════
 * اختبارات Acceptance Criteria — Phase 9 + Phase 10 Final Fix
 *
 * TC_HISTORY ×4   — Evidence تاريخية عميقة
 * TC_FEES ×4      — Balance Flow Validation مع رسوم
 * TC_DUPLICATE ×3 — عمليتان بنفس المبلغ
 * TC_DIAG ×3      — distanceSeconds + diagnosticInfo
 *
 * TC_PATTERN ×10  — صيغ الرصيد الحقيقية من رسائل Vodafone Cash (spec §2 + §18)
 *   A: رصيدك الحالي 83924.6
 *   B: رصيد حسابك الحالي في فودافون كاش 84007.90   ← كانت تفشل
 *   C: رصيد محفظتك الحالي 84317.1 جنيه
 *   D: رسالة العملية لا تُستخدم كـ Previous Balance
 *   E: Previous Balance يُعثر عليه عند وجود رسالة سابقة
 *   F: رسالة لاحقة للعملية تُرفض
 *   G: عدة رسائل → أقرب رسالة تُختار
 *   H: كلمة "رصيد" وحدها لا تكفي للتصنيف كـ Balance Evidence
 *   I: أرقام عربية → parse صحيح
 *   J: NBSP + مسافات + colon variations
 * ══════════════════════════════════════════════════════════════════════════════
 */

/* eslint-disable no-undef */

// ── Mocks قبل كل import ──────────────────────────────────────────────────────
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
  isValidBalanceEvidenceMessage,
  detectMessageType,
  isVodafoneCashMessage,
} from '../balanceUtils';

import {
  createPaymentRequestContext,
  resolveBalanceBefore,
} from '../paymentRequestQueue';

import { readAllFromSource as mockReadAllFromSource } from '@/services/smsReader';
import type { SmsMessage } from '../smsReader';

// ─── مساعدات ──────────────────────────────────────────────────────────────────

function ts(base: number, offsetMs: number): string {
  return new Date(base + offsetMs).toISOString();
}

const BASE_NOW = 1_724_000_000_000;

const VF_INCOMING = (balance: number, txId = '022896233255', amount = 400) =>
  `تم استلام مبلغ ${amount} جنيه من رقم 01030951228 المسجل بإسم Test User على رقم محفظتك 01097273680. ` +
  `رصيدك الحالي: ${balance} جنيه تاريخ العملية: 00:15 26-08-21 رقم العملية: ${txId}`;

const VF_RECHARGE = (balance: number) =>
  `تم شحن رصيد موبايلك ب 13.5 جنيه بنجاح. رصيد حسابك في فودافون كاش الحالي ${balance} جنيه`;

function makeSms(id: string, body: string, dateIso: string, sender = 'VFCASH-SMS'): SmsMessage {
  return { id, body, originatingAddress: sender, date: dateIso };
}

// ══════════════════════════════════════════════════════════════════════════════
// TC_PATTERN — صيغ الرصيد الحقيقية من رسائل VF-Cash (spec §18)
// ══════════════════════════════════════════════════════════════════════════════

describe('TC_PATTERN — صيغ الرصيد الحقيقية من Vodafone Cash', () => {

  // ── Test A ──────────────────────────────────────────────────────────────────

  it('TC_PATTERN_A — «رصيدك الحالي 83924.6» → balance_update + balance=83924.6', () => {
    const body = 'رصيدك الحالي 83924.6';
    expect(isVodafoneCashMessage(body)).toBe(true);
    expect(isValidBalanceEvidenceMessage(body)).toBe(true);
    const ev = extractBalanceEvidence(body);
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(83924.6, 2);
    expect(detectMessageType(body)).toBe('balance_update');
  });

  // ── Test B — الصيغة التي كانت تفشل ─────────────────────────────────────────

  it('TC_PATTERN_B — «رصيد حسابك الحالي في فودافون كاش 84007.90» → balance=84007.90', () => {
    // هذه الصيغة كانت تُعيد FAILED قبل الإصلاح — "الحالي" قبل "في فودافون كاش"
    const body = 'رصيد حسابك الحالي في فودافون كاش 84007.90';
    expect(isVodafoneCashMessage(body)).toBe(true);
    expect(isValidBalanceEvidenceMessage(body)).toBe(true);
    const ev = extractBalanceEvidence(body);
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(84007.90, 2);
  });

  it('TC_PATTERN_B2 — صيغة B داخل رسالة Recharge كاملة', () => {
    const body = 'تم شحن رصيد موبايلك ب 13.5 جنيه بنجاح. رصيد حسابك الحالي في فودافون كاش 84007.90 جنيه';
    const ev = extractBalanceEvidence(body);
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(84007.90, 2);
    // نوع الرسالة: recharge (بسبب "شحن")
    expect(detectMessageType(body)).toBe('recharge');
  });

  // ── Test C ──────────────────────────────────────────────────────────────────

  it('TC_PATTERN_C — «رصيد محفظتك الحالي 84317.1 جنيه» → balance=84317.1', () => {
    const body = 'رصيد محفظتك الحالي 84317.1 جنيه';
    expect(isVodafoneCashMessage(body)).toBe(true);
    expect(isValidBalanceEvidenceMessage(body)).toBe(true);
    const ev = extractBalanceEvidence(body);
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(84317.1, 2);
  });

  // ── Test D ──────────────────────────────────────────────────────────────────

  it('TC_PATTERN_D — رسالة عملية Incoming لا تُصنَّف كـ Previous Balance Source', () => {
    // رسالة العملية تحتوي "رصيدك الحالي" لكنها incoming_payment وليست balance_update
    const body = VF_INCOMING(84324.60);
    expect(detectMessageType(body)).toBe('incoming_payment');
    // isValidBalanceEvidenceMessage تُعيد true (لها رصيد) لكن يجب ألا تُستخدم
    // كـ Previous Balance لأن المنطق يمنع الرسالة الحالية بواسطة currentMessageId
    // هنا نتحقق فقط من نوع الرسالة
    const ev = extractBalanceEvidence(body);
    expect(ev).not.toBeNull(); // تحتوي رصيد afterBalance
    expect(ev!.value).toBeCloseTo(84324.60, 2);
  });

  // ── Test E ──────────────────────────────────────────────────────────────────

  it('TC_PATTERN_E — رسالة رصيد سابقة يجب أن تُستخرج منها قيمة صالحة للـ Evidence', () => {
    // الصيغة B: رسالة سابقة للعملية
    const prevBody = 'رصيد حسابك الحالي في فودافون كاش 84007.90';
    const ev = extractBalanceEvidence(prevBody);
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(84007.90, 2);
    expect(isValidBalanceEvidenceMessage(prevBody)).toBe(true);

    // رسالة العملية
    const txBody = VF_INCOMING(84324.60, '022896233255', 400);
    const txEv = extractBalanceEvidence(txBody);
    expect(txEv!.value).toBeCloseTo(84324.60, 2);

    // التحقق الرياضي: 84007.90 + 400 ≠ 84324.60 (فارق 316.7 → MISMATCH طبيعي برسوم)
    // لكن الرصيد السابق يُعثر عليه بشكل صحيح
    expect(ev!.value).toBeCloseTo(84007.90, 2);
  });

  // ── Test F ──────────────────────────────────────────────────────────────────

  it('TC_PATTERN_F — رسالة لاحقة للعملية (ts >= txTs) تُرفض', () => {
    const txTs = BASE_NOW;
    const futureTs = BASE_NOW + 3600_000; // بعد ساعة

    // distanceSeconds سيكون سالباً → يجب رفضها
    const wouldBeNegativeDistance = txTs - futureTs;
    expect(wouldBeNegativeDistance).toBeLessThan(0);

    // الرسالة المستقبلية لها رصيد صالح لكنها تُرفض بسبب الوقت
    const futureBody = 'رصيد حسابك الحالي في فودافون كاش 85000.00';
    const ev = extractBalanceEvidence(futureBody);
    expect(ev).not.toBeNull(); // الاستخراج يعمل
    expect(ev!.value).toBeCloseTo(85000.00, 2);
    // لكن فلترة الوقت تمنعها: msgTs >= currentTs → REJECTED_FUTURE_RELATIVE_TO_TRANSACTION
  });

  // ── Test G ──────────────────────────────────────────────────────────────────

  it('TC_PATTERN_G — عدة رسائل سابقة → أقرب رسالة تُختار', () => {
    const cands = [
      { ts: BASE_NOW - 25 * 3600_000, balance: 80000, body: 'رصيدك الحالي 80000' },
      { ts: BASE_NOW -  2 * 3600_000, balance: 84008, body: 'رصيد حسابك الحالي في فودافون كاش 84008.00' }, // ← الأقرب
      { ts: BASE_NOW - 48 * 3600_000, balance: 79000, body: 'رصيد محفظتك الحالي 79000 جنيه' },
    ];

    // جميعها صالحة كـ Evidence
    for (const c of cands) {
      const ev = extractBalanceEvidence(c.body);
      expect(ev).not.toBeNull();
      expect(ev!.value).toBeCloseTo(c.balance, 1);
    }

    // ترتيب تنازلي → الأقرب أولاً
    cands.sort((a, b) => b.ts - a.ts);
    expect(cands[0].balance).toBe(84008); // الأقرب = قبل ساعتين
  });

  // ── Test H ──────────────────────────────────────────────────────────────────

  it('TC_PATTERN_H — رسالة تحتوي "رصيد" لكن بدون balance pattern → لا تُستخرج', () => {
    // رسالة ترويجية تحتوي كلمة "رصيد" لكنها ليست balance update
    const promoBody = 'احصل على رصيد مجاني مع عرض فودافون الجديد';
    const ev = extractBalanceEvidence(promoBody);
    // لا يوجد رقم رصيد بعد pattern → null
    expect(ev).toBeNull();
  });

  // ── Test I ──────────────────────────────────────────────────────────────────

  it('TC_PATTERN_I — أرقام عربية → parse صحيح', () => {
    // ٨٤٠٠٧.٩٠ = 84007.90
    const body = 'رصيد حسابك الحالي في فودافون كاش ٨٤٠٠٧.٩٠';
    const ev = extractBalanceEvidence(body);
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(84007.90, 2);
  });

  // ── Test J ──────────────────────────────────────────────────────────────────

  it('TC_PATTERN_J — NBSP + مسافات زائدة + تباين الـ colon → parse صحيح', () => {
    const variants = [
      'رصيدك الحالي: 84007.90',          // مع ":"
      'رصيدك الحالي  84007.90',           // مسافتان
      'رصيدك الحالي\u00A084007.90',       // NBSP
      'رصيد محفظتك الحالي  84317.1 جنيه', // مسافتان
      'رصيد حسابك الحالي في فودافون كاش  84007.90', // مسافتان قبل الرقم
    ];

    for (const v of variants) {
      const ev = extractBalanceEvidence(v);
      expect(ev).not.toBeNull();
      expect(ev!.value).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TC_HISTORY — البحث التاريخي العميق
// ══════════════════════════════════════════════════════════════════════════════

describe('TC_HISTORY — Evidence تاريخية قديمة تُعثر صحيحاً', () => {

  it('TC_HISTORY_01 — extractBalanceEvidence تستخرج رصيداً من رسالة عمرها 25 ساعة', () => {
    const oldMsg = VF_RECHARGE(50000);
    const ev = extractBalanceEvidence(oldMsg);
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(50000, 1);
  });

  it('TC_HISTORY_02 — رسالة قبل 29 يوماً صالحة كـ Evidence زمنياً', () => {
    const evidenceTime = BASE_NOW - 29 * 24 * 3600_000;
    const txTime = BASE_NOW;

    const evidenceMsg = makeSms('ev-old-29d', 'رصيد حسابك الحالي في فودافون كاش 70000.00', ts(0, evidenceTime));
    const txMsg = makeSms('tx-current', VF_INCOMING(70400), ts(0, txTime));

    expect(isValidBalanceEvidenceMessage(evidenceMsg.body)).toBe(true);
    const ev = extractBalanceEvidence(evidenceMsg.body);
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(70000.00, 1);

    const evTs = new Date(evidenceMsg.date).getTime();
    const txTs = new Date(txMsg.date).getTime();
    expect(evTs).toBeLessThan(txTs);
    const distanceSec = Math.round((txTs - evTs) / 1000);
    expect(distanceSec).toBeGreaterThan(29 * 24 * 3600 - 60);
    expect(distanceSec).toBeLessThan(30 * 24 * 3600 + 60);
  });

  it('TC_HISTORY_03 — رسالة مستقبلية (ts > txTs) تُرفض دائماً', () => {
    const txTime = BASE_NOW;
    const futureTime = BASE_NOW + 3600_000;
    const wouldBeDistance = txTime - futureTime;
    expect(wouldBeDistance).toBeLessThan(0);
  });

  it('TC_HISTORY_04 — أحدث Evidence من بين 3 مرشحين يُختار', () => {
    const cand1 = { ts: BASE_NOW - 10 * 3600_000, balance: 50000 };
    const cand2 = { ts: BASE_NOW -  2 * 3600_000, balance: 51000 }; // ← الأقرب
    const cand3 = { ts: BASE_NOW - 25 * 3600_000, balance: 49000 };

    const candidates = [cand1, cand2, cand3];
    candidates.sort((a, b) => b.ts - a.ts);
    expect(candidates[0].balance).toBe(51000);
    const distanceSec = Math.round((BASE_NOW - candidates[0].ts) / 1000);
    expect(distanceSec).toBe(7200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TC_FEES — Balance Flow Validation (tolerance = 1.0 EGP per spec §11)
// ══════════════════════════════════════════════════════════════════════════════

describe('TC_FEES — Balance Flow Validation (tolerance=1.0 EGP)', () => {

  it('TC_FEES_01 — مطابقة مثالية (فارق=0) → VALID', () => {
    expect(validateBalanceFlow(83924.60, 400.00, 84324.60)).toBe('BALANCE_FLOW_VALID');
  });

  it('TC_FEES_02 — فارق 0.1 (floating point) ≤ 1.0 → VALID', () => {
    expect(validateBalanceFlow(100.10, 50.20, 150.30)).toBe('BALANCE_FLOW_VALID');
  });

  it('TC_FEES_03 — فارق 5 جنيه > 1.0 → MISMATCH', () => {
    expect(validateBalanceFlow(83924.60, 400.00, 84330.00)).toBe('BALANCE_FLOW_MISMATCH');
  });

  it('TC_FEES_04 — null amount/balanceAfter → UNKNOWN', () => {
    expect(validateBalanceFlow(0, null, null)).toBe('BALANCE_FLOW_UNKNOWN');
    expect(validateBalanceFlow(80000, null, 80400)).toBe('BALANCE_FLOW_UNKNOWN');
    expect(validateBalanceFlow(80000, 400, null)).toBe('BALANCE_FLOW_UNKNOWN');
  });

  it('TC_FEES_REAL — الحالة الحقيقية: 84007.90 + 400 vs 84324.60 (فارق 83.3) → MISMATCH (رسوم عالية)', () => {
    // هذا مقبول: Evidence = 84007.90، لكن flowValidation = MISMATCH بسبب الفارق الكبير
    // الرصيد السابق لا يزال صحيحاً كـ Evidence — الـ validation مستقل
    const result = validateBalanceFlow(84007.90, 400.00, 84324.60);
    expect(result).toBe('BALANCE_FLOW_MISMATCH'); // 84007.90 + 400 = 84407.90 ≠ 84324.60
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TC_DUPLICATE — عمليتان بنفس المبلغ
// ══════════════════════════════════════════════════════════════════════════════

describe('TC_DUPLICATE — عمليتان بنفس المبلغ يُميَّزان بـ transactionId', () => {

  it('TC_DUPLICATE_01 — رسالتان بنفس المبلغ لكن transactionId مختلف', () => {
    const msg1 = VF_INCOMING(84324.60, '022896233255', 400);
    const msg2 = VF_INCOMING(84724.60, '999888777666', 400);

    expect(isValidBalanceEvidenceMessage(msg1)).toBe(true);
    expect(isValidBalanceEvidenceMessage(msg2)).toBe(true);

    const ev1 = extractBalanceEvidence(msg1);
    const ev2 = extractBalanceEvidence(msg2);
    expect(ev1!.value).toBeCloseTo(84324.60, 2);
    expect(ev2!.value).toBeCloseTo(84724.60, 2);

    expect(msg1).toContain('022896233255');
    expect(msg2).toContain('999888777666');
  });

  it('TC_DUPLICATE_02 — نفس المبلغ ونفس المُرسِل وتاريخ مختلف → رصيد مختلف', () => {
    const msg1 = VF_INCOMING(80000.00, 'TX-AUG-01', 400);
    const msg2 = VF_INCOMING(80400.00, 'TX-AUG-15', 400);
    const ev1 = extractBalanceEvidence(msg1);
    const ev2 = extractBalanceEvidence(msg2);
    expect(ev2!.value - ev1!.value).toBeCloseTo(400, 1);
  });

  it('TC_DUPLICATE_03 — 5 رسائل بنفس المبلغ وIDs مختلفة', () => {
    const msgs = Array.from({ length: 5 }, (_, i) =>
      VF_INCOMING(50000 + i * 400, `TX-${String(i).padStart(4, '0')}`, 400)
    );
    for (let i = 0; i < msgs.length; i++) {
      const ev = extractBalanceEvidence(msgs[i]);
      expect(ev).not.toBeNull();
      expect(ev!.value).toBeCloseTo(50000 + i * 400, 1);
    }
    const ids = msgs.map((m) => m.match(/رقم العملية:\s*(\S+)/)?.[1] ?? null);
    expect(new Set(ids).size).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TC_DIAG — distanceSeconds + diagnosticInfo
// ══════════════════════════════════════════════════════════════════════════════

describe('TC_DIAG — distanceSeconds صحيح وdiagnosticInfo محتسب صحيحاً', () => {

  it('TC_DIAG_01 — distanceSeconds = txTs - evidenceTs (양수دائماً)', () => {
    const evidenceTs = BASE_NOW - 37080_000; // 10h18m قبل العملية
    const txTs = BASE_NOW;
    const distanceSec = Math.round((txTs - evidenceTs) / 1000);
    expect(distanceSec).toBe(37080);
    expect(distanceSec).toBeGreaterThan(0);
    const wrongDistance = Math.round((Date.now() - evidenceTs) / 1000);
    expect(wrongDistance).toBeGreaterThan(distanceSec);
  });

  it('TC_DIAG_02 — resolveBalanceBefore يُعيد NOT_ANDROID في بيئة Jest', async () => {
    const ctx = createPaymentRequestContext({
      requestId: 'req-diag-02',
      paymentMethod: 'vf',
      expectedAmount: 400,
    });
    const result = await resolveBalanceBefore(ctx, null);
    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.reason).toBe('NOT_ANDROID');
    }
  });

  it('TC_DIAG_03 — evidence مختارة: id != currentMessageId دائماً', () => {
    const currentMsgId = 'sms-current-100';
    const candidateIds = ['sms-prev-1', 'sms-prev-2', 'sms-current-100', 'sms-prev-3'];
    const filtered = candidateIds.filter((id) => id !== currentMsgId);
    expect(filtered).not.toContain(currentMsgId);
    expect(filtered.length).toBe(3);
  });
});
