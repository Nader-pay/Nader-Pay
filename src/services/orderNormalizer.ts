import type { ProviderName } from '@/types/provider';
import type { RawOrder, NormalizedOrder } from '@/types/backend';

/** توليد UUID آمن متوافق مع Hermes (React Native) */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function detectProvider(raw: RawOrder): ProviderName | null {
  const providerHint =
    (raw.provider as string | undefined) ||
    (raw.payment_method as string | undefined) ||
    (raw.type as string | undefined) ||
    (raw.service as string | undefined) ||
    '';
  const normalized = providerHint.toLowerCase().replace(/[-_\s]/g, '');
  if (normalized.includes('vodafone') || normalized.includes('vfcash') || normalized.includes('vodafon')) {
    return 'vodafone_cash';
  }
  if (normalized.includes('orange') || normalized.includes('orangecash')) {
    return 'orange_cash';
  }
  if (normalized.includes('insta') || normalized.includes('instapay') || normalized.includes('bank') || normalized.includes('wallet')) {
    return 'insta_pay';
  }
  if (normalized.includes('banktransfer') || normalized.includes('bank_transfer')) {
    return 'bank_transfer';
  }
  return null;
}

export function normalizeOrder(raw: RawOrder): NormalizedOrder {
  const rawOrder = raw.raw_order ?? raw;
  const rawSms = raw.raw_sms ?? null;
  const orderId = String(raw.order_id ?? raw.id ?? generateUUID());
  const provider = detectProvider(raw);
  const amount = typeof raw.amount === 'number' ? raw.amount : parseFloat(String(raw.amount ?? '')) || 0;
  const currency = (raw.currency as string) || 'EGP';
  const createdAt = (raw.order_created_at as string) || (raw.created_at as string) || new Date().toISOString();
  const expiresAt = (raw.expires_at as string) || null;
  const status = (raw.status as string) || 'new';

  // دعم حقول payment_requests (expected_*) إضافة إلى حقول الخوادم الخارجية (legacy)
  const senderPhone   = (raw.expected_sender_phone  as string) || (raw.sender_phone  as string) || null;
  const senderName    = (raw.expected_sender_name   as string) || (raw.sender_name   as string) || null;
  const receiverPhone = (raw.expected_recipient_wallet as string) || (raw.receiver_phone as string) || null;

  return {
    orderId,
    customer: typeof raw.customer === 'string' ? raw.customer : raw.user ? String(raw.user) : undefined,
    paymentMethod: (raw.payment_method as string) || (raw.payment_type as string) || provider || undefined,
    provider,
    amount,
    currency,
    senderPhone,
    receiverPhone,
    senderName,
    transactionId: (raw.transaction_id as string) || null,
    transactionReference: (raw.transaction_reference as string) || (raw.external_reference as string) || null,
    orderCreatedAt: createdAt,
    messageReceivedAt: (raw.message_received_at as string) || null,
    service: (raw.service as string) || null,
    type: (raw.type as string) || null,
    status,
    expiresAt,
    rawOrder,
    rawSms,
  };
}

export function normalizeOrderToInternal(order: NormalizedOrder) {
  return {
    id: order.orderId,
    order_id: order.orderId,
    account_id: '',
    external_reference: order.orderId,
    order_reference: null,
    payment_type: order.paymentMethod || order.service || null,
    provider: order.provider,
    amount: order.amount,
    currency: order.currency,
    expected_sender_phone: order.senderPhone,
    expected_sender_name: order.senderName,
    expected_recipient_wallet: order.receiverPhone,
    sender_phone: order.senderPhone,
    receiver_phone: order.receiverPhone,
    sender_name: order.senderName,
    transaction_id: order.transactionId,
    transaction_reference: order.transactionReference,
    message_received_at: order.messageReceivedAt,
    service: order.service,
    type: order.type,
    status: order.status,
    expires_at: order.expiresAt,
    created_at: order.orderCreatedAt,
    updated_at: new Date().toISOString(),
    local_status: 'new' as const,
    sync_status: 'pending' as const,
    raw_order: JSON.stringify(order.rawOrder),
    raw_sms: order.rawSms ? JSON.stringify(order.rawSms) : null,
  };
}
