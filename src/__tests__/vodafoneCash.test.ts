/**
 * Unit Tests — Vodafone Cash Parser v2
 * يختبر: valid/invalid/balance-only/promo/sent/strict-fields/date-formats
 */

import { parseVodafoneCashSms, looksLikeVodafoneCashSms, VF_CASH_PARSER_ID, VF_CASH_PARSER_VERSION } from '../services/providers/vodafoneCash';

// ─── بيانات الاختبار ─────────────────────────────────────────────────────────

// ✅ الرسالة الحقيقية — تنسيق YY-MM-DD HH:MM الجديد
const VALID_MSG_NEW_DATE = `تم استلام مبلغ 400 جنيه من رقم 01030951228 المسجل باسم Wessam A Ahmed Ali على رقم محفظتك 01097273680.\nرصيدك الحالي: 84324.60 جنيه\nتاريخ العملية: 21-08-26 00:15\nرقم العملية: 022896233255\nتابع كل مصروفاتك من تاريخ المعاملات على أبلكيشن أنا فودافون ...`;

// ✅ رسالة بتنسيق التاريخ القديم HH:MM DD/MM/YY
const VALID_MSG_OLD_DATE = `تم استلام مبلغ 400 جنيه من رقم 01030951228 المسجل بإسم Wessam A Ahmed Ali على رقم محفظتك 01097273680. رصيدك الحالي: 84324.60 جنيه تاريخ العملية: 00:15 26/08/21 رقم العملية: 022896233255`;

// ✅ رسالة ثانية صالحة
const VALID_MSG_2 = `تم استلام مبلغ 150 جنيه من رقم 01111234567 المسجل بإسم Ahmed على رقم محفظتك 01097273680. رصيدك الحالي: 1500.00 جنيه تاريخ العملية: 12:30 01/06/24 رقم العملية: 033111222333`;

// ❌ رسالة رصيد فقط
const BALANCE_ONLY_MSG = `رصيدك الحالي 84324.60 جنيه Vodafone Cash`;

// ❌ رسالة تسويقية
const PROMO_MSG = `Vodafone Cash: احصل على 20% خصم على تحويلاتك اليوم فقط!`;

// ❌ رسالة إرسال أموال
const SENT_MSG = `Vodafone Cash: تم إرسال مبلغ 200 جنيه إلى 01099887766 بنجاح. رقم العملية: 099999000000`;

// ❌ بدون رقم العملية
const MISSING_TX_ID = `تم استلام مبلغ 100 جنيه من رقم 01000000000 على محفظتك 01097273680.`;

// ❌ رسالة InstaPay
const INSTAPAY_MSG = `تم اضافة مبلغ 300EGP الى حساب رقم xxx4449 فى 13-AUG-2026 عن طريق التحويل اللحظي`;

