import type { Order, ParsedTransaction, MatchResult } from '@/types/agent';

const DEFAULT_SEARCH_WINDOW_HOURS = 24;

export type MatchOptions = {
  maxAmountTolerance: number;
  searchWindowHours?: number;
  minMatchScore?: number;
  requireSourceVerification?: boolean;
};

export function findBestMatch(
  transaction: ParsedTransaction,
  orders: Order[],
  options: MatchOptions
): MatchResult | null {
  const { maxAmountTolerance, searchWindowHours = DEFAULT_SEARCH_WINDOW_HOURS, minMatchScore = 70 } = options;
  const candidates = orders
    .filter((o) => isOrderEligible(o, transaction, searchWindowHours))
    .map((o) => scoreMatch(transaction, o, maxAmountTolerance, options))
    .filter((m) => m.score >= 40);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);

  // إذا كان أعلى تطابقين متقاربين (ضمن 10 نقاط) نعتبرها غامضة ونطلب مراجعة
  if (candidates.length >= 2 && candidates[0].score - candidates[1].score < 10) {
    return {
      ...candidates[0],
      score: candidates[0].score,
      confirmed: false,
      reasons: [...candidates[0].reasons, 'نتيجة غامضة: تطابقات متقاربة'],
    };
  }

  // إذا كان التطابق أقل من الحد الأدنى نطلب مراجعة يدوية
  if (candidates[0].score < minMatchScore) {
    return {
      ...candidates[0],
      confirmed: false,
      reasons: [...candidates[0].reasons, `درجة التطابق أقل من ${minMatchScore} - تتطلب مراجعة`],
    };
  }

  return candidates[0];
}

function isOrderEligible(order: Order, transaction: ParsedTransaction, searchWindowHours: number): boolean {
  const activeStatuses = ['CREATED', 'WAITING_PAYMENT', 'MESSAGE_DETECTED', 'PARSING', 'VERIFYING'];
  if (!activeStatuses.includes(order.status)) return false;

  // إذا كان الطلب يحدد مزود محدد، لا نطابق إلا مع رسائل من نفس المزود
  if (order.provider && order.provider !== 'unknown' && order.provider !== transaction.provider) {
    return false;
  }

  // التحقق من انتهاء الصلاحية
  if (order.expires_at && new Date(order.expires_at) < new Date()) return false;

  // نافذة البحث: المعاملة يجب أن تكون ضمن 24 ساعة من إنشاء الطلب
  const createdAt = order.created_at ? new Date(order.created_at).getTime() : 0;
  const txAt = new Date(transaction.occurredAt).getTime();
  if (createdAt && (txAt < createdAt - 60 * 60 * 1000 || txAt > createdAt + searchWindowHours * 60 * 60 * 1000)) {
    return false;
  }

  return true;
}

function scoreMatch(
  transaction: ParsedTransaction,
  order: Order,
  maxAmountTolerance: number,
  options: MatchOptions
): MatchResult {
  const { requireSourceVerification = false } = options;
  const reasons: string[] = [];
  let score = 0;

  // المبلغ: 50% — مطابقة تامة ضمن التسامح
  const amountDiff = Math.abs(transaction.amount - order.amount);
  const amountTolerance = Math.max(0.01, order.amount * maxAmountTolerance);
  if (amountDiff <= amountTolerance) {
    score += 50;
    reasons.push('المبلغ متطابق');
  } else {
    reasons.push('المبلغ غير متطابق');
  }

  // رقم المرسل: 25% — مطابقة تطبيعية
  if (order.expected_sender_phone && transaction.senderPhone) {
    if (phonesMatch(order.expected_sender_phone, transaction.senderPhone)) {
      score += 25;
      reasons.push('رقم المرسل متطابق');
    } else {
      reasons.push('رقم المرسل غير متطابق');
    }
  }

  // اسم المرسل: 15% — تطابق غامض
  if (order.expected_sender_name && transaction.senderName) {
    if (namesMatch(order.expected_sender_name, transaction.senderName)) {
      score += 15;
      reasons.push('اسم المرسل متطابق');
    } else {
      reasons.push('اسم المرسل غير متطابق');
    }
  }

  // رقم المحفظة المستقبلة: 10% — إذا كان متاحًا
  if (order.expected_recipient_wallet && transaction.recipientWallet) {
    if (phonesMatch(order.expected_recipient_wallet, transaction.recipientWallet)) {
      score += 10;
      reasons.push('رقم المحفظة المستقبلة متطابق');
    } else {
      reasons.push('رقم المحفظة المستقبلة غير متطابق');
    }
  }

  // التحقق من مصدر الرسالة عند التفعيل
  if (requireSourceVerification && transaction.sourceVerification !== 'verified') {
    score = Math.max(0, score - 30);
    reasons.push('لم يتم التحقق من مصدر الرسالة');
  }

  const confirmed = score >= 70;
  return {
    order,
    transaction,
    score,
    reasons,
    confirmed,
  };
}

function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb || na.slice(-10) === nb.slice(-10);
}

function normalizePhone(phone: string): string | null {
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p) return null;
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  if (p.startsWith('20') && p.length === 12) p = '0' + p.slice(2);
  return p;
}

function namesMatch(expected: string, actual: string): boolean {
  const e = normalizeName(expected);
  const a = normalizeName(actual);
  if (e === a) return true;
  if (e.includes(a) || a.includes(e)) return true;

  const eWords = e.split(/\s+/).filter(Boolean);
  const aWords = a.split(/\s+/).filter(Boolean);
  if (eWords.length === 0 || aWords.length === 0) return false;

  const common = eWords.filter((w) => aWords.includes(w));
  return common.length >= Math.min(eWords.length, aWords.length) * 0.5;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
