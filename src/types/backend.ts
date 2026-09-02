import type { ProviderName } from './provider';

export type AuthType = 'bearer' | 'api_key' | 'basic' | 'custom';

export type ServerProfile = {
  id: string;
  name: string;
  baseUrl: string;
  authType: AuthType;
  apiKey?: string;
  token?: string;
  username?: string;
  password?: string;
  customHeaders?: Record<string, string>;
  apiContract?: BackendApiContract;
  discoveryUrl?: string;
  isActive: boolean;
  isConnected: boolean;
  lastConnectedAt?: string;
  lastSyncAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type BackendApiContract = {
  baseUrl: string;
  discoveryEndpoint?: string;
  openApiUrl?: string;
  endpoints: {
    orders?: string;
    receive?: string;
    verify?: string;
    confirm?: string;
    reject?: string;
    duplicate?: string;
    config?: string;
    realtime?: string;
    sync?: string;
    deviceRegister?: string;
    heartbeat?: string;
    [key: string]: string | undefined;
  };
  auth: {
    type: AuthType;
    header?: string;
    prefix?: string;
    in: 'header' | 'query';
  };
  realtime?: {
    type: 'websocket' | 'sse' | 'polling' | 'supabase' | 'none';
    url?: string;
    topic?: string;
    intervalSeconds?: number;
  };
  orderSchema?: Record<string, string>;
};

export type DiscoveryResponse = {
  name?: string;
  version?: string;
  endpoints?: Record<string, string>;
  auth?: BackendApiContract['auth'];
  realtime?: BackendApiContract['realtime'];
  orderSchema?: Record<string, string>;
};

export type RawOrder = {
  [key: string]: unknown;
  order_id?: string;
  id?: string;
  customer?: string | { [key: string]: unknown };
  user?: string | { [key: string]: unknown };
  payment_method?: string;
  payment_type?: string;                  // حقل payment_requests
  provider?: string;
  amount?: number;
  currency?: string;
  // حقول payment_requests المباشرة
  expected_sender_phone?: string;
  expected_sender_name?: string;
  expected_recipient_wallet?: string;
  // حقول الخوادم الخارجية (legacy)
  sender_phone?: string;
  receiver_phone?: string;
  sender_name?: string;
  transaction_id?: string;
  transaction_reference?: string;
  external_reference?: string;
  order_reference?: string;
  reason_code?: string;
  order_created_at?: string;
  created_at?: string;
  updated_at?: string;
  message_received_at?: string;
  service?: string;
  type?: string;
  status?: string;
  expires_at?: string;
  raw_order?: unknown;
  raw_sms?: unknown;
};

export type NormalizedOrder = {
  orderId: string;
  customer?: string;
  paymentMethod?: string;
  provider: ProviderName | null;
  amount: number;
  currency: string;
  senderPhone: string | null;
  receiverPhone: string | null;
  senderName: string | null;
  transactionId: string | null;
  transactionReference: string | null;
  orderCreatedAt: string;
  messageReceivedAt: string | null;
  service: string | null;
  type: string | null;
  status: string;
  expiresAt: string | null;
  rawOrder: unknown;
  rawSms: unknown | null;
};

export type ConnectionTestResult = {
  ok: boolean;
  status?: number;
  statusText?: string;
  endpoint?: string;
  method?: string;
  responseBody?: unknown;
  requestId?: string;
  error?: string;
  authOk?: boolean;
};

export type BackendRequestMeta = {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  requestId?: string;
  responseStatus?: number;
  responseBody?: unknown;
  error?: string;
  startedAt: string;
  finishedAt?: string;
};

export type BackendOperation =
  | 'discover'
  | 'register'
  | 'heartbeat'
  | 'fetchOrders'
  | 'receiveOrder'
  | 'verifyOrder'
  | 'confirmOrder'
  | 'rejectOrder'
  | 'duplicateOrder'
  | 'syncOrders'
  | 'realtimeSubscribe';