// ✅ أرقام عربية
const ARABIC_DIGITS_MSG = `تم استلام مبلغ ٤٠٠ جنيه من رقم ٠١٠٣٠٩٥١٢٢٨ المسجل بإسم Test User على رقم محفظتك ٠١٠٩٧٢٧٣٦٨٠.\nرصيدك الحالي: ٥٠٠٠.٠٠ جنيه\nتاريخ العملية: ٢١-٠٨-٢٦ ٠٠:١٥\nرقم العملية: ٠٢٢٨٩٦٢٣٣٢٥٥`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VodafoneCash Parser v2', () => {

  // ── looksLike ────────────────────────────────────────────────────────────
  describe('looksLikeVodafoneCashSms', () => {
    test('يتعرف على رسالة فودافون كاش صالحة', () => {
      expect(looksLikeVodafoneCashSms(VALID_MSG_NEW_DATE)).toBe(true);
    });
    test('لا يتعرف على رسالة InstaPay', () => {
      expect(looksLikeVodafoneCashSms(INSTAPAY_MSG)).toBe(false);
    });
    test('يتعرف على رسالة رصيد فودافون', () => {
      expect(looksLikeVodafoneCashSms(BALANCE_ONLY_MSG)).toBe(true);
    });
  });

  // ── الرسالة الحقيقية — تنسيق YY-MM-DD HH:MM ─────────────────────────────
  describe('رسالة حقيقية بتنسيق تاريخ YY-MM-DD HH:MM', () => {
    const result = parseVodafoneCashSms(VALID_MSG_NEW_DATE);

    test('يُعيد نتيجة غير null', () => expect(result).not.toBeNull());
    test('amount = 400', () => expect(result?.amount).toBe(400));
    test('transactionId = 022896233255', () => expect(result?.transactionId).toBe('022896233255'));
    test('senderPhone = 01030951228', () => expect(result?.senderPhone).toBe('01030951228'));
    test('senderName يحتوي Wessam', () => expect(result?.senderName).toContain('Wessam'));
    test('recipientWallet = 01097273680', () => expect(result?.recipientWallet).toBe('01097273680'));
    test('transactionType = incoming_payment', () => expect(result?.transactionType).toBe('incoming_payment'));
    test('currency = EGP', () => expect(result?.currency).toBe('EGP'));
    test('balanceAfterTransaction = 84324.60', () => expect(result?.balanceAfterTransaction).toBeCloseTo(84324.60));
    test('occurredAt تاريخ صحيح (2021-08-26)', () => {
      expect(result?.occurredAt).toContain('2021-08-26');
    });
    test('parserId صحيح', () => expect(result?.parserId).toBe(VF_CASH_PARSER_ID));
    test('parserVersion صحيح', () => expect(result?.parserVersion).toBe(VF_CASH_PARSER_VERSION));
  });

  // ── رسالة بتنسيق التاريخ القديم HH:MM DD/MM/YY ───────────────────────────
  describe('رسالة بتنسيق تاريخ قديم HH:MM DD/MM/YY', () => {
    const result = parseVodafoneCashSms(VALID_MSG_OLD_DATE);
    test('يُعيد نتيجة غير null', () => expect(result).not.toBeNull());
    test('amount = 400', () => expect(result?.amount).toBe(400));
    test('transactionId = 022896233255', () => expect(result?.transactionId).toBe('022896233255'));
    test('occurredAt تاريخ صحيح', () => expect(result?.occurredAt).toBeTruthy());
  });

  // ── رسالة ثانية صالحة ────────────────────────────────────────────────────
  test('تحلل رسالة استلام ثانية بنجاح', () => {
    const r = parseVodafoneCashSms(VALID_MSG_2);
    expect(r).not.toBeNull();
    expect(r?.amount).toBe(150);
    expect(r?.transactionId).toBe('033111222333');
  });

  // ── أرقام عربية ──────────────────────────────────────────────────────────
  test('يحلل رسالة بأرقام عربية', () => {
    const r = parseVodafoneCashSms(ARABIC_DIGITS_MSG);
    expect(r).not.toBeNull();
    expect(r?.amount).toBe(400);
    expect(r?.transactionId).toBe('022896233255');
  });

  // ── رسائل مرفوضة ─────────────────────────────────────────────────────────
  describe('رسائل يجب رفضها', () => {
    test('يرفض رسالة الرصيد وحدها', () => expect(parseVodafoneCashSms(BALANCE_ONLY_MSG)).toBeNull());
    test('يرفض رسالة التسويق', () => expect(parseVodafoneCashSms(PROMO_MSG)).toBeNull());
    test('يرفض رسالة إرسال أموال', () => expect(parseVodafoneCashSms(SENT_MSG)).toBeNull());
    test('يرفض رسالة بدون رقم العملية', () => expect(parseVodafoneCashSms(MISSING_TX_ID)).toBeNull());
    test('يرفض رسالة InstaPay', () => expect(parseVodafoneCashSms(INSTAPAY_MSG)).toBeNull());
    test('يرفض رسالة فارغة', () => expect(parseVodafoneCashSms('')).toBeNull());
  });
});

// ─── بيانات الاختبار ─────────────────────────────────────────────────────────

const VALID_MSG = `تم استلام مبلغ 400 جنيه من رقم 01030951228 المسجل بإسم Wessam A Ahmed Ali على رقم محفظتك 01097273680. رصيدك الحالي: 84324.60 جنيه تاريخ العملية: 00:15 26/08/21 رقم العملية: 022896233255`;

const VALID_MSG_2 = `تم استلام مبلغ 150 جنيه من رقم 01111234567 المسجل بإسم Ahmed على رقم محفظتك 01097273680. رصيدك الحالي: 1500.00 جنيه تاريخ العملية: 12:30 01/06/24 رقم العملية: 033111222333`;

