/**
 * Unit Tests — InstaPay / Banque Misr Parser v2
 * يختبر: valid/invalid/fingerprint/no-transactionId/promo/date-formats
 */

import {
  parseInstaPaySms,
  looksLikeInstaPaySms,
  buildInstaPayFingerprint,
  INSTAPAY_PARSER_ID,
  INSTAPAY_PARSER_VERSION,
} from '../services/providers/instaPay';

// ─── بيانات الاختبار ─────────────────────────────────────────────────────────

// رسالة Banque Misr الحقيقية — بدون transactionId
const BANQUE_MISR_MSG = `تم اضافة مبلغ 300EGP الى حساب رقم xxx4449 فى 13-AUG-2026 عن طريق التحويل اللحظي`;

const BANQUE_MISR_MSG_2 = `تم اضافة مبلغ 1500.50EGP الى حساب رقم xxx7891 فى 01-JAN-2026 عن طريق التحويل اللحظي`;

const BANQUE_MISR_NUMERIC_DATE = `تم اضافة مبلغ 250EGP الى حساب رقم xxx2233 فى 15/06/2026 عن طريق التحويل اللحظي`;

const VF_MSG = `تم استلام مبلغ 400 جنيه من رقم 01030951228 على رقم محفظتك 01097273680 رقم العملية: 022896233255`;

const PROMO_INSTAPAY = `InstaPay: احصل على خصم خاص عند تحويل أموالك اليوم!`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('InstaPay Parser v2', () => {

  // ── looksLike ────────────────────────────────────────────────────────────
  describe('looksLikeInstaPaySms', () => {
    test('يتعرف على رسالة Banque Misr', () => {
      expect(looksLikeInstaPaySms(BANQUE_MISR_MSG)).toBe(true);
    });
    test('لا يتعرف على رسالة Vodafone Cash', () => {
      expect(looksLikeInstaPaySms(VF_MSG)).toBe(false);
    });
    test('يتعرف على رسالة InstaPay بالاسم الإنجليزي', () => {
      expect(looksLikeInstaPaySms('InstaPay transfer received 500 EGP')).toBe(true);
    });
  });

  // ── رسالة Banque Misr صالحة ───────────────────────────────────────────────
  describe('تحليل رسالة Banque Misr الأساسية', () => {
    const result = parseInstaPaySms(BANQUE_MISR_MSG);

    test('يُعيد نتيجة غير null', () => {
      expect(result).not.toBeNull();
    });
    test('amount = 300', () => {
      expect(result?.amount).toBe(300);
    });
    test('receiverAccount = xxx4449', () => {
      expect(result?.recipientAccount).toContain('4449');
    });
    test('transactionDate = 2026-08-13', () => {
      expect(result?.transactionDate).toBe('2026-08-13');
    });
    test('transactionType = incoming_payment', () => {
      expect(result?.transactionType).toBe('incoming_payment');
    });
    test('currency = EGP', () => {
      expect(result?.currency).toBe('EGP');
    });
    test('senderPhone = null (لا يتوفر في InstaPay)', () => {
      expect(result?.senderPhone).toBeNull();
    });
    test('senderName = null (لا يتوفر في InstaPay)', () => {
      expect(result?.senderName).toBeNull();
    });
    test('transactionId هو fingerprint حتمي', () => {
      const fp = buildInstaPayFingerprint(300, 'xxx4449', '2026-08-13');
      expect(result?.transactionId).toBe(fp);
    });
    test('parserId صحيح', () => {
      expect(result?.parserId).toBe(INSTAPAY_PARSER_ID);
    });
    test('parserVersion صحيح', () => {
      expect(result?.parserVersion).toBe(INSTAPAY_PARSER_VERSION);
    });
  });

  // ── رسالة بكسر عشري ─────────────────────────────────────────────────────
  test('يحلل مبلغ به كسر عشري', () => {
    const r = parseInstaPaySms(BANQUE_MISR_MSG_2);
    expect(r).not.toBeNull();
    expect(r?.amount).toBeCloseTo(1500.50);
    expect(r?.transactionDate).toBe('2026-01-01');
  });

  // ── رسالة بتاريخ رقمي ───────────────────────────────────────────────────
  test('يحلل تاريخ رقمي dd/mm/yyyy', () => {
    const r = parseInstaPaySms(BANQUE_MISR_NUMERIC_DATE);
    expect(r).not.toBeNull();
    expect(r?.transactionDate).toBe('2026-06-15');
  });

  // ── Fingerprint حتمي ─────────────────────────────────────────────────────
  describe('buildInstaPayFingerprint', () => {
    test('نفس البيانات تنتج نفس الـ fingerprint', () => {
      const f1 = buildInstaPayFingerprint(300, 'xxx4449', '2026-08-13');
      const f2 = buildInstaPayFingerprint(300, 'xxx4449', '2026-08-13');
      expect(f1).toBe(f2);
    });
    test('بيانات مختلفة تنتج fingerprint مختلف', () => {
      const f1 = buildInstaPayFingerprint(300, 'xxx4449', '2026-08-13');
      const f2 = buildInstaPayFingerprint(300, 'xxx4449', '2026-08-14');
      expect(f1).not.toBe(f2);
    });
    test('fingerprint يبدأ بـ instapay:', () => {
      const f = buildInstaPayFingerprint(100, 'acc123', '2026-01-01');
      expect(f.startsWith('instapay:')).toBe(true);
    });
  });

  // ── رسائل مرفوضة ─────────────────────────────────────────────────────────
  describe('رسائل يجب رفضها', () => {
    test('يرفض رسالة Vodafone Cash', () => {
      expect(parseInstaPaySms(VF_MSG)).toBeNull();
    });
    test('يرفض رسالة تسويقية', () => {
      expect(parseInstaPaySms(PROMO_INSTAPAY)).toBeNull();
    });
    test('يرفض رسالة بدون مبلغ', () => {
      expect(parseInstaPaySms('تم التحويل اللحظي الى حساب رقم xxx1234')).toBeNull();
    });
    test('يرفض رسالة بدون حساب مستلم', () => {
      expect(parseInstaPaySms('تم اضافة مبلغ 100EGP فى 13-AUG-2026 عن طريق التحويل اللحظي')).toBeNull();
    });
    test('يرفض رسالة فارغة', () => {
      expect(parseInstaPaySms('')).toBeNull();
    });
  });

  // ── تطابق الـ fingerprint مع Parser ─────────────────────────────────────
  test('fingerprint من Parser يطابق buildInstaPayFingerprint مباشرة', () => {
    const r = parseInstaPaySms(BANQUE_MISR_MSG);
    if (!r) throw new Error('parse failed');
    const manual = buildInstaPayFingerprint(r.amount, r.recipientAccount ?? '', r.transactionDate ?? '');
    expect(r.transactionId).toBe(manual);
  });
});
