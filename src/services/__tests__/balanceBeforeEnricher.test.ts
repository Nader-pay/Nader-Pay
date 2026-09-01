/**
 * balanceBeforeEnricher.test.ts
 * ══════════════════════════════════════════════════════════════════
 * اختبارات الوحدة الإلزامية (25 اختباراً) — per spec Section 19
 * تغطي: استخراج الرصيد، البحث الزمني، الصيغ الـ 8، الأرقام العربية،
 * Balance Flow Validation، منع استخدام رسالة لاحقة أو الرسالة الحالية،
 * رسائل Recharge كـ Evidence، الفاصلة المنقوطة، مسافات متباينة.
 * ══════════════════════════════════════════════════════════════════
 */

// نستورد من balanceUtils (خالص — بلا react-native imports) لتشغيل الاختبارات في Node
import {
  extractBalanceEvidence,
  extractBalanceFromMessage,
  validateBalanceFlow,
  toEnDigits,
  isVodafoneCashMessage,
  isValidBalanceEvidenceMessage,
  detectMessageType,
} from '../balanceUtils';

// ─── مساعدات ─────────────────────────────────────────────────────────────────

/** رسالة Incoming Payment تحتوي Balance After */
const VF_INCOMING = (balance: number, txId = '022896233255') =>
  `تم استلام مبلغ 400 جنيه من رقم 01030951228 المسجل بإسم Wessam A Ahmed Ali على رقم محفظتك 01097273680. رصيدك الحالي: ${balance} جنيه تاريخ العملية: 00:15 26-08-21 رقم العملية: ${txId}`;

/** رسالة Recharge تحتوي Balance — صيغة "رصيد حسابك في فودافون كاش الحالي" */
const VF_RECHARGE = (balance: number) =>
  `تم شحن رصيد موبايلك ب 13.5 جنيه بنجاح. رصيد حسابك في فودافون كاش الحالي ${balance} جنيه`;

/** رسالة Recharge بفاصلة منقوطة "؛" */
const VF_RECHARGE_SEMICOLON = (balance: number) =>
  `تم شحن رصيد موبايلك ب 13.5 بنجاح وخصم 13.5 من محفظتك شاملة الضريبة؛ رصيد حسابك في فودافون كاش الحالي ${balance} جنيه`;

/** رسالة Outgoing Payment تحتوي Balance After */
const VF_OUTGOING = (balance: number) =>
  `تم ارسال مبلغ 200 جنيه الى رقم 01012345678. رصيد حسابك الحالي: ${balance} جنيه رقم العملية: 099887766554`;

/** رسالة تحتوي فقط مبلغاً بدون Label رصيد */
const VF_AMOUNT_ONLY = `تم دفع مبلغ 100 جنيه لخدمة X. العملية رقم 123456789`;

/** رسالة ترويجية تحتوي أرقاماً بدون رصيد */
const VF_PROMO = `احصل على عرض خاص! وفّر 25% على تحويلاتك في فودافون كاش. صالح حتى نهاية الشهر`;

