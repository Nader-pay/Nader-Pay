import { dbReady } from '@/lib/database';
import { createHash } from '@/lib/hash';
import { parseMessage } from './providers';
import type { SmsMessage, ParsedTransaction, ProviderName } from '@/types/agent';

export async function indexSmsMessage(message: SmsMessage): Promise<ParsedTransaction | null> {
  const db = await dbReady;
  const parsed = parseMessage(message.body);
  const hash = createHash(message.body);

  await db.runAsync(
    `INSERT INTO local_sms_index (
      id, message_hash, body, originating_address, received_at,
      provider, transaction_id, amount, sender_phone, sender_name,
      recipient_wallet, recipient_account, parsed_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_hash) DO UPDATE SET
      provider = excluded.provider,
      transaction_id = excluded.transaction_id,
      amount = excluded.amount,
      sender_phone = excluded.sender_phone,
      sender_name = excluded.sender_name,
      recipient_wallet = excluded.recipient_wallet,
      recipient_account = excluded.recipient_account,
      parsed_payload = excluded.parsed_payload`,
    [
      message.id,
      hash,
      message.body,
      message.originatingAddress,
      message.date,
      parsed?.provider ?? null,
      parsed?.transactionId ?? null,
      parsed?.amount ?? null,
      parsed?.senderPhone ?? null,
      parsed?.senderName ?? null,
      parsed?.recipientWallet ?? null,
      parsed?.recipientAccount ?? null,
      parsed ? JSON.stringify(parsed) : null,
    ]
  );

  return parsed;
}

export async function findMatchingSmsInIndex(
  order: {
    id?: string;
    amount: number;
    provider?: ProviderName | null;
    expected_sender_phone?: string | null;
    expected_sender_name?: string | null;
    expected_recipient_wallet?: string | null;
    created_at?: string;
    maxSearchWindowHours?: number;
  }
): Promise<ParsedTransaction[]> {
  const db = await dbReady;
  const windowHours = order.maxSearchWindowHours ?? 24;
  const since = order.created_at
    ? new Date(new Date(order.created_at).getTime() - 60 * 60 * 1000).toISOString()
    : new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  // فقط رسائل غير مطابقة لطلبات أخرى (match_status != 'matched' أو matched_order_id = orderId)
  const rows = (await db.getAllAsync(
    `SELECT id, parsed_payload, matched_order_id, match_status FROM local_sms_index
     WHERE amount = ?
       AND received_at >= ?
       AND parsed_payload IS NOT NULL
       AND (match_status IS NULL OR match_status = 'unmatched' OR matched_order_id = ?)
     ORDER BY received_at DESC`,
    [order.amount, since, order.id ?? '']
  )) as { id: string; parsed_payload: string; matched_order_id: string | null; match_status: string | null }[];

  return rows
    .map((r) => {
      try {
        const parsed = JSON.parse(r.parsed_payload) as ParsedTransaction;
        // أضف smsIndexId للاستخدام لاحقاً في markSmsSentToOrder
        (parsed as any)._smsIndexId = r.id;
        return parsed;
      } catch {
        return null;
      }
    })
    .filter((t): t is ParsedTransaction => t !== null);
}

export async function getLastIndexedSmsAt(): Promise<string | null> {
  const db = await dbReady;
  const row = await db.getFirstAsync<{ received_at: string }>(
    'SELECT received_at FROM local_sms_index ORDER BY received_at DESC LIMIT 1'
  );
  return row?.received_at ?? null;
}

export async function getIndexedSmsCount(): Promise<number> {
  const db = await dbReady;
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM local_sms_index');
  return row?.count ?? 0;
}

export async function getIndexedSmsStats(): Promise<
  {
    provider: string;
    count: number;
    lastReceivedAt: string | null;
  }[]
> {
  const db = await dbReady;
  const rows = (await db.getAllAsync(
    `SELECT provider, COUNT(*) as count, MAX(received_at) as last_received_at
     FROM local_sms_index
     WHERE provider IS NOT NULL
     GROUP BY provider
     ORDER BY count DESC`
  )) as { provider: string; count: number; last_received_at: string | null }[];
  return rows.map((r) => ({
    provider: r.provider,
    count: r.count,
    lastReceivedAt: r.last_received_at,
  }));
}
