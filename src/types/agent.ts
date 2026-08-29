import type { ProviderName, SourceVerificationStatus, ProviderConfig } from './provider';
export type { ProviderName, SourceVerificationStatus, ProviderConfig };

export type AgentOrderStatus =
  | 'new'
  | 'scanning'
  | 'matched'
  | 'review_required'
  | 'confirmed'
  | 'confirmed_local'
  | 'rejected'
  | 'rejected_local'
  | 'expired'
  | 'error'
  | 'sync_pending'
  | 'syncing';

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
  provider: ProviderName;
  transactionId: string;
  amount: number;
  currency: string;
  senderPhone: string | null;
  senderName: string | null;
  recipientWallet: string | null;
  occurredAt: string;
  rawMessage: string;
  normalizedMessage: string;
  sourceVerification: SourceVerificationStatus;
};

export type StoredSmsMessage = SmsMessage & {
  messageHash: string;
  parsed?: ParsedTransaction | null;
  storedAt: string;
};

export type Order = {
  id: string;
  order_id?: string;
  account_id: string;
  external_reference: string;
  order_reference: string | null;
  payment_type: string | null;
  provider: ProviderName | null;
  amount: number;
  currency: string;
  expected_sender_phone: string | null;
  expected_sender_name: string | null;
  expected_recipient_wallet: string | null;
  sender_phone?: string | null;
  receiver_phone?: string | null;
  sender_name?: string | null;
  transaction_id?: string | null;
  transaction_reference?: string | null;
  message_received_at?: string | null;
  service?: string | null;
  type?: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  localStatus?: AgentOrderStatus;
  matchScore?: number;
  evidenceId?: string;
  syncStatus?: 'synced' | 'pending' | 'syncing' | 'failed';
  rawSms?: string | null;
  rawOrder?: string | null;
  matchedTransaction?: string | null;
  verificationPayload?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewReason?: string | null;
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
  activeServerProfileId: string | null;
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
  requireSourceVerification: boolean;
  minMatchScore: number;
  providers: Record<ProviderName, ProviderConfig>;
};

export type DeviceState = {
  deviceId: string | null;
  deviceName: string | null;
  deviceToken: string | null;
  registeredAt: string | null;
  accountId: string | null;
};

export type AgentDiagnosticState = {
  agentRunning: boolean;
  network: 'ONLINE' | 'OFFLINE';
  smsReady: boolean;
  notifications: boolean;
  backgroundAgent: boolean;
  batteryOptimization?: 'normal' | 'optimized' | 'unknown' | 'restricted';
  deviceRegistered: boolean;
  databaseReady: boolean;
  pendingSyncCount: number;
  activeOrders: number;
  lastSmsAt: string | null;
  lastScanAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  activeServerProfile?: string | null;
  backendStatus?: 'online' | 'offline' | 'error' | 'unknown';
  lastBackendStatus?: number | null;
  lastBackendEndpoint?: string | null;
  lastBackendMethod?: string | null;
  lastBackendRequestId?: string | null;
  lastBackendResponse?: string | null;
  lastBackendError?: string | null;
  realtimeStatus?: 'connected' | 'polling' | 'unavailable' | 'unknown';
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
  diagnostics: AgentDiagnosticState;
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

export type TimelineItem = {
  stage: string;
  status: 'completed' | 'current' | 'pending' | 'error';
  timestamp: string | null;
  reason?: string | null;
};