const BALANCE_ONLY_MSG = `رصيدك الحالي 84324.60 جنيه Vodafone Cash`;

const PROMO_MSG = `Vodafone Cash: احصل على 20% خصم على تحويلاتك اليوم فقط!`;

const SENT_MSG = `Vodafone Cash: تم إرسال مبلغ 200 جنيه إلى 01099887766 بنجاح. رقم العملية: 099999000000`;

const MISSING_TX_ID = `تم استلام مبلغ 100 جنيه من رقم 01000000000 على محفظتك 01097273680.`;

const INSTAPAY_MSG = `تم اضافة مبلغ 300EGP الى حساب رقم xxx4449 فى 13-AUG-2026 عن طريق التحويل اللحظي`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VodafoneCash Parser v2', () => {

  // ── looksLike ────────────────────────────────────────────────────────────
  describe('looksLikeVodafoneCashSms', () => {
    test('يتعرف على رسالة فودافون كاش صالحة', () => {
      expect(looksLikeVodafoneCashSms(VALID_MSG)).toBe(true);
    });
    test('لا يتعرف على رسالة InstaPay', () => {
      expect(looksLikeVodafoneCashSms(INSTAPAY_MSG)).toBe(false);
    });
    test('يتعرف على رسالة رصيد فودافون', () => {
      expect(looksLikeVodafoneCashSms(BALANCE_ONLY_MSG)).toBe(true);
    });
  });

  // ── رسالة صالحة — جميع الحقول ────────────────────────────────────────────
  describe('رسالة استلام صالحة', () => {
    const result = parseVodafoneCashSms(VALID_MSG);

    test('يُعيد نتيجة غير null', () => {
      expect(result).not.toBeNull();
    });
    test('amount = 400', () => {
      expect(result?.amount).toBe(400);
    });
    test('transactionId = 022896233255', () => {
      expect(result?.transactionId).toBe('022896233255');
    });
    test('senderPhone = 01030951228', () => {
      expect(result?.senderPhone).toBe('01030951228');
    });
    test('senderName = Wessam A Ahmed Ali', () => {
      expect(result?.senderName).toContain('Wessam');
    });
    test('recipientWallet = 01097273680', () => {
      expect(result?.recipientWallet).toBe('01097273680');
    });
    test('transactionType = incoming_payment', () => {
      expect(result?.transactionType).toBe('incoming_payment');
    });
    test('currency = EGP', () => {
      expect(result?.currency).toBe('EGP');
    });
    test('balanceAfterTransaction = 84324.60', () => {
      expect(result?.balanceAfterTransaction).toBeCloseTo(84324.60);
    });
    test('parserId صحيح', () => {
      expect(result?.parserId).toBe(VF_CASH_PARSER_ID);
    });
    test('parserVersion صحيح', () => {
      expect(result?.parserVersion).toBe(VF_CASH_PARSER_VERSION);
    });
  });

  // ── رسالة ثانية صالحة ────────────────────────────────────────────────────
  test('تحلل رسالة استلام ثانية بنجاح', () => {
    const r = parseVodafoneCashSms(VALID_MSG_2);
    expect(r).not.toBeNull();
    expect(r?.amount).toBe(150);
    expect(r?.transactionId).toBe('033111222333');
  });

  // ── رسائل مرفوضة ─────────────────────────────────────────────────────────
  describe('رسائل يجب رفضها', () => {
    test('يرفض رسالة الرصيد وحدها', () => {
      expect(parseVodafoneCashSms(BALANCE_ONLY_MSG)).toBeNull();
    });
    test('يرفض رسالة التسويق', () => {
      expect(parseVodafoneCashSms(PROMO_MSG)).toBeNull();
    });
    test('يرفض رسالة إرسال أموال', () => {
      expect(parseVodafoneCashSms(SENT_MSG)).toBeNull();
    });
    test('يرفض رسالة بدون رقم العملية', () => {
      expect(parseVodafoneCashSms(MISSING_TX_ID)).toBeNull();
    });
    test('يرفض رسالة InstaPay', () => {
      expect(parseVodafoneCashSms(INSTAPAY_MSG)).toBeNull();
    });
    test('يرفض رسالة فارغة', () => {
      expect(parseVodafoneCashSms('')).toBeNull();
    });
  });
});
