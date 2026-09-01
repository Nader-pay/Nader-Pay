/**
 * Duplicate Protection — Deterministic Fingerprint per Provider
 * ─────────────────────────────────────────────────────────────
 * Vodafone Cash: transactionId primary identifier (رقم العملية)
 * InstaPay:      fingerprint حتمي = amount:account:date (لا transactionId في الرسائل)
 * لا يعتمد على message text وحده.
 *
 * يتكامل مع processed_transactions الموجود في قاعدة البيانات.
 */

import { dbReady } from '@/lib/database';
import type { ProviderName } from '@/types/agent';
import { buildInstaPayFingerprint } from './providers/instaPay';

// ─── Primary Identity حسب Provider ─────────────────────────────────────────

/**
 * أنشئ fingerprint فريد ومحدد للمعاملة حسب الـ provider.
 * Vodafone Cash: transactionId مباشرة.
 * InstaPay:      fingerprint من amount + account + date.
 */
export function buildTransactionFingerprint(
  provider: ProviderName,
  transactionId: string,
  amount: number,
  recipientAccountOrWallet: string | null,
  transactionDate: string | null
): string {
  if (provider === 'vodafone_cash') {
    // transactionId هو رقم العملية الرسمي — primary identity
    return `vf:${transactionId}`;
  }
  if (provider === 'insta_pay') {
    // InstaPay لا يوفر transactionId حقيقي — نستخدم fingerprint حتمي
    return buildInstaPayFingerprint(
      amount,
      recipientAccountOrWallet ?? '',
      transactionDate ?? ''
    );
  }
  // بقية الـ providers: استخدم transactionId إن وُجد
  return `${provider}:${transactionId}`;
}

/**
 * هل هذه المعاملة مكررة؟
 * يفحص processed_transactions بـ transaction_id الحتمي.
 */
export async function isTransactionDuplicate(
  provider: ProviderName,
  transactionId: string,
  amount: number,
  recipientAccountOrWallet: string | null,
  transactionDate: string | null
): Promise<boolean> {
  const db = await dbReady;
  const fingerprint = buildTransactionFingerprint(
    provider, transactionId, amount, recipientAccountOrWallet, transactionDate
  );

  // فحص primary: transaction_id كما هو من الـ parser
  const byId = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM processed_transactions WHERE transaction_id = ?`,
    [fingerprint]
  );
  if ((byId?.c ?? 0) > 0) return true;

  // للـ Vodafone Cash: فحص إضافي بـ transactionId الخام
  if (provider === 'vodafone_cash') {
    const byRaw = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM processed_transactions WHERE transaction_id = ?`,
      [transactionId]
    );
    if ((byRaw?.c ?? 0) > 0) return true;
  }

  return false;
}

/**
 * سجّل معاملة كمعالَجة لمنع التكرار.
 * يُستدعى بعد تأكيد الطلب ناجح.
 */
export async function markTransactionProcessed(
  provider: ProviderName,
  transactionId: string,
  amount: number,
  recipientAccountOrWallet: string | null,
  transactionDate: string | null,
  orderId: string
): Promise<void> {
  const db = await dbReady;
  const fingerprint = buildTransactionFingerprint(
    provider, transactionId, amount, recipientAccountOrWallet, transactionDate
  );
  const now = new Date().toISOString();

  // سجّل الـ fingerprint
  await db.runAsync(
    `INSERT OR IGNORE INTO processed_transactions
       (transaction_id, provider, order_id, status, processed_at)
     VALUES (?, ?, ?, 'confirmed', ?)`,
    [fingerprint, provider, orderId, now]
  );

  // سجّل أيضاً الـ transactionId الخام للـ VF Cash
  if (provider === 'vodafone_cash' && transactionId !== fingerprint) {
    await db.runAsync(
      `INSERT OR IGNORE INTO processed_transactions
         (transaction_id, provider, order_id, status, processed_at)
       VALUES (?, ?, ?, 'confirmed', ?)`,
      [transactionId, provider, orderId, now]
    );
  }
}
