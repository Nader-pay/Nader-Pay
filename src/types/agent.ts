export type AgentOrderStatus =
  | 'new'
  | 'scanning'
  | 'matched'
  | 'confirmed'
  | 'rejected'
  | 'expired'
  | 'error'
  | 'sync_pending';

export type ConnectionStatus = 'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'SYNCING' | 'ERROR';

export type SmsMatchStatus = 'pending' | 'matched' | 'confirmed' | 'rejected' | 'error';

export type SmsMessage = {
  id: string;
  originatingAddress: string;
  body: string;
  date: string; // ISO
  readState: number;
  threadId?: number;
  protocol?: string;
};

export type ParsedTransaction = {
  provider: 'vodafone_cash';
  transactionId: string;
  amount: number;
  currency: string;
  senderPhone: string | null;
  senderName: string | null;
  recipientWallet: string | null;
  occurredAt: string;
  rawMessage: string;
  normalizedMessage: string;
};

export type Order = {
  id: string;
  account_id: string;
  external_reference: string;
  order_reference: string | null;
  payment_type: string | null;
  amount: number;
  currency: string;
  expected_sender_phone: string | null;
  expected_sender_name: string | null;
  expected_recipient_wallet: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  localStatus?: AgentOrderStatus;
  matchScore?: number;
  evidenceId?: string;
};

export type MatchResult = {
  order: Order;
  transaction: ParsedTransaction;
  score: number;
  reasons: string[];
  confirmed: boolean;
};

export type AgentSettings = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  pollingIntervalMs: number;
  maxAmountTolerance: number;
  autoConfirm: boolean;
  enabled: boolean;
  maxSearchWindowHours: number;
  autoRejectPolicy: 'never' | 'on_expiry' | 'on_mismatch';
  retryPolicy: 'none' | 'linear' | 'exponential';
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  notificationsEnabled: boolean;
  backgroundSyncEnabled: boolean;
};

export type DeviceState = {
  deviceId: string | null;
  deviceName: string | null;
  deviceToken: string | null;
  registeredAt: string | null;
  accountId: string | null;
};

export type AgentState = {
  isReady: boolean;
  isPolling: boolean;
  isSmsPermissionGranted: boolean | null;
  connectionStatus: ConnectionStatus;
  listenerStatus: 'running' | 'stopped' | 'error';
  lastPollAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingOrders: Order[];
  recentMatches: MatchResult[];
  pendingSyncCount: number;
  stats: {
    active: number;
    confirmed: number;
    rejected: number;
    waiting: number;
    syncPending: number;
    total: number;
  };
};

export type OfflineQueueItem = {
  id: string;
  orderId: string;
  action: 'confirm' | 'reject';
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: string;
  status: 'pending' | 'syncing' | 'failed';
};