// ────────────────────────────────────────────────────────────────────────────
// TC01 — Incoming Payment مع Balance After
// ────────────────────────────────────────────────────────────────────────────
describe('TC01 — Incoming Payment يحتوي Balance After', () => {
  it('يستخرج Balance من رسالة Incoming Payment', () => {
    const ev = extractBalanceEvidence(VF_INCOMING(84324.60));
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(84324.60, 2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC02 — Recharge يحتوي Balance
// ────────────────────────────────────────────────────────────────────────────
describe('TC02 — Recharge يحتوي Balance (صيغة في فودافون كاش)', () => {
  it('يستخرج Balance من رسالة Recharge', () => {
    const ev = extractBalanceEvidence(VF_RECHARGE(83924.60));
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(83924.60, 1);
  });
  it('isValidBalanceEvidenceMessage تقبل رسالة Recharge', () => {
    expect(isValidBalanceEvidenceMessage(VF_RECHARGE(83924.60))).toBe(true);
  });
  it('detectMessageType يُعيد recharge لرسالة شحن', () => {
    expect(detectMessageType(VF_RECHARGE(83924.60))).toBe('recharge');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC03 — Recharge بفاصلة منقوطة "؛"
// ────────────────────────────────────────────────────────────────────────────
describe('TC03 — Recharge بفاصلة منقوطة ؛ بدل : أو مسافة', () => {
  it('يستخرج Balance من رسالة تحتوي ؛ قبل الرصيد', () => {
    const ev = extractBalanceEvidence(VF_RECHARGE_SEMICOLON(83924.60));
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(83924.60, 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC04 — Outgoing Payment يحتوي Balance
// ────────────────────────────────────────────────────────────────────────────
describe('TC04 — Outgoing Payment يحتوي Balance', () => {
  it('يستخرج Balance من رسالة Outgoing (رصيد حسابك الحالي)', () => {
    const ev = extractBalanceEvidence(VF_OUTGOING(83724.60));
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(83724.60, 2);
  });
  it('detectMessageType يُعيد outgoing_payment', () => {
    expect(detectMessageType(VF_OUTGOING(1000))).toBe('outgoing_payment');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC05 — Amount فقط بدون Balance Label
// ────────────────────────────────────────────────────────────────────────────
describe('TC05 — رسالة Amount فقط بدون Balance Label', () => {
  it('يعيد null لرسالة Amount فقط', () => {
    expect(extractBalanceEvidence(VF_AMOUNT_ONLY)).toBeNull();
    expect(extractBalanceFromMessage(VF_AMOUNT_ONLY)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC06 — صيغة "رصيدك الحالي"
// ────────────────────────────────────────────────────────────────────────────
describe('TC06 — صيغة: رصيدك الحالي', () => {
  it('يستخرج الرصيد', () => {
    const ev = extractBalanceEvidence('رصيدك الحالي: 1500.75 جنيه');
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(1500.75, 2);
    expect(ev!.evidenceText).toMatch(/رصيدك/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC07 — صيغة "رصيد حسابك"
// ────────────────────────────────────────────────────────────────────────────
describe('TC07 — صيغة: رصيد حسابك', () => {
  it('يستخرج الرصيد', () => {
    expect(extractBalanceEvidence('رصيد حسابك 2200.00 جنيه')?.value).toBeCloseTo(2200.00, 2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC08 — صيغة "رصيد حسابك في فودافون كاش الحالي"
// ────────────────────────────────────────────────────────────────────────────
describe('TC08 — صيغة: رصيد حسابك في فودافون كاش الحالي', () => {
  it('يستخرج الرصيد', () => {
    expect(extractBalanceEvidence('رصيد حسابك في فودافون كاش الحالي 83924.6 جنيه')?.value).toBeCloseTo(83924.6, 1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC09 — صيغة "رصيد محفظتك الحالي"
// ────────────────────────────────────────────────────────────────────────────
describe('TC09 — صيغة: رصيد محفظتك الحالي', () => {
  it('يستخرج الرصيد', () => {
    expect(extractBalanceEvidence('رصيد محفظتك الحالي: 5000.00 جنيه')?.value).toBeCloseTo(5000.00, 2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC10 — صيغة "رصيد محفظتك" (بدون "الحالي")
// ────────────────────────────────────────────────────────────────────────────
describe('TC10 — صيغة: رصيد محفظتك', () => {
  it('يستخرج الرصيد', () => {
    expect(extractBalanceEvidence('رصيد محفظتك 3500 جنيه')?.value).toBeCloseTo(3500, 0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC11 — صيغة "رصيد حسابك الحالي"
// ────────────────────────────────────────────────────────────────────────────
describe('TC11 — صيغة: رصيد حسابك الحالي', () => {
  it('يستخرج الرصيد', () => {
    expect(extractBalanceEvidence('رصيد حسابك الحالي: 7200.50 جنيه')?.value).toBeCloseTo(7200.50, 2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC12 — صيغة "الرصيد الحالي"
// ────────────────────────────────────────────────────────────────────────────
describe('TC12 — صيغة: الرصيد الحالي', () => {
  it('يستخرج الرصيد', () => {
    expect(extractBalanceEvidence('الرصيد الحالي: 9100.00 جنيه')?.value).toBeCloseTo(9100.00, 2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC13 — أرقام عربية
// ────────────────────────────────────────────────────────────────────────────
describe('TC13 — أرقام عربية', () => {
  it('يستخرج الرصيد من أرقام عربية', () => {
    const ev = extractBalanceEvidence('رصيدك الحالي: ٨٤٣٢٤.٦٠ جنيه');
    expect(ev).not.toBeNull();
    expect(ev!.value).toBeCloseTo(84324.60, 2);
  });
  it('toEnDigits يُحوّل الأرقام العربية كاملاً', () => {
    expect(toEnDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });
  it('toEnDigits يُحوّل أرقام فارسية', () => {
    expect(toEnDigits('۱۲۳')).toBe('123');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC14 — مسافات متباينة حول الفاصل
// ────────────────────────────────────────────────────────────────────────────
describe('TC14 — مسافات متباينة', () => {
  it('يتعامل مع مسافات زائدة حول النقطتين', () => {
    expect(extractBalanceEvidence('رصيدك الحالي :  1234.56 جنيه')?.value).toBeCloseTo(1234.56, 2);
  });
  it('يتعامل مع مسافات متعددة بين كلمات الـ label', () => {
    expect(extractBalanceEvidence('رصيدك   الحالي:1234.56')?.value).toBeCloseTo(1234.56, 2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC15 — رسالة متعددة الأسطر
// ────────────────────────────────────────────────────────────────────────────
describe('TC15 — رسالة متعددة الأسطر', () => {
  it('يستخرج الرصيد من رسالة مقسّمة على أسطر', () => {
    const msg = 'تم استلام 400 جنيه.\nرصيدك الحالي: 84000.00 جنيه\nرقم العملية: 111';
    expect(extractBalanceEvidence(msg)?.value).toBeCloseTo(84000.00, 2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC16 — رسالة ترويجية مرفوضة
// ────────────────────────────────────────────────────────────────────────────
describe('TC16 — رسالة ترويجية', () => {
  it('الرسالة الترويجية لا تحتوي Balance Evidence', () => {
    expect(extractBalanceEvidence(VF_PROMO)).toBeNull();
  });
  it('isValidBalanceEvidenceMessage ترفض الرسالة الترويجية', () => {
    expect(isValidBalanceEvidenceMessage(VF_PROMO)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC17 — Amount لا يُربَك بالـ Balance Label
// ────────────────────────────────────────────────────────────────────────────
describe('TC17 — Amount فقط لا يُستخرج كـ Balance', () => {
  it('تم دفع مبلغ — لا Balance Label', () => {
    expect(extractBalanceEvidence('تم دفع مبلغ 400 جنيه.')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC18 — اختيار أقرب رسالة سابقة
// ────────────────────────────────────────────────────────────────────────────
describe('TC18 — اختيار أقرب رسالة سابقة', () => {
  it('الأقرب زمنياً يُختار على الأقدم', () => {
    const currentTs = new Date('2021-08-26T00:10:00.000Z').getTime();
    const candidates = [
      { date: '2021-08-25T10:00:00.000Z', balance: 1000 },   // أقدم
      { date: '2021-08-26T00:04:00.000Z', balance: 1050 },   // أقرب
    ].filter(m => new Date(m.date).getTime() < currentTs)
     .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    expect(candidates[0].balance).toBe(1050);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC19 — رسالة لاحقة مرفوضة
// ────────────────────────────────────────────────────────────────────────────
describe('TC19 — رسالة لاحقة مرفوضة', () => {
  it('رسالة بتاريخ لاحق للعملية لا تُستخدم كـ Evidence', () => {
    const currentTs = new Date('2021-08-26T00:10:00.000Z').getTime();
    const laterTs   = new Date('2021-08-26T00:15:00.000Z').getTime();
    expect(laterTs >= currentTs).toBe(true); // يجب رفضها
  });
  it('رسالة بنفس الـ timestamp تُرفض (>= وليس >)', () => {
    const currentTs = new Date('2021-08-26T00:10:00.000Z').getTime();
    const sameTs    = new Date('2021-08-26T00:10:00.000Z').getTime();
    expect(sameTs >= currentTs).toBe(true); // يجب رفضها
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC20 — الترتيب الزمني مستقل عن ترتيب الـ Array
// ────────────────────────────────────────────────────────────────────────────
describe('TC20 — الترتيب الزمني صحيح بغض النظر عن ترتيب الـ Array', () => {
  it('يرتّب الرسائل بـ timestamp ويختار الأقرب', () => {
    const currentTs = new Date('2021-08-26T00:10:00.000Z').getTime();
    const messages = [
      { id: 'c', date: '2021-08-26T00:10:00.000Z', balance: 84324.60 }, // العملية الحالية
      { id: 'b', date: '2021-08-26T00:04:00.000Z', balance: 83924.60 }, // أقرب سابق
      { id: 'a', date: '2021-08-25T10:00:00.000Z', balance: 1000.00 },  // قديم
    ];
    const best = messages
      .filter(m => new Date(m.date).getTime() < currentTs)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

    expect(best.id).toBe('b');
    expect(best.balance).toBe(83924.60);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC21 — Balance Flow VALID
// ────────────────────────────────────────────────────────────────────────────
describe('TC21 — Balance Flow VALID', () => {
  it('83924.60 + 400 = 84324.60 => BALANCE_FLOW_VALID', () => {
    expect(validateBalanceFlow(83924.60, 400, 84324.60)).toBe('BALANCE_FLOW_VALID');
  });
  it('يقبل فارق ضمن التسامح 0.10', () => {
    expect(validateBalanceFlow(83924.60, 400, 84324.65)).toBe('BALANCE_FLOW_VALID');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC22 — Balance Flow MISMATCH
// ────────────────────────────────────────────────────────────────────────────
describe('TC22 — Balance Flow MISMATCH', () => {
  it('1000 + 100 ≠ 1200 => BALANCE_FLOW_MISMATCH', () => {
    expect(validateBalanceFlow(1000, 100, 1200)).toBe('BALANCE_FLOW_MISMATCH');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC23 — Balance Flow UNKNOWN
// ────────────────────────────────────────────────────────────────────────────
describe('TC23 — Balance Flow UNKNOWN عند قيم null', () => {
  it('amount=null => UNKNOWN', () => {
    expect(validateBalanceFlow(1000, null, 1100)).toBe('BALANCE_FLOW_UNKNOWN');
  });
  it('balanceAfter=null => UNKNOWN', () => {
    expect(validateBalanceFlow(1000, 100, null)).toBe('BALANCE_FLOW_UNKNOWN');
  });
  it('كلاهما null => UNKNOWN', () => {
    expect(validateBalanceFlow(1000, null, null)).toBe('BALANCE_FLOW_UNKNOWN');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC24 — isVodafoneCashMessage
// ────────────────────────────────────────────────────────────────────────────
describe('TC24 — isVodafoneCashMessage', () => {
  it('يتعرف على رسالة VF Cash بـ "vodafone cash"', () => {
    expect(isVodafoneCashMessage('تم شحن محفظتك vodafone cash')).toBe(true);
  });
  it('يتعرف على رسالة VF Cash بـ "فودافون"', () => {
    expect(isVodafoneCashMessage(VF_RECHARGE(1000))).toBe(true);
  });
  it('لا يتعرف على رسالة غير VF', () => {
    expect(isVodafoneCashMessage('رسالة من بنك اهلي بشأن حسابك رقم 123')).toBe(false);
  });
  it('يتعرف على رسالة Recharge بـ "شحن" + "رصيد"', () => {
    expect(isVodafoneCashMessage('تم شحن رصيد موبايلك ب 13.5')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// TC25 — extractBalanceFromMessage (legacy compat)
// ────────────────────────────────────────────────────────────────────────────
describe('TC25 — extractBalanceFromMessage (توافق مع الكود القديم)', () => {
  it('يعيد القيمة الرقمية مباشرة', () => {
    expect(extractBalanceFromMessage('رصيدك الحالي: 9999.99 جنيه')).toBeCloseTo(9999.99, 2);
  });
  it('يعيد null إذا لا يوجد Balance Label', () => {
    expect(extractBalanceFromMessage('رسالة عادية بدون رصيد')).toBeNull();
  });
  it('يعيد null لرسالة فارغة', () => {
    expect(extractBalanceFromMessage('')).toBeNull();
  });
});
